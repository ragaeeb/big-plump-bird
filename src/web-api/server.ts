import { readdir, rm, stat } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { loadConfig } from '../core/config';
import { deleteVideoFully, openDb } from '../core/db';
import { getAnalytics } from './analytics-repository';
import type { CreateJobRequest, JobOverrides } from './job-logic';
import { JobManager } from './job-manager';
import {
    getTranscriptDetail,
    listTranscriptChannels,
    listTranscriptions,
    resolveAudioSource,
} from './transcript-repository';
import {
    getVideoDeleteCandidate,
    getVideoRetryCandidate,
    listRecentVideos,
    type VideoDeleteCandidate,
} from './video-repository';

const API_PORT = parsePositiveInt(Bun.env.BPB_WEB_API_PORT, 8787);
const API_HOST = Bun.env.BPB_WEB_API_HOST ?? '127.0.0.1';
const JOB_CONCURRENCY = parsePositiveInt(Bun.env.BPB_WEB_JOB_CONCURRENCY, 1);
const MAX_JSON_BODY_BYTES = 1_048_576;
const VIDEO_ID_ENCODED_RE = /^[A-Za-z0-9_-]+$/;
const ENHANCEMENT_MODES = new Set(['off', 'auto', 'on', 'analyze-only']);
const SOURCE_CLASSES = new Set(['auto', 'studio', 'podium', 'far-field', 'cassette']);
const DEREVERB_MODES = new Set(['off', 'auto', 'on']);
const DEFAULT_CONFIG_PATH = resolve(import.meta.dir, '../../config.json');
const CONFIG_PATH = resolve(Bun.env.BPB_CONFIG_PATH ?? DEFAULT_CONFIG_PATH);

const initialConfig = await loadConfig(CONFIG_PATH);
const cachedOptions = buildOptionsResponse(initialConfig);
const db = await openDb(initialConfig.dbPath);
const jobManager = new JobManager({
    concurrency: JOB_CONCURRENCY,
    configPath: CONFIG_PATH,
});

const server = Bun.serve({
    fetch: async (request) => {
        if (request.method === 'OPTIONS') {
            return withCors(new Response(null, { status: 204 }));
        }

        try {
            const response = await handleApiRequest(request, new URL(request.url));
            return withCors(response);
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            console.error('[web-api] unhandled request error:', message);
            return withCors(json({ error: 'Internal server error' }, { status: 500 }));
        }
    },
    hostname: API_HOST,
    port: API_PORT,
});

console.log(`[web-api] listening on http://${API_HOST}:${server.port}`);
console.log(`[web-api] config: ${CONFIG_PATH}`);
console.log(`[web-api] db: ${initialConfig.dbPath}`);
console.log(`[web-api] defaults: model=${initialConfig.modelPath}, language=${initialConfig.language}`);

const shutdown = () => {
    db.close(false);
    server.stop();
};

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

async function handleApiRequest(request: Request, url: URL): Promise<Response> {
    if (request.method === 'DELETE' && url.pathname.startsWith('/api/videos/')) {
        return handleDeleteVideo(url.pathname);
    }
    if (request.method === 'POST' && url.pathname.startsWith('/api/videos/') && url.pathname.endsWith('/retry')) {
        return handleRetryVideo(url.pathname);
    }
    if (request.method === 'GET' && url.pathname.startsWith('/api/jobs/')) {
        return handleGetJob(url.pathname);
    }
    if (request.method === 'GET' && url.pathname.startsWith('/api/transcripts/')) {
        return handleGetTranscriptById(url.pathname);
    }
    if ((request.method === 'GET' || request.method === 'HEAD') && url.pathname.startsWith('/api/media/audio/')) {
        return handleGetAudioByVideoId(request, url.pathname);
    }

    const route = `${request.method} ${url.pathname}`;
    switch (route) {
        case 'GET /api/health':
            return json({ ok: true, time: new Date().toISOString() });
        case 'GET /api/options':
            return handleGetOptions();
        case 'GET /api/stats':
            return handleGetStats();
        case 'GET /api/analytics':
            return handleGetAnalytics();
        case 'GET /api/jobs':
            return handleGetJobs(url);
        case 'POST /api/jobs':
            return handlePostJob(request);
        case 'GET /api/videos':
            return handleGetVideos(url);
        case 'GET /api/transcripts':
            return handleGetTranscripts(url);
        case 'GET /api/channels':
            return handleGetChannels();
        default:
            return json({ error: 'Not found' }, { status: 404 });
    }
}

