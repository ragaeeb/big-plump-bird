import { readdir, readFile, rm, stat } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';
import type { RunConfig } from './config';
import type { ArtifactRecord, ChapterRecord, EnhancementSegmentRecord, SegmentRecord } from './db';
import {
    deleteVideoData,
    hasTranscript,
    insertArtifacts,
    insertChapters,
    insertEnhancementRun,
    insertEnhancementSegments,
    insertSegments,
    insertTranscript,
    openDb,
    updateVideoStatus,
    upsertVideo,
} from './db';
import type { EnhancementResult } from './enhance';
import { checkEnhancementAvailable, maybeEnhanceAudio } from './enhance';
import { convertToWav } from './ffmpeg';
import { runTafrigh } from './tafrigh';
import { ensureDir, pathExists, sha256String } from './utils';
import { ensureWhisperXAvailable, runWhisperX } from './whisperx';
import { downloadAudio, expandYtDlpUrls, getYtDlpId } from './yt_dlp';

export type RunOptions = {
    paths: string[];
    urlsFile?: string;
    urls?: string[];
    force: boolean;
    dryRun: boolean;
    enhancePlanIn?: string;
    enhancePlanOut?: string;
    abortSignal?: AbortSignal;
};

type InputItem = { source_type: 'file'; source_uri: string } | { source_type: 'url'; source_uri: string };

type DataDirs = {
    dataDir: string;
    sourceAudioDir: string;
    audioDir: string;
    transcriptsDir: string;
    enhanceDir: string;
};

const MAX_EXPAND_DEPTH = 10;
const MAX_EXPANDED_FILES = 10_000;
const TAFRIGH_ENGINE_VERSION = 'v4';

export async function runPipeline(config: RunConfig, options: RunOptions): Promise<void> {
    const dirs = await ensureDataDirs(config.dataDir);
    const db = await openDb(config.dbPath);
    let hadFailures = false;

    try {
        if (isAborted(options.abortSignal)) {
            return;
        }
        await ensurePipelineReady(config, options);
        const inputs = await collectInputItems(options);
        if (isAborted(options.abortSignal)) {
            return;
        }

        if (inputs.length === 0) {
            throw new Error('No inputs provided. Use --paths and/or --urls.');
        }

        const concurrency = Math.max(1, config.jobs);
        await runWithConcurrency(
            inputs,
            concurrency,
            async (item) => {
                const ok = await processInput(item, config, options, dirs, db);
                if (!ok) {
                    hadFailures = true;
                }
            },
            options.abortSignal,
        );
    } finally {
        db.close(false);
    }

    if (options.abortSignal?.aborted) {
        return;
    }

    if (hadFailures) {
        throw new Error('One or more inputs failed. Check logs and database records for details.');
    }
}

function isAborted(signal?: AbortSignal): boolean {
    return signal?.aborted === true;
}

async function ensurePipelineReady(config: RunConfig, options: RunOptions): Promise<void> {
    if (!options.dryRun && config.engine !== 'tafrigh') {
        await ensureWhisperXAvailable();
    }
    if (!options.dryRun && config.enhancement.mode !== 'off') {
        await checkEnhancementAvailable(config.enhancement);
    }
}

async function collectInputItems(options: RunOptions): Promise<InputItem[]> {
    const files = await collectPathInputs(options.paths);
    const urls = await collectUrlInputs(options.urlsFile, options.urls);
    return [...files, ...urls];
}

async function collectPathInputs(paths: string[]): Promise<InputItem[]> {
    const expandedPaths = await expandPaths(paths);
    return expandedPaths.map((path) => ({ source_type: 'file', source_uri: path }));
}

