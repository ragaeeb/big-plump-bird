import { Database } from 'bun:sqlite';
import { expect, test } from 'bun:test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { DEFAULT_CONFIG, DEFAULT_ENHANCEMENT_CONFIG, type RunConfig } from '../../src/core/config';
import { runPipeline } from '../../src/core/pipeline';
import { pathExists, runCommand } from '../../src/core/utils';

const runRealE2E = process.env.BPB_RUN_REAL_E2E === '1';
const maybeRealE2E = runRealE2E ? test : test.skip;

const TEST_URL = 'https://www.youtube.com/watch?v=fYMFefUdCTI';
const TEST_VIDEO_ID = 'fYMFefUdCTI';

maybeRealE2E('real e2e: youtube URL via yt-dlp runs full pipeline and stores transcript artifacts', async () => {
    const whisperxBin = process.env.WHISPERX_BIN ?? resolve('.venv-whisperx/bin/whisperx');
    if (!(await pathExists(whisperxBin))) {
        throw new Error(`WhisperX binary not found at ${whisperxBin}. Run: bun run setup-whisperx`);
    }
    process.env.WHISPERX_BIN = whisperxBin;

    const ffmpegCheck = await runCommand('ffmpeg', ['-version']);
    if (ffmpegCheck.exitCode !== 0) {
        throw new Error('ffmpeg is required for real E2E test.');
    }

    const ytdlpCheck = await runCommand('yt-dlp', ['--version']);
    if (ytdlpCheck.exitCode !== 0) {
        throw new Error('yt-dlp is required for real E2E test.');
    }

    const tempDir = await mkdtemp(join(tmpdir(), 'bpb-real-e2e-'));
    const config: RunConfig = {
        ...DEFAULT_CONFIG,
        dataDir: join(tempDir, 'data'),
        dbPath: join(tempDir, 'data', 'bpb.sqlite'),
        enhancement: {
            ...DEFAULT_ENHANCEMENT_CONFIG,
            mode: 'off',
        },
        keepSourceAudio: true,
        keepWav: false,
        language: 'en',
        modelPath: process.env.BPB_REAL_E2E_MODEL ?? 'tiny',
        outputFormats: ['json'],
        whisperxBatchSize: 1,
        whisperxComputeType: 'int8',
    };

    try {
        await runPipeline(config, {
            dryRun: false,
            force: true,
            paths: [],
            urls: [TEST_URL],
        });

        const db = new Database(config.dbPath, { create: false, readonly: true });
        try {
            const transcriptRow = db
                .query('SELECT video_id, language, text, json FROM transcripts WHERE video_id = ? LIMIT 1')
                .get(TEST_VIDEO_ID) as { json: string; language: string; text: string; video_id: string } | null;
            expect(transcriptRow).not.toBeNull();
            expect(transcriptRow?.video_id).toBe(TEST_VIDEO_ID);
            expect((transcriptRow?.text ?? '').length).toBeGreaterThan(0);
            expect((transcriptRow?.language ?? '').length).toBeGreaterThan(0);

            const compact = JSON.parse(transcriptRow?.json ?? '{}') as {
                language?: string;
                words?: Array<{ b?: number; e?: number; w?: string }>;
            };
            expect(typeof compact.language).toBe('string');
            expect(Array.isArray(compact.words)).toBe(true);

            const transcriptArtifact = db
                .query("SELECT uri FROM artifacts WHERE video_id = ? AND kind = 'transcript_json' LIMIT 1")
                .get(TEST_VIDEO_ID) as { uri: string } | null;
            expect(transcriptArtifact).not.toBeNull();
            expect(await pathExists(transcriptArtifact?.uri ?? '')).toBe(true);
            const rawJson = await readFile(transcriptArtifact?.uri ?? '', 'utf-8');
            expect(rawJson.includes('"segments"')).toBe(true);

            const sourceAudioArtifact = db
                .query("SELECT uri FROM artifacts WHERE video_id = ? AND kind = 'source_audio' LIMIT 1")
                .get(TEST_VIDEO_ID) as { uri: string } | null;
            expect(sourceAudioArtifact).not.toBeNull();
            expect(await pathExists(sourceAudioArtifact?.uri ?? '')).toBe(true);
        } finally {
            db.close(false);
        }
    } finally {
        await rm(tempDir, { force: true, recursive: true });
    }
});