function handleGetJobs(url: URL): Response {
    const limit = parseNonNegativeInt(url.searchParams.get('limit'), 50);
    return json({ jobs: jobManager.listJobs(limit) });
}

function handleGetJob(pathname: string): Response {
    const jobId = pathname.slice('/api/jobs/'.length);
    const job = jobManager.getJob(jobId);
    if (!job) {
        return json({ error: `Job not found: ${jobId}` }, { status: 404 });
    }
    return json({ job });
}

async function handlePostJob(request: Request): Promise<Response> {
    try {
        const payload = validateCreateJobRequest((await readJson(request)) as CreateJobRequest);
        const job = jobManager.createJob(payload);
        return json({ job }, { status: 201 });
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return json({ error: message }, { status: 400 });
    }
}

function handleGetVideos(url: URL): Response {
    const limit = parsePositiveInt(url.searchParams.get('limit'), 30);
    return json({ videos: listRecentVideos(db, limit) });
}

function handleRetryVideo(pathname: string): Response {
    const prefix = '/api/videos/';
    const suffix = '/retry';
    const encodedVideoId = pathname.slice(prefix.length, -suffix.length);
    if (!VIDEO_ID_ENCODED_RE.test(encodedVideoId)) {
        return json({ error: 'invalid video_id' }, { status: 400 });
    }
    const videoId = decodeURIComponent(encodedVideoId);

    if (videoId.length === 0) {
        return json({ error: 'video_id is required' }, { status: 400 });
    }

    const candidate = getVideoRetryCandidate(db, videoId);
    if (!candidate) {
        return json({ error: `Video not found: ${videoId}` }, { status: 404 });
    }
    if (candidate.status !== 'error' && candidate.status !== 'failed' && candidate.status !== 'processing') {
        return json({ error: `Video status is not retryable: ${candidate.status}` }, { status: 409 });
    }

    if (candidate.status === 'processing') {
        const activeJob = jobManager.findActiveJobByInput(candidate.sourceUri);
        if (activeJob) {
            return json({ error: `Video already has an active job: ${activeJob.id}` }, { status: 409 });
        }
    }

    const input = candidate.sourceUri.trim();
    if (input.length === 0) {
        return json({ error: `Video source is unavailable for retry: ${videoId}` }, { status: 422 });
    }

    const job = jobManager.createJob({
        force: true,
        input,
        overrides: buildRetryOverrides(candidate),
    });
    return json({ job }, { status: 201 });
}

async function handleDeleteVideo(pathname: string): Promise<Response> {
    const prefix = '/api/videos/';
    const encodedVideoId = pathname.slice(prefix.length);
    if (!VIDEO_ID_ENCODED_RE.test(encodedVideoId)) {
        return json({ error: 'invalid video_id' }, { status: 400 });
    }
    const videoId = decodeURIComponent(encodedVideoId);

    if (videoId.length === 0) {
        return json({ error: 'video_id is required' }, { status: 400 });
    }

    const candidate = getVideoDeleteCandidate(db, videoId);
    if (!candidate) {
        return json({ error: `Video not found: ${videoId}` }, { status: 404 });
    }

    const activeJob = jobManager.findActiveJobByInput(candidate.sourceUri);
    if (activeJob) {
        return json({ error: `Cannot delete while job is active: ${activeJob.id}` }, { status: 409 });
    }

    const cleanupPaths = await collectVideoCleanupPaths(videoId, candidate);
    for (const cleanupPath of cleanupPaths) {
        await rm(cleanupPath, { force: true, recursive: true });
    }

    deleteVideoFully(db, videoId);

    return json({ deleted: true, videoId });
}