async function collectUrlInputs(urlsFile: string | undefined, urls: string[] | undefined): Promise<InputItem[]> {
    const seedUrls = await collectSeedUrls(urlsFile, urls);
    if (seedUrls.length === 0) {
        return [];
    }

    const inputs: InputItem[] = [];
    const seen = new Set<string>();
    for (const seedUrl of seedUrls) {
        const expandedUrls = await expandYtDlpUrls(seedUrl);
        if (expandedUrls.length > 1) {
            console.log(`[urls] Expanded ${seedUrl} -> ${expandedUrls.length} video URLs`);
        }
        for (const expandedUrl of expandedUrls) {
            if (seen.has(expandedUrl)) {
                continue;
            }
            seen.add(expandedUrl);
            inputs.push({ source_type: 'url', source_uri: expandedUrl });
        }
    }
    return inputs;
}

async function collectSeedUrls(urlsFile: string | undefined, urls: string[] | undefined): Promise<string[]> {
    const seedUrls: string[] = [];
    if (urlsFile) {
        seedUrls.push(...(await readUrlFile(urlsFile)));
    }
    if (!urls || urls.length === 0) {
        return seedUrls;
    }
    for (const url of urls) {
        const trimmed = url.trim();
        if (trimmed.length > 0) {
            seedUrls.push(trimmed);
        }
    }
    return seedUrls;
}

async function processInput(
    item: InputItem,
    config: RunConfig,
    options: RunOptions,
    dirs: DataDirs,
    db: Awaited<ReturnType<typeof openDb>>,
): Promise<boolean> {
    let videoId: string | null = null;
    try {
        const result =
            item.source_type === 'url'
                ? await processUrlInput(item.source_uri, config, options, dirs, db)
                : await processFileInput(item.source_uri, config, options, dirs, db);
        videoId = result.videoId;
        return result.success;
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error(`Error processing ${item.source_uri}: ${message}`);
        markInputError(item, config, db, videoId, message);
        return false;
    }
}

function resolveRunModelPath(config: RunConfig): string {
    return config.engine === 'tafrigh' ? 'tafrigh' : config.modelPath;
}

function resolveRunEngineVersion(config: RunConfig): string | null {
    return config.engine === 'tafrigh' ? TAFRIGH_ENGINE_VERSION : null;
}

function upsertProcessingVideo(
    db: Awaited<ReturnType<typeof openDb>>,
    config: RunConfig,
    now: string,
    record: Omit<
        Parameters<typeof upsertVideo>[1],
        | 'created_at'
        | 'run_engine'
        | 'run_engine_version'
        | 'run_language'
        | 'run_model_path'
        | 'run_output_formats_json'
        | 'run_enhancement_json'
        | 'status'
        | 'updated_at'
    >,
): void {
    upsertVideo(db, {
        ...record,
        created_at: now,
        run_engine: config.engine,
        run_engine_version: resolveRunEngineVersion(config),
        run_enhancement_json: JSON.stringify(config.enhancement),
        run_language: config.language,
        run_model_path: resolveRunModelPath(config),
        run_output_formats_json: JSON.stringify(config.outputFormats),
        status: 'processing',
        updated_at: now,
    });
}

async function processUrlInput(
    url: string,
    config: RunConfig,
    options: RunOptions,
    dirs: DataDirs,
    db: Awaited<ReturnType<typeof openDb>>,
): Promise<{ success: boolean; videoId: string }> {
    if (options.dryRun) {
        console.log(`[dry-run] Would download and transcribe URL: ${url}`);
        return { success: true, videoId: sha256String(url).slice(0, 32) };
    }

    const videoId = await getYtDlpId(url);
    if (shouldSkipExistingTranscript(db, videoId, options.force)) {
        return { success: true, videoId };
    }

    const now = new Date().toISOString();
    upsertProcessingVideo(db, config, now, {
        source_type: 'url',
        source_uri: url,
        video_id: videoId,
    });

    const format = buildYtDlpFormat(config);
    const { filePath, info, infoJson, infoJsonPath } = await downloadAudio(url, {
        downloadVideo: config.downloadVideo,
        forceOverwrites: options.force,
        format,
        id: videoId,
        outputDir: dirs.sourceAudioDir,
    });

    upsertProcessingVideo(db, config, new Date().toISOString(), {
        channel: info.channel ?? null,
        channel_id: info.channel_id ?? null,
        description: info.description ?? null,
        duration_ms: typeof info.duration === 'number' ? Math.round(info.duration * 1000) : null,
        local_path: filePath,
        metadata_json: infoJson,
        source_type: 'url',
        source_uri: url,
        timestamp: typeof info.timestamp === 'number' ? info.timestamp : null,
        title: info.title ?? null,
        upload_date: info.upload_date ?? null,
        uploader: info.uploader ?? null,
        uploader_id: info.uploader_id ?? null,
        video_id: videoId,
        webpage_url: info.webpage_url ?? url,
    });

    insertChapters(db, parseChapters(info, videoId));
    await transcribeAndStore({
        config,
        db,
        dirs,
        infoJsonPath,
        inputPath: filePath,
        isUrl: true,
        options,
        sourceAudioPath: filePath,
        videoId,
    });

    if (!config.keepSourceAudio) {
        await rm(filePath, { force: true });
    }
    return { success: true, videoId };
}

