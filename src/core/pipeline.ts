import { readdir, readFile, rm, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';
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
import { ensureDir, pathExists, sha256File, sha256String } from './utils';
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
};

type InputItem = { source_type: 'file'; source_uri: string } | { source_type: 'url'; source_uri: string };

type DataDirs = {
    dataDir: string;
    sourceAudioDir: string;
    audioDir: string;
    transcriptsDir: string;
    enhanceDir: string;
};

export async function runPipeline(config: RunConfig, options: RunOptions): Promise<void> {
    const dirs = await ensureDataDirs(config.dataDir);
    const db = await openDb(config.dbPath);

    if (!options.dryRun) {
        await ensureWhisperXAvailable();
    }

    if (!options.dryRun && config.enhancement.mode !== 'off') {
        await checkEnhancementAvailable(config.enhancement);
    }

    const inputs: InputItem[] = [];

    const expandedPaths = await expandPaths(options.paths);
    for (const filePath of expandedPaths) {
        inputs.push({ source_type: 'file', source_uri: filePath });
    }

    const seedUrls: string[] = [];
    if (options.urlsFile) {
        const urlLines = await readUrlFile(options.urlsFile);
        seedUrls.push(...urlLines);
    }
    if (options.urls && options.urls.length > 0) {
        for (const url of options.urls) {
            const trimmed = url.trim();
            if (trimmed.length > 0) {
                seedUrls.push(trimmed);
            }
        }
    }

    if (seedUrls.length > 0) {
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
    }

    if (inputs.length === 0) {
        throw new Error('No inputs provided. Use --paths and/or --urls.');
    }

    const concurrency = Math.max(1, config.jobs);
    await runWithConcurrency(inputs, concurrency, async (item) => {
        await processInput(item, config, options, dirs, db);
    });
}