function handleGetStats(): Response {
    const transcriptsTotal = (db.query(`SELECT COUNT(*) AS count FROM transcripts;`).get() as { count: number }).count;
    const videosTotal = (db.query(`SELECT COUNT(*) AS count FROM videos;`).get() as { count: number }).count;
    const audioBackedTranscripts = (
        db
            .query(
                `
            SELECT COUNT(*) AS count
            FROM transcripts t
            WHERE EXISTS (
                SELECT 1
                FROM artifacts a
                WHERE a.video_id = t.video_id
                AND a.kind IN ('source_audio', 'audio_wav_enhanced', 'audio_wav')
            );
            `,
            )
            .get() as { count: number }
    ).count;
    const activeJobs = jobManager.countActiveJobs();

    return json({
        stats: {
            activeJobs,
            audioBackedTranscripts,
            transcriptsTotal,
            videosTotal,
        },
    });
}

function handleGetTranscripts(url: URL): Response {
    const limit = parsePositiveInt(url.searchParams.get('limit'), 50);
    const offset = parseNonNegativeInt(url.searchParams.get('offset'), 0);
    const query = (url.searchParams.get('q') ?? '').trim();
    const channelId = (url.searchParams.get('channel_id') ?? '').trim();
    const transcripts = listTranscriptions(db, {
        channelId: channelId.length > 0 ? channelId : null,
        limit,
        offset,
        query,
    });
    return json({ transcripts });
}

function handleGetChannels(): Response {
    return json({ channels: listTranscriptChannels(db) });
}

function handleGetAnalytics(): Response {
    const analytics = getAnalytics(db);
    return json({ analytics });
}

async function handleGetTranscriptById(pathname: string): Promise<Response> {
    const videoId = decodeURIComponent(pathname.slice('/api/transcripts/'.length));
    const transcript = await getTranscriptDetail(db, videoId);
    if (!transcript) {
        return json({ error: `Transcript not found for video_id: ${videoId}` }, { status: 404 });
    }
    const audioSource = await resolveAudioSource(db, videoId);
    return json({
        transcript: {
            ...transcript,
            audioKind: audioSource?.kind ?? null,
            audioUrl: audioSource ? `/api/media/audio/${encodeURIComponent(videoId)}` : null,
            hasAudio: audioSource !== null,
        },
    });
}

async function handleGetAudioByVideoId(request: Request, pathname: string): Promise<Response> {
    const videoId = decodeURIComponent(pathname.slice('/api/media/audio/'.length));
    const source = await resolveAudioSource(db, videoId);
    if (!source) {
        return json({ error: `Audio is unavailable for video_id: ${videoId}` }, { status: 404 });
    }
    return streamAudioResponse(request, source.path, source.mimeType);
}

function handleGetOptions(): Response {
    return json(cachedOptions);
}

function buildOptionsResponse(config: Awaited<ReturnType<typeof loadConfig>>): Record<string, unknown> {
    return {
        defaults: {
            attenLimDb: config.enhancement.attenLimDb,
            dereverbMode: config.enhancement.dereverbMode,
            enhancementMode: config.enhancement.mode,
            language: config.language,
            modelPath: config.modelPath,
            outputFormats: config.outputFormats,
            snrSkipThresholdDb: config.enhancement.snrSkipThresholdDb,
            sourceClass: config.enhancement.sourceClass,
        },
        dereverbModes: [
            { label: 'Off', value: 'off' },
            { label: 'Auto', value: 'auto' },
            { label: 'On', value: 'on' },
        ],
        enhancementModes: [
            { label: 'Off', value: 'off' },
            { label: 'Auto (skip clean audio)', value: 'auto' },
            { label: 'On (always enhance)', value: 'on' },
            { label: 'Analyze only', value: 'analyze-only' },
        ],
        languages: [
            { label: 'English', value: 'en' },
            { label: 'Arabic', value: 'ar' },
            { label: 'Auto detect', value: 'auto' },
        ],
        models: [
            { label: 'turbo (fast large-v3)', value: 'turbo' },
            { label: 'large-v3', value: 'large-v3' },
        ],
        outputFormats: [
            { label: 'JSON', value: 'json' },
            { label: 'TXT', value: 'txt' },
            { label: 'SRT', value: 'srt' },
            { label: 'VTT', value: 'vtt' },
            { label: 'TSV', value: 'tsv' },
        ],
        sourceClasses: [
            { label: 'Auto', value: 'auto' },
            { label: 'Studio', value: 'studio' },
            { label: 'Podium', value: 'podium' },
            { label: 'Far-field / audience', value: 'far-field' },
            { label: 'Cassette', value: 'cassette' },
        ],
    };
}