async function processFileInput(
    sourcePath: string,
    config: RunConfig,
    options: RunOptions,
    dirs: DataDirs,
    db: Awaited<ReturnType<typeof openDb>>,
): Promise<{ success: boolean; videoId: string }> {
    const filePath = resolve(sourcePath);
    if (options.dryRun) {
        console.log(`[dry-run] Would transcribe file: ${filePath}`);
        return { success: true, videoId: sha256String(filePath).slice(0, 32) };
    }

    const localStats = await stat(filePath);
    const stableFileKey = `${basename(filePath)}-${localStats.size}-${Math.trunc(localStats.mtimeMs)}`;
    const videoId = sha256String(stableFileKey).slice(0, 32);
    if (shouldSkipExistingTranscript(db, videoId, options.force)) {
        return { success: true, videoId };
    }

    upsertProcessingVideo(db, config, new Date().toISOString(), {
        local_path: filePath,
        source_type: 'file',
        source_uri: filePath,
        video_id: videoId,
    });

    await transcribeAndStore({
        config,
        db,
        dirs,
        inputPath: filePath,
        isUrl: false,
        options,
        videoId,
    });
    return { success: true, videoId };
}

function shouldSkipExistingTranscript(
    db: Awaited<ReturnType<typeof openDb>>,
    videoId: string,
    force: boolean,
): boolean {
    if (!force && hasTranscript(db, videoId)) {
        console.log(`Skipping (already transcribed): ${videoId}`);
        return true;
    }
    if (force) {
        deleteVideoData(db, videoId);
    }
    return false;
}

function markInputError(
    item: InputItem,
    config: RunConfig,
    db: Awaited<ReturnType<typeof openDb>>,
    videoId: string | null,
    message: string,
): void {
    const now = new Date().toISOString();
    const id = videoId ?? sha256String(item.source_uri).slice(0, 32);
    upsertVideo(db, {
        created_at: now,
        error: message,
        run_engine: config.engine,
        run_engine_version: resolveRunEngineVersion(config),
        source_type: item.source_type,
        source_uri: item.source_uri,
        status: 'error',
        updated_at: now,
        video_id: id,
    });
}