async function processInput(
    item: InputItem,
    config: RunConfig,
    options: RunOptions,
    dirs: DataDirs,
    db: Awaited<ReturnType<typeof openDb>>,
): Promise<void> {
    const now = new Date().toISOString();
    let videoId: string | null = null;

    try {
        if (item.source_type === 'url') {
            const url = item.source_uri;
            if (options.dryRun) {
                console.log(`[dry-run] Would download and transcribe URL: ${url}`);
                return;
            }
            videoId = await getYtDlpId(url);
            if (!options.force && hasTranscript(db, videoId)) {
                console.log(`Skipping (already transcribed): ${videoId}`);
                return;
            }
            if (options.force) {
                deleteVideoData(db, videoId);
            }

            upsertVideo(db, {
                created_at: now,
                run_enhancement_json: JSON.stringify(config.enhancement),
                run_language: config.language,
                run_model_path: config.modelPath,
                run_output_formats_json: JSON.stringify(config.outputFormats),
                source_type: 'url',
                source_uri: url,
                status: 'processing',
                updated_at: now,
                video_id: videoId,
            });

            const format = buildYtDlpFormat(config);
            const { info, infoJson, filePath, infoJsonPath } = await downloadAudio(url, {
                downloadVideo: config.downloadVideo,
                forceOverwrites: options.force,
                format,
                id: videoId,
                outputDir: dirs.sourceAudioDir,
            });

            const durationMs = info.duration ? Math.round(info.duration * 1000) : null;

            upsertVideo(db, {
                channel: info.channel ?? null,
                channel_id: info.channel_id ?? null,
                created_at: now,
                description: info.description ?? null,
                duration_ms: durationMs,
                local_path: filePath,
                metadata_json: infoJson,
                run_enhancement_json: JSON.stringify(config.enhancement),
                run_language: config.language,
                run_model_path: config.modelPath,
                run_output_formats_json: JSON.stringify(config.outputFormats),
                source_type: 'url',
                source_uri: url,
                status: 'processing',
                timestamp: typeof info.timestamp === 'number' ? info.timestamp : null,
                title: info.title ?? null,
                updated_at: new Date().toISOString(),
                upload_date: info.upload_date ?? null,
                uploader: info.uploader ?? null,
                uploader_id: info.uploader_id ?? null,
                video_id: videoId,
                webpage_url: info.webpage_url ?? url,
            });

            const chapters = parseChapters(info, videoId);
            insertChapters(db, chapters);

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
            return;
        }

        if (options.dryRun) {
            const filePath = resolve(item.source_uri);
            console.log(`[dry-run] Would transcribe file: ${filePath}`);
            return;
        }

        const filePath = resolve(item.source_uri);
        videoId = await sha256File(filePath);

        if (!options.force && hasTranscript(db, videoId)) {
            console.log(`Skipping (already transcribed): ${videoId}`);
            return;
        }
        if (options.force) {
            deleteVideoData(db, videoId);
        }

        upsertVideo(db, {
            created_at: now,
            local_path: filePath,
            run_enhancement_json: JSON.stringify(config.enhancement),
            run_language: config.language,
            run_model_path: config.modelPath,
            run_output_formats_json: JSON.stringify(config.outputFormats),
            source_type: 'file',
            source_uri: filePath,
            status: 'processing',
            updated_at: now,
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
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error(`Error processing ${item.source_uri}: ${message}`);
        const id = videoId ?? sha256String(item.source_uri).slice(0, 16);
        const now = new Date().toISOString();
        upsertVideo(db, {
            created_at: now,
            error: message,
            source_type: item.source_type,
            source_uri: item.source_uri,
            status: 'error',
            updated_at: now,
            video_id: id,
        });
    }
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

    await ensureDir(outputDir);

    await convertToWav(inputPath, wavPath);

    // --- Enhancement ---
    let wavForWhisper = wavPath;
    let enhancementResult: EnhancementResult | null = null;
    let enhancementError: string | null = null;
    let enhancementStartedAt: string | null = null;
    let enhancementFinishedAt: string | null = null;

    if (config.enhancement.mode !== 'off') {
        enhancementStartedAt = new Date().toISOString();
        try {
            enhancementResult = await maybeEnhanceAudio({
                config: config.enhancement,
                enhanceDir: dirs.enhanceDir,
                planInDir: options.enhancePlanIn,
                planOutDir: options.enhancePlanOut,
                rawWavPath: wavPath,
                videoId,
            });
            wavForWhisper = enhancementResult.wavPath;
        } catch (error) {
            const msg = error instanceof Error ? error.message : String(error);
            enhancementError = msg;
            enhancementFinishedAt = new Date().toISOString();
            console.error(`[enhance] Error: ${msg}`);
            if (config.enhancement.failPolicy === 'fail') {
                throw error;
            }
            console.log('[enhance] Falling back to raw audio');
        }
    }

    await runWhisperX({
        batchSize: config.whisperxBatchSize,
        computeType: config.whisperxComputeType,
        formats: config.outputFormats.map((f) => f.toLowerCase()),
        language: config.language,
        modelPath: config.modelPath,
        outputBase,
        wavPath: wavForWhisper,
    });

    const txtPath = `${outputBase}.txt`;
    const jsonPath = `${outputBase}.json`;

    const [txtExists, jsonExists] = await Promise.all([pathExists(txtPath), pathExists(jsonPath)]);

    const text = txtExists ? await readFile(txtPath, 'utf-8') : '';
    const json = jsonExists ? await readFile(jsonPath, 'utf-8') : '';
    const parsedWhisper = json ? parseWhisperOutput(json, videoId) : null;
    const segments = parsedWhisper?.segments ?? [];
    const words = parsedWhisper?.words ?? [];
    const transcriptText =
        text ||
        wordsToText(words) ||
        segments
            .map((s) => s.text)
            .join(' ')
            .trim();
    const compactTranscriptJson = buildCompactTranscriptJson(parsedWhisper?.language ?? config.language, words);

    insertTranscript(db, {
        created_at: new Date().toISOString(),
        json: compactTranscriptJson,
        language: parsedWhisper?.language ?? config.language,
        model: basename(config.modelPath),
        text: transcriptText,
        video_id: videoId,
    });

    insertSegments(db, segments);

    const artifacts: ArtifactRecord[] = [];

    if (config.keepWav && (await pathExists(wavPath))) {
        artifacts.push({
            created_at: new Date().toISOString(),
            kind: 'audio_wav',
            size_bytes: await fileSize(wavPath),
            uri: wavPath,
            video_id: videoId,
        });
    }

    if (isUrl && config.keepSourceAudio && sourceAudioPath) {
        artifacts.push({
            created_at: new Date().toISOString(),
            kind: 'source_audio',
            size_bytes: await fileSize(sourceAudioPath),
            uri: sourceAudioPath,
            video_id: videoId,
        });
    }

    if (isUrl && infoJsonPath && (await pathExists(infoJsonPath))) {
        artifacts.push({
            created_at: new Date().toISOString(),
            kind: 'source_info_json',
            size_bytes: await fileSize(infoJsonPath),
            uri: infoJsonPath,
            video_id: videoId,
        });
    }

    if (txtExists) {
        artifacts.push({
            created_at: new Date().toISOString(),
            kind: 'transcript_txt',
            size_bytes: await fileSize(txtPath),
            uri: txtPath,
            video_id: videoId,
        });
    }

    if (jsonExists) {
        artifacts.push({
            created_at: new Date().toISOString(),
            kind: 'transcript_json',
            size_bytes: await fileSize(jsonPath),
            uri: jsonPath,
            video_id: videoId,
        });
    }

    // Enhancement artifacts and telemetry
    if (enhancementResult) {
        for (const art of enhancementResult.artifacts) {
            if (await pathExists(art.path)) {
                artifacts.push({
                    created_at: new Date().toISOString(),
                    kind: art.kind,
                    size_bytes: await fileSize(art.path),
                    uri: art.path,
                    video_id: videoId,
                });
            }
        }

        const analysis = enhancementResult.analysis;
        const proc = enhancementResult.processingResult;

        const runId = insertEnhancementRun(db, {
            applied: enhancementResult.applied ? 1 : 0,
            config_json: JSON.stringify(config.enhancement),
            duration_ms: proc?.processing_ms ?? null,
            error: null,
            finished_at: enhancementResult.finishedAt,
            metrics_json: JSON.stringify({
                analysis_duration_ms: analysis?.analysis_duration_ms,
                processing_ms: proc?.processing_ms,
                speech_ratio: analysis?.speech_ratio,
            }),
            mode: enhancementResult.mode,
            regime_count: analysis?.regime_count ?? 0,
            skip_reason: enhancementResult.skipReason ?? null,
            snr_db: analysis?.snr_db ?? null,
            source_class: config.enhancement.sourceClass,
            started_at: enhancementResult.startedAt,
            status: enhancementResult.applied ? 'completed' : 'skipped',
            versions_json: JSON.stringify({
                analysis: analysis?.versions ?? {},
                processing: proc?.versions ?? {},
            }),
            video_id: videoId,
        });

        if (proc && analysis) {
            const enhSegments: EnhancementSegmentRecord[] = proc.segments.map((seg) => {
                const regime = analysis.regimes.find((r) => r.index === seg.segment_index);
                return {
                    atten_lim_db: seg.atten_lim_db,
                    denoise_applied: seg.denoise_applied ? 1 : 0,
                    dereverb_applied: seg.dereverb_applied ? 1 : 0,
                    end_ms: seg.end_ms,
                    noise_rms_db: regime?.noise_rms_db ?? null,
                    processing_ms: seg.processing_ms,
                    run_id: runId,
                    segment_index: seg.segment_index,
                    spectral_centroid_hz: regime?.spectral_centroid_hz ?? null,
                    speech_ratio: null,
                    start_ms: seg.start_ms,
                };
            });
            insertEnhancementSegments(db, enhSegments);
        }
    } else if (config.enhancement.mode !== 'off' && enhancementError) {
        insertEnhancementRun(db, {
            applied: 0,
            config_json: JSON.stringify(config.enhancement),
            duration_ms: null,
            error: enhancementError,
            finished_at: enhancementFinishedAt ?? new Date().toISOString(),
            metrics_json: JSON.stringify({}),
            mode: config.enhancement.mode,
            regime_count: 0,
            skip_reason: null,
            snr_db: null,
            source_class: config.enhancement.sourceClass,
            started_at: enhancementStartedAt ?? new Date().toISOString(),
            status: 'error',
            versions_json: JSON.stringify({}),
            video_id: videoId,
        });
    }

    insertArtifacts(db, artifacts);
    updateVideoStatus(db, videoId, 'done', null);

    if (!config.keepWav) {
        await rm(wavPath, { force: true });
    }

    // Clean up enhanced WAV if intermediate files aren't kept
    if (enhancementResult?.applied && !config.enhancement.keepIntermediate && enhancementResult.wavPath !== wavPath) {
        await rm(enhancementResult.wavPath, { force: true });
    }
}

function basename(path: string): string {
    return path.split('/').pop() ?? path;
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
                .filter((seg) => typeof seg.text === 'string')
                .map((seg) => {
                    const wordItems = Array.isArray(seg.words) ? seg.words : [];
                    const cleanWords = wordItems
                        .filter(
                            (word) =>
                                typeof word.word === 'string' &&
                                typeof word.start === 'number' &&
                                typeof word.end === 'number',
                        )
                        .map((word) => ({
                            end_ms: Math.round(word.end * 1000),
                            start_ms: Math.round(word.start * 1000),
                            word: String(word.word).trim(),
                        }))
                        .filter((word) => word.word.length > 0);
                    words.push(...cleanWords);

                    const startMs =
                        typeof seg.start === 'number'
                            ? Math.round(seg.start * 1000)
                            : typeof seg.offsets?.from === 'number'
                              ? seg.offsets.from
                              : cleanWords.length > 0
                                ? cleanWords[0].start_ms
                                : 0;
                    const endMs =
                        typeof seg.end === 'number'
                            ? Math.round(seg.end * 1000)
                            : typeof seg.offsets?.to === 'number'
                              ? seg.offsets.to
                              : cleanWords.length > 0
                                ? cleanWords[cleanWords.length - 1].end_ms
                                : startMs;
                    const text =
                        cleanWords.length > 0
                            ? joinWords(cleanWords.map((word) => word.word))
                            : String(seg.text).trim();
                    return {
                        end_ms: endMs,
                        start_ms: startMs,
                        text,
                        video_id: videoId,
                    };
                })
                .filter((seg) => seg.text.length > 0),
            words,
        };
    } catch {
        return { language: null, segments: [], words: [] };
    }
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
    const results: string[] = [];
    for (const inputPath of paths) {
        const resolved = resolve(inputPath);
        if (!(await pathExists(resolved))) {
            continue;
        }
        const stats = await stat(resolved);
        if (stats.isDirectory()) {
            const entries = await readdir(resolved, { withFileTypes: true });
            for (const entry of entries) {
                const childPath = join(resolved, entry.name);
                if (entry.isDirectory()) {
                    const nested = await expandPaths([childPath]);
                    results.push(...nested);
                } else if (entry.isFile()) {
                    results.push(childPath);
                }
            }
        } else if (stats.isFile()) {
            results.push(resolved);
        }
    }
    return Array.from(new Set(results));
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

async function runWithConcurrency<T>(items: T[], limit: number, worker: (item: T) => Promise<void>): Promise<void> {
    let index = 0;
    const workers = Array.from({ length: limit }, async () => {
        while (true) {
            const current = index++;
            if (current >= items.length) {
                return;
            }
            await worker(items[current]);
        }
    });
    await Promise.all(workers);
}