function parsePositiveInt(value: string | null | undefined, fallback: number): number {
    if (!value) {
        return fallback;
    }
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function parseNonNegativeInt(value: string | null | undefined, fallback: number): number {
    if (!value) {
        return fallback;
    }
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

async function readJson(request: Request): Promise<unknown> {
    const contentLengthRaw = request.headers.get('content-length');
    if (contentLengthRaw) {
        const contentLength = Number.parseInt(contentLengthRaw, 10);
        if (Number.isFinite(contentLength) && contentLength > MAX_JSON_BODY_BYTES) {
            throw new Error(`JSON payload too large (max ${MAX_JSON_BODY_BYTES} bytes).`);
        }
    }

    try {
        const bodyText = await request.text();
        if (new TextEncoder().encode(bodyText).byteLength > MAX_JSON_BODY_BYTES) {
            throw new Error(`JSON payload too large (max ${MAX_JSON_BODY_BYTES} bytes).`);
        }
        return JSON.parse(bodyText) as unknown;
    } catch (error) {
        if (error instanceof Error && error.message.startsWith('JSON payload too large')) {
            throw error;
        }
        throw new Error('Invalid JSON payload.');
    }
}

function withCors(response: Response): Response {
    response.headers.set('Access-Control-Allow-Origin', '*');
    response.headers.set('Access-Control-Allow-Methods', 'GET,POST,DELETE,HEAD,OPTIONS');
    response.headers.set('Access-Control-Allow-Headers', 'Content-Type');
    return response;
}

function validateCreateJobRequest(raw: CreateJobRequest): CreateJobRequest {
    if (!raw || typeof raw !== 'object') {
        throw new Error('Invalid job payload.');
    }

    const input = typeof raw.input === 'string' ? raw.input.trim() : '';
    if (input.length === 0) {
        throw new Error('input is required');
    }

    const overrides = raw.overrides;
    if (overrides !== undefined) {
        if (!overrides || typeof overrides !== 'object' || Array.isArray(overrides)) {
            throw new Error('overrides must be an object');
        }

        if (overrides.language !== undefined && typeof overrides.language !== 'string') {
            throw new Error('overrides.language must be a string');
        }
        if (overrides.modelPath !== undefined && typeof overrides.modelPath !== 'string') {
            throw new Error('overrides.modelPath must be a string');
        }
        if (
            overrides.outputFormats !== undefined &&
            (!Array.isArray(overrides.outputFormats) ||
                overrides.outputFormats.some((value) => typeof value !== 'string'))
        ) {
            throw new Error('overrides.outputFormats must be an array of strings');
        }
        if (overrides.enhancementMode !== undefined && !ENHANCEMENT_MODES.has(overrides.enhancementMode)) {
            throw new Error('overrides.enhancementMode is invalid');
        }
        if (overrides.sourceClass !== undefined && !SOURCE_CLASSES.has(overrides.sourceClass)) {
            throw new Error('overrides.sourceClass is invalid');
        }
        if (overrides.dereverbMode !== undefined && !DEREVERB_MODES.has(overrides.dereverbMode)) {
            throw new Error('overrides.dereverbMode is invalid');
        }
        if (
            overrides.attenLimDb !== undefined &&
            (!Number.isFinite(overrides.attenLimDb) || overrides.attenLimDb < 0 || overrides.attenLimDb > 60)
        ) {
            throw new Error('overrides.attenLimDb must be between 0 and 60');
        }
        if (
            overrides.snrSkipThresholdDb !== undefined &&
            (!Number.isFinite(overrides.snrSkipThresholdDb) ||
                overrides.snrSkipThresholdDb < -20 ||
                overrides.snrSkipThresholdDb > 60)
        ) {
            throw new Error('overrides.snrSkipThresholdDb must be between -20 and 60');
        }
    }

    return {
        force: raw.force === true,
        input,
        overrides: raw.overrides,
    };
}

function buildRetryOverrides(candidate: {
    runLanguage: string | null;
    runModelPath: string | null;
    runOutputFormatsJson: string | null;
    runEnhancementJson: string | null;
    latestEnhancementConfigJson: string | null;
}): JobOverrides | undefined {
    const overrides: JobOverrides = {};

    if (candidate.runLanguage && candidate.runLanguage.trim().length > 0) {
        overrides.language = candidate.runLanguage.trim();
    }
    if (candidate.runModelPath && candidate.runModelPath.trim().length > 0) {
        overrides.modelPath = candidate.runModelPath.trim();
    }

    const outputFormats = parseStringArray(candidate.runOutputFormatsJson);
    if (outputFormats.length > 0) {
        overrides.outputFormats = outputFormats;
    }

    const enhancement =
        parseJsonObject(candidate.runEnhancementJson) ?? parseJsonObject(candidate.latestEnhancementConfigJson);
    if (enhancement) {
        if (typeof enhancement.mode === 'string') {
            overrides.enhancementMode = enhancement.mode as JobOverrides['enhancementMode'];
        }
        if (typeof enhancement.sourceClass === 'string') {
            overrides.sourceClass = enhancement.sourceClass as JobOverrides['sourceClass'];
        }
        if (typeof enhancement.dereverbMode === 'string') {
            overrides.dereverbMode = enhancement.dereverbMode as JobOverrides['dereverbMode'];
        }
        if (typeof enhancement.attenLimDb === 'number') {
            overrides.attenLimDb = enhancement.attenLimDb;
        }
        if (typeof enhancement.snrSkipThresholdDb === 'number') {
            overrides.snrSkipThresholdDb = enhancement.snrSkipThresholdDb;
        }
    }

    return Object.keys(overrides).length > 0 ? overrides : undefined;
}

function parseStringArray(raw: string | null): string[] {
    if (!raw) {
        return [];
    }
    try {
        const parsed = JSON.parse(raw);
        if (!Array.isArray(parsed)) {
            return [];
        }
        return parsed.filter((item): item is string => typeof item === 'string' && item.trim().length > 0);
    } catch {
        return [];
    }
}

function parseJsonObject(raw: string | null): Record<string, unknown> | null {
    if (!raw) {
        return null;
    }
    try {
        const parsed = JSON.parse(raw);
        if (!parsed || Array.isArray(parsed) || typeof parsed !== 'object') {
            return null;
        }
        return parsed as Record<string, unknown>;
    } catch {
        return null;
    }
}

async function collectVideoCleanupPaths(videoId: string, candidate: VideoDeleteCandidate): Promise<string[]> {
    const dataDir = resolve(initialConfig.dataDir);
    const sourceAudioDir = join(dataDir, 'source_audio');
    const audioDir = join(dataDir, 'audio');
    const transcriptsDir = join(dataDir, 'transcripts');
    const enhanceDir = join(dataDir, 'enhance');
    const cleanupPaths = new Set<string>();

    const addIfWithinDataDir = (inputPath: string | null | undefined) => {
        if (!inputPath) {
            return;
        }
        const resolved = resolve(inputPath);
        const rel = relative(dataDir, resolved);
        if (rel === '' || rel.startsWith('..') || isAbsolute(rel)) {
            return;
        }
        cleanupPaths.add(resolved);
    };

    for (const artifactUri of candidate.artifactUris) {
        addIfWithinDataDir(artifactUri);
    }

    if (candidate.sourceType === 'url') {
        addIfWithinDataDir(candidate.localPath);
    }

    addIfWithinDataDir(join(transcriptsDir, videoId));
    addIfWithinDataDir(join(enhanceDir, videoId));

    await addDirectoryEntriesByPrefix(sourceAudioDir, `${videoId}.`, addIfWithinDataDir);
    await addDirectoryEntriesByPrefix(audioDir, `${videoId}.`, addIfWithinDataDir);

    return Array.from(cleanupPaths);
}

async function addDirectoryEntriesByPrefix(
    dirPath: string,
    prefix: string,
    addPath: (path: string) => void,
): Promise<void> {
    try {
        const entries = await readdir(dirPath);
        for (const entry of entries) {
            if (!entry.startsWith(prefix)) {
                continue;
            }
            addPath(join(dirPath, entry));
        }
    } catch {
        // Ignore missing directories.
    }
}

function json(body: unknown, init?: ResponseInit): Response {
    return Response.json(body, {
        headers: {
            'Cache-Control': 'no-store',
        },
        ...init,
    });
}

async function streamAudioResponse(request: Request, filePath: string, mimeType: string): Promise<Response> {
    const info = await stat(filePath);
    const totalSize = info.size;
    const rangeHeader = request.headers.get('range');
    const isHead = request.method === 'HEAD';

    if (!rangeHeader) {
        return new Response(isHead ? null : Bun.file(filePath), {
            headers: {
                'Accept-Ranges': 'bytes',
                'Cache-Control': 'no-store',
                'Content-Length': String(totalSize),
                'Content-Type': mimeType,
            },
            status: 200,
        });
    }

    const parsed = parseRangeHeader(rangeHeader, totalSize);
    if (!parsed) {
        return new Response(null, {
            headers: {
                'Accept-Ranges': 'bytes',
                'Content-Range': `bytes */${totalSize}`,
            },
            status: 416,
        });
    }

    const chunkSize = parsed.end - parsed.start + 1;
    return new Response(isHead ? null : Bun.file(filePath).slice(parsed.start, parsed.end + 1), {
        headers: {
            'Accept-Ranges': 'bytes',
            'Cache-Control': 'no-store',
            'Content-Length': String(chunkSize),
            'Content-Range': `bytes ${parsed.start}-${parsed.end}/${totalSize}`,
            'Content-Type': mimeType,
        },
        status: 206,
    });
}

function parseRangeHeader(rangeHeader: string, totalSize: number): { start: number; end: number } | null {
    const match = /^bytes=(\d*)-(\d*)$/i.exec(rangeHeader.trim());
    if (!match) {
        return null;
    }

    const startRaw = match[1];
    const endRaw = match[2];

    if (startRaw.length === 0 && endRaw.length === 0) {
        return null;
    }

    let start = 0;
    let end = totalSize - 1;

    if (startRaw.length > 0) {
        start = Number.parseInt(startRaw, 10);
        if (!Number.isFinite(start) || start < 0) {
            return null;
        }
    }

    if (endRaw.length > 0) {
        const parsedEnd = Number.parseInt(endRaw, 10);
        if (!Number.isFinite(parsedEnd) || parsedEnd < 0) {
            return null;
        }
        if (startRaw.length === 0) {
            const suffixLength = parsedEnd;
            if (suffixLength <= 0) {
                return null;
            }
            start = Math.max(0, totalSize - suffixLength);
            end = totalSize - 1;
        } else {
            end = Math.min(parsedEnd, totalSize - 1);
        }
    }

    if (start > end || start >= totalSize) {
        return null;
    }

    return { end, start };
}