async function transcribeAndStore(opts: {
    videoId: string;
    inputPath: string;
    sourceAudioPath?: string;
    infoJsonPath?: string;
    isUrl: boolean;
    config: RunConfig;
    options: RunOptions;
    dirs: DataDirs;
    db: Awaited<ReturnType<typeof openDb>>;
}): Promise<void> {
    const { videoId, inputPath, sourceAudioPath, infoJsonPath, isUrl, config, options, dirs, db } = opts;
    const wavPath = join(dirs.audioDir, `${videoId}.wav`);
    const outputDir = join(dirs.transcriptsDir, videoId);
    const outputBase = join(outputDir, 'transcript');
    const artifacts: ArtifactRecord[] = [];

    await ensureDir(outputDir);
    await convertToWav(inputPath, wavPath);
    const enhancement = await runEnhancementStage(videoId, wavPath, dirs, options, config);
    const transcription = await runTranscriptionStage(videoId, outputBase, enhancement.wavForTranscription, config);
    artifacts.push(...transcription.artifacts);

    insertTranscript(db, {
        created_at: new Date().toISOString(),
        json: buildCompactTranscriptJson(transcription.language, transcription.words),
        language: transcription.language,
        model: transcription.model,
        text: transcription.text,
        video_id: videoId,
    });
    insertSegments(db, transcription.segments);

    await collectInputArtifacts(artifacts, {
        config,
        infoJsonPath,
        isUrl,
        sourceAudioPath,
        videoId,
        wavPath,
    });
    await collectEnhancementArtifacts(artifacts, enhancement.result, videoId);
    persistEnhancementTelemetry(db, config, enhancement, videoId);
    insertArtifacts(db, artifacts);
    updateVideoStatus(db, videoId, 'done', null);
    await cleanupAudioArtifacts(config, enhancement.result, wavPath);
}

type EnhancementStageResult = {
    wavForTranscription: string;
    result: EnhancementResult | null;
    error: string | null;
    finishedAt: string | null;
    startedAt: string | null;
};

type TranscriptionStageResult = {
    artifacts: ArtifactRecord[];
    language: string;
    model: string;
    segments: SegmentRecord[];
    text: string;
    words: WordRecord[];
};

async function runEnhancementStage(
    videoId: string,
    wavPath: string,
    dirs: DataDirs,
    options: RunOptions,
    config: RunConfig,
): Promise<EnhancementStageResult> {
    const base: EnhancementStageResult = {
        error: null,
        finishedAt: null,
        result: null,
        startedAt: null,
        wavForTranscription: wavPath,
    };
    if (config.enhancement.mode === 'off') {
        return base;
    }

    const startedAt = new Date().toISOString();
    try {
        const result = await maybeEnhanceAudio({
            config: config.enhancement,
            enhanceDir: dirs.enhanceDir,
            planInDir: options.enhancePlanIn,
            planOutDir: options.enhancePlanOut,
            rawWavPath: wavPath,
            videoId,
        });
        return {
            ...base,
            finishedAt: new Date().toISOString(),
            result,
            startedAt,
            wavForTranscription: result.wavPath,
        };
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error(`[enhance] Error: ${message}`);
        if (config.enhancement.failPolicy === 'fail') {
            throw error;
        }
        console.log('[enhance] Falling back to raw audio');
        return { ...base, error: message, finishedAt: new Date().toISOString(), startedAt };
    }
}

async function runTranscriptionStage(
    videoId: string,
    outputBase: string,
    wavPath: string,
    config: RunConfig,
): Promise<TranscriptionStageResult> {
    if (config.engine === 'tafrigh') {
        return runTafrighStage(videoId, wavPath, config);
    }
    return runWhisperxStage(videoId, outputBase, wavPath, config);
}

async function runTafrighStage(videoId: string, wavPath: string, config: RunConfig): Promise<TranscriptionStageResult> {
    const tafrighResult = await runTafrigh(wavPath, config.witAiApiKeys, videoId, config.language);
    const segments = tafrighResult.segments;
    const words = tafrighResult.words;
    return {
        artifacts: [],
        language: tafrighResult.language,
        model: `tafrigh ${TAFRIGH_ENGINE_VERSION}`,
        segments,
        text:
            wordsToText(words) ||
            segments
                .map((segment) => segment.text)
                .join(' ')
                .trim(),
        words,
    };
}

async function runWhisperxStage(
    videoId: string,
    outputBase: string,
    wavPath: string,
    config: RunConfig,
): Promise<TranscriptionStageResult> {
    await runWhisperX({
        batchSize: config.whisperxBatchSize,
        computeType: config.whisperxComputeType,
        formats: config.outputFormats.map((format) => format.toLowerCase()),
        language: config.language,
        modelPath: config.modelPath,
        outputBase,
        wavPath,
    });

    const txtPath = `${outputBase}.txt`;
    const jsonPath = `${outputBase}.json`;
    const [txtExists, jsonExists] = await Promise.all([pathExists(txtPath), pathExists(jsonPath)]);
    const [text, json] = await Promise.all([
        txtExists ? readFile(txtPath, 'utf-8') : '',
        jsonExists ? readFile(jsonPath, 'utf-8') : '',
    ]);

    const parsedWhisper = json ? parseWhisperOutput(json, videoId) : null;
    const segments = parsedWhisper?.segments ?? [];
    const words = parsedWhisper?.words ?? [];
    const artifacts = await collectWhisperArtifacts(videoId, txtPath, jsonPath, txtExists, jsonExists);
    return {
        artifacts,
        language: parsedWhisper?.language ?? config.language,
        model: basename(config.modelPath),
        segments,
        text:
            text ||
            wordsToText(words) ||
            segments
                .map((segment) => segment.text)
                .join(' ')
                .trim(),
        words,
    };
}

async function collectWhisperArtifacts(
    videoId: string,
    txtPath: string,
    jsonPath: string,
    txtExists: boolean,
    jsonExists: boolean,
): Promise<ArtifactRecord[]> {
    const artifacts: ArtifactRecord[] = [];
    if (txtExists) {
        artifacts.push(await buildArtifact(videoId, 'transcript_txt', txtPath));
    }
    if (jsonExists) {
        artifacts.push(await buildArtifact(videoId, 'transcript_json', jsonPath));
    }
    return artifacts;
}

async function collectInputArtifacts(
    artifacts: ArtifactRecord[],
    opts: {
        config: RunConfig;
        infoJsonPath?: string;
        isUrl: boolean;
        sourceAudioPath?: string;
        videoId: string;
        wavPath: string;
    },
): Promise<void> {
    const { config, infoJsonPath, isUrl, sourceAudioPath, videoId, wavPath } = opts;
    if (config.keepWav && (await pathExists(wavPath))) {
        artifacts.push(await buildArtifact(videoId, 'audio_wav', wavPath));
    }
    if (isUrl && config.keepSourceAudio && sourceAudioPath) {
        artifacts.push(await buildArtifact(videoId, 'source_audio', sourceAudioPath));
    }
    if (isUrl && infoJsonPath && (await pathExists(infoJsonPath))) {
        artifacts.push(await buildArtifact(videoId, 'source_info_json', infoJsonPath));
    }
}

async function collectEnhancementArtifacts(
    artifacts: ArtifactRecord[],
    enhancementResult: EnhancementResult | null,
    videoId: string,
): Promise<void> {
    if (!enhancementResult) {
        return;
    }
    for (const artifact of enhancementResult.artifacts) {
        if (await pathExists(artifact.path)) {
            artifacts.push(await buildArtifact(videoId, artifact.kind, artifact.path));
        }
    }
}

function persistEnhancementTelemetry(
    db: Awaited<ReturnType<typeof openDb>>,
    config: RunConfig,
    enhancement: EnhancementStageResult,
    videoId: string,
): void {
    if (enhancement.result) {
        persistEnhancementRun(db, config, enhancement.result, videoId);
        return;
    }
    if (config.enhancement.mode !== 'off' && enhancement.error) {
        insertEnhancementRun(db, {
            applied: 0,
            config_json: JSON.stringify(config.enhancement),
            duration_ms: null,
            error: enhancement.error,
            finished_at: enhancement.finishedAt ?? new Date().toISOString(),
            metrics_json: JSON.stringify({}),
            mode: config.enhancement.mode,
            regime_count: 0,
            skip_reason: null,
            snr_db: null,
            source_class: config.enhancement.sourceClass,
            started_at: enhancement.startedAt ?? new Date().toISOString(),
            status: 'error',
            versions_json: JSON.stringify({}),
            video_id: videoId,
        });
    }
}

function persistEnhancementRun(
    db: Awaited<ReturnType<typeof openDb>>,
    config: RunConfig,
    result: EnhancementResult,
    videoId: string,
): void {
    const analysis = result.analysis;
    const processing = result.processingResult;
    const runId = insertEnhancementRun(db, {
        applied: result.applied ? 1 : 0,
        config_json: JSON.stringify(config.enhancement),
        duration_ms: processing?.processing_ms ?? null,
        error: null,
        finished_at: result.finishedAt,
        metrics_json: JSON.stringify({
            analysis_duration_ms: analysis?.analysis_duration_ms,
            processing_ms: processing?.processing_ms,
            speech_ratio: analysis?.speech_ratio,
        }),
        mode: result.mode,
        regime_count: analysis?.regime_count ?? 0,
        skip_reason: result.skipReason ?? null,
        snr_db: analysis?.snr_db ?? null,
        source_class: config.enhancement.sourceClass,
        started_at: result.startedAt,
        status: result.applied ? 'completed' : 'skipped',
        versions_json: JSON.stringify({
            analysis: analysis?.versions ?? {},
            processing: processing?.versions ?? {},
        }),
        video_id: videoId,
    });
    if (processing && analysis) {
        insertEnhancementSegments(db, toEnhancementSegments(runId, processing, analysis));
    }
}

function toEnhancementSegments(
    runId: number,
    processing: NonNullable<EnhancementResult['processingResult']>,
    analysis: NonNullable<EnhancementResult['analysis']>,
): EnhancementSegmentRecord[] {
    return processing.segments.map((segment) => {
        const regime = analysis.regimes.find((entry) => entry.index === segment.segment_index);
        return {
            atten_lim_db: segment.atten_lim_db,
            denoise_applied: segment.denoise_applied ? 1 : 0,
            dereverb_applied: segment.dereverb_applied ? 1 : 0,
            end_ms: segment.end_ms,
            noise_rms_db: regime?.noise_rms_db ?? null,
            processing_ms: segment.processing_ms,
            run_id: runId,
            segment_index: segment.segment_index,
            spectral_centroid_hz: regime?.spectral_centroid_hz ?? null,
            speech_ratio: null,
            start_ms: segment.start_ms,
        };
    });
}

async function buildArtifact(videoId: string, kind: string, uri: string): Promise<ArtifactRecord> {
    return {
        created_at: new Date().toISOString(),
        kind,
        size_bytes: await fileSize(uri),
        uri,
        video_id: videoId,
    };
}

async function cleanupAudioArtifacts(
    config: RunConfig,
    enhancementResult: EnhancementResult | null,
    wavPath: string,
): Promise<void> {
    if (!config.keepWav) {
        await rm(wavPath, { force: true });
    }
    if (enhancementResult?.applied && !config.enhancement.keepIntermediate && enhancementResult.wavPath !== wavPath) {
        await rm(enhancementResult.wavPath, { force: true });
    }
}

function parseWhisperOutput(
    jsonText: string,
    videoId: string,
): { language: string | null; segments: SegmentRecord[]; words: WordRecord[] } {
    try {
        const parsed = JSON.parse(jsonText) as {
            language?: string;
            result?: { language?: string };
            params?: { language?: string };
            segments?: any[];
            transcription?: any[];
        };
        const language =
            (typeof parsed.result?.language === 'string' && parsed.result.language) ||
            (typeof parsed.language === 'string' && parsed.language) ||
            (typeof parsed.params?.language === 'string' && parsed.params.language) ||
            null;
        const segmentsSource = Array.isArray(parsed.segments)
            ? parsed.segments
            : Array.isArray(parsed.transcription)
              ? parsed.transcription
              : [];
        const words: WordRecord[] = [];
        return {
            language,
            segments: segmentsSource
                .map((seg) => toSegmentRecord(seg, videoId, words))
                .filter((segment): segment is SegmentRecord => segment !== null),
            words,
        };
    } catch {
        return { language: null, segments: [], words: [] };
    }
}

function toSegmentRecord(seg: any, videoId: string, words: WordRecord[]): SegmentRecord | null {
    if (typeof seg?.text !== 'string') {
        return null;
    }

    const cleanWords = extractWordRecords(seg.words);
    words.push(...cleanWords);
    const bounds = resolveSegmentBounds(seg, cleanWords);
    const text = cleanWords.length > 0 ? joinWords(cleanWords.map((word) => word.word)) : String(seg.text).trim();
    if (text.length === 0) {
        return null;
    }

    return {
        end_ms: bounds.endMs,
        start_ms: bounds.startMs,
        text,
        video_id: videoId,
    };
}

function extractWordRecords(wordItems: unknown): WordRecord[] {
    if (!Array.isArray(wordItems)) {
        return [];
    }
    return wordItems
        .filter((word: any) => isValidWhisperWord(word))
        .map((word: any) => ({
            end_ms: Math.round(word.end * 1000),
            start_ms: Math.round(word.start * 1000),
            word: String(word.word).trim(),
        }))
        .filter((word: WordRecord) => word.word.length > 0);
}

function isValidWhisperWord(word: any): boolean {
    return (
        typeof word?.word === 'string' &&
        typeof word.start === 'number' &&
        typeof word.end === 'number' &&
        Number.isFinite(word.start) &&
        Number.isFinite(word.end) &&
        word.start >= 0 &&
        word.end >= word.start
    );
}

function resolveSegmentBounds(seg: any, cleanWords: WordRecord[]): { startMs: number; endMs: number } {
    const startMs = getSegmentStartMs(seg, cleanWords);
    const endMs = getSegmentEndMs(seg, cleanWords, startMs);
    return { endMs, startMs };
}

function getSegmentStartMs(seg: any, cleanWords: WordRecord[]): number {
    if (typeof seg.start === 'number') {
        return Math.round(seg.start * 1000);
    }
    if (typeof seg.offsets?.from === 'number') {
        return seg.offsets.from;
    }
    return cleanWords.length > 0 ? cleanWords[0].start_ms : 0;
}

function getSegmentEndMs(seg: any, cleanWords: WordRecord[], fallbackStartMs: number): number {
    if (typeof seg.end === 'number') {
        return Math.round(seg.end * 1000);
    }
    if (typeof seg.offsets?.to === 'number') {
        return seg.offsets.to;
    }
    return cleanWords.length > 0 ? cleanWords[cleanWords.length - 1].end_ms : fallbackStartMs;
}

function buildCompactTranscriptJson(language: string, words: WordRecord[]): string {
    const compact = {
        language,
        words: words.map((word) => ({
            b: word.start_ms,
            e: word.end_ms,
            w: word.word,
        })),
    };
    return JSON.stringify(compact);
}

type WordRecord = {
    word: string;
    start_ms: number;
    end_ms: number;
};

function joinWords(words: string[]): string {
    const raw = words.join(' ');
    return raw
        .replace(/\s+([,.;:!?،؟])/g, '$1')
        .replace(/\s+(['")\]}])/g, '$1')
        .replace(/([[({])\s+/g, '$1')
        .trim();
}

function wordsToText(words: WordRecord[]): string {
    if (words.length === 0) {
        return '';
    }
    return joinWords(words.map((word) => word.word));
}

function parseChapters(
    info: { chapters?: Array<{ start_time?: number; end_time?: number; title?: string }> },
    videoId: string,
): ChapterRecord[] {
    const chapters = info.chapters ?? [];
    return chapters
        .filter((chapter) => typeof chapter.start_time === 'number')
        .map((chapter) => ({
            end_ms: typeof chapter.end_time === 'number' ? Math.round(chapter.end_time * 1000) : null,
            start_ms: Math.round((chapter.start_time ?? 0) * 1000),
            title: String(chapter.title ?? '').trim() || 'Chapter',
            video_id: videoId,
        }));
}

async function ensureDataDirs(dataDir: string): Promise<DataDirs> {
    const dataRoot = resolve(dataDir);
    const sourceAudioDir = join(dataRoot, 'source_audio');
    const audioDir = join(dataRoot, 'audio');
    const transcriptsDir = join(dataRoot, 'transcripts');
    const enhanceDir = join(dataRoot, 'enhance');
    await ensureDir(sourceAudioDir);
    await ensureDir(audioDir);
    await ensureDir(transcriptsDir);
    await ensureDir(enhanceDir);
    return { audioDir, dataDir: dataRoot, enhanceDir, sourceAudioDir, transcriptsDir };
}

async function expandPaths(paths: string[]): Promise<string[]> {
    const results = new Set<string>();
    for (const inputPath of paths) {
        await walkExpandedPath(results, inputPath, 0);
    }

    return Array.from(results);
}

async function walkExpandedPath(results: Set<string>, inputPath: string, depth: number): Promise<void> {
    if (hasReachedExpandedFileLimit(results)) {
        return;
    }

    const resolvedPath = resolve(inputPath);
    const stats = await getPathStatsOrWarn(resolvedPath);
    if (!stats) {
        return;
    }
    if (stats.isFile()) {
        results.add(resolvedPath);
        return;
    }
    if (!stats.isDirectory() || hasExceededExpandDepth(depth, resolvedPath)) {
        return;
    }
    await walkDirectoryEntries(results, resolvedPath, depth);
}

async function walkDirectoryEntries(results: Set<string>, dirPath: string, depth: number): Promise<void> {
    const entries = await readdir(dirPath, { withFileTypes: true });
    for (const entry of entries) {
        if (hasReachedExpandedFileLimit(results, true)) {
            return;
        }
        if (entry.isSymbolicLink() || (!entry.isDirectory() && !entry.isFile())) {
            continue;
        }
        const childPath = join(dirPath, entry.name);
        if (entry.isDirectory()) {
            await walkExpandedPath(results, childPath, depth + 1);
            continue;
        }
        results.add(childPath);
    }
}

function hasReachedExpandedFileLimit(results: Set<string>, warn = false): boolean {
    if (results.size < MAX_EXPANDED_FILES) {
        return false;
    }
    if (warn) {
        console.warn(`[paths] Warning: max expanded file limit reached (${MAX_EXPANDED_FILES})`);
    }
    return true;
}

async function getPathStatsOrWarn(path: string): Promise<Awaited<ReturnType<typeof stat>> | null> {
    if (!(await pathExists(path))) {
        console.warn(`[paths] Warning: path does not exist: ${path}`);
        return null;
    }
    return stat(path);
}

function hasExceededExpandDepth(depth: number, path: string): boolean {
    if (depth < MAX_EXPAND_DEPTH) {
        return false;
    }
    console.warn(`[paths] Warning: max path expansion depth reached (${MAX_EXPAND_DEPTH}): ${path}`);
    return true;
}

async function readUrlFile(filePath: string): Promise<string[]> {
    const raw = await readFile(filePath, 'utf-8');
    return raw
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line.length > 0 && !line.startsWith('#'));
}

function buildYtDlpFormat(config: RunConfig): string {
    if (config.sourceAudioFormat === 'opus-webm') {
        const abr = config.sourceAudioMaxAbrKbps;
        return `bestaudio[acodec=opus][abr<=${abr}]/bestaudio[acodec=opus]/bestaudio[abr<=${abr}]/bestaudio`;
    }
    return 'bestaudio';
}

async function fileSize(path: string): Promise<number> {
    const info = await stat(path);
    return info.size;
}

async function runWithConcurrency<T>(
    items: T[],
    limit: number,
    worker: (item: T) => Promise<void>,
    abortSignal?: AbortSignal,
): Promise<void> {
    if (items.length === 0 || abortSignal?.aborted) {
        return;
    }

    let index = 0;
    const cap = Math.min(Math.max(1, limit), items.length);
    const workers = Array.from({ length: cap }, async () => {
        while (true) {
            if (abortSignal?.aborted) {
                return;
            }
            const current = index++;
            if (current >= items.length) {
                return;
            }
            await worker(items[current]);
        }
    });
    await Promise.all(workers);
}
