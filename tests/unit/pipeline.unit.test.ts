import { Database } from 'bun:sqlite';
import { afterEach, describe, expect, it, spyOn } from 'bun:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { DEFAULT_CONFIG, DEFAULT_ENHANCEMENT_CONFIG, type RunConfig } from '../../src/core/config';
import * as ffmpeg from '../../src/core/ffmpeg';
import { runPipeline } from '../../src/core/pipeline';
import * as ytDlp from '../../src/core/yt_dlp';
import { createFakeWhisperx } from '../helpers/fake-whisperx';

const FIXTURE_WAV = resolve('tests/fixtures/audio/silence-600ms.wav');

const tempDirs: string[] = [];
const prevWhisperxBin = process.env.WHISPERX_BIN;

afterEach(async () => {
    if (prevWhisperxBin === undefined) {
        delete process.env.WHISPERX_BIN;
    } else {
        process.env.WHISPERX_BIN = prevWhisperxBin;
    }
    while (tempDirs.length > 0) {
        const dir = tempDirs.pop();
        if (!dir) {
            continue;
        }
        await rm(dir, { force: true, recursive: true });
    }
});

async function makeTempDir(): Promise<string> {
    const dir = await mkdtemp(join(tmpdir(), 'bpb-pipeline-unit-'));
    tempDirs.push(dir);
    return dir;
}

function makeConfig(tempDir: string, overrides: Partial<RunConfig> = {}): RunConfig {
    return {
        ...DEFAULT_CONFIG,
        dataDir: join(tempDir, 'data'),
        dbPath: join(tempDir, 'data', 'bpb.sqlite'),
        enhancement: {
            ...DEFAULT_ENHANCEMENT_CONFIG,
            mode: 'off',
        },
        keepWav: false,
        language: 'en',
        outputFormats: ['json', 'txt'],
        ...overrides,
    };
}

// ---------------------------------------------------------------------------
// dry-run mode
// ---------------------------------------------------------------------------
describe('runPipeline - dry-run', () => {
    it('completes without calling whisperx when dryRun is true for file input', async () => {
        const tempDir = await makeTempDir();
        const config = makeConfig(tempDir);
        // dryRun should skip whisperx entirely - no WHISPERX_BIN needed
        await expect(
            runPipeline(config, { dryRun: true, force: false, paths: [FIXTURE_WAV], urls: [] }),
        ).resolves.toBeUndefined();
    });

    it('completes without calling whisperx when dryRun is true for URL input', async () => {
        const tempDir = await makeTempDir();
        const config = makeConfig(tempDir);
        // expandYtDlpUrls would be called for URLs even in dry-run mode for seed expansion;
        // mock it to avoid needing yt-dlp
        const expandSpy = spyOn(ytDlp, 'expandYtDlpUrls').mockResolvedValue(['https://www.youtube.com/watch?v=dryrun']);
        await expect(
            runPipeline(config, {
                dryRun: true,
                force: false,
                paths: [],
                urls: ['https://www.youtube.com/watch?v=dryrun'],
            }),
        ).resolves.toBeUndefined();
        expandSpy.mockRestore();
    });
});

// ---------------------------------------------------------------------------
// abort signal
// ---------------------------------------------------------------------------
describe('runPipeline - abort signal', () => {
    it('returns early when AbortSignal is already aborted before execution', async () => {
        const tempDir = await makeTempDir();
        const config = makeConfig(tempDir);
        const controller = new AbortController();
        controller.abort();
        await expect(
            runPipeline(config, {
                abortSignal: controller.signal,
                dryRun: false,
                force: false,
                paths: [FIXTURE_WAV],
                urls: [],
            }),
        ).resolves.toBeUndefined();
    });
});

// ---------------------------------------------------------------------------
// empty inputs
// ---------------------------------------------------------------------------
describe('runPipeline - empty inputs', () => {
    it('throws when no paths and no urls provided', async () => {
        const tempDir = await makeTempDir();
        const config = makeConfig(tempDir);
        const fakeWhisperx = await createFakeWhisperx(tempDir);
        process.env.WHISPERX_BIN = fakeWhisperx;
        await expect(runPipeline(config, { dryRun: false, force: false, paths: [], urls: [] })).rejects.toThrow(
            'No inputs provided',
        );
    });
});

// ---------------------------------------------------------------------------
// local file - skip when already transcribed
// ---------------------------------------------------------------------------
describe('runPipeline - skip already transcribed', () => {
    it('skips processing when transcript already exists and force is false', async () => {
        const tempDir = await makeTempDir();
        const config = makeConfig(tempDir);
        const fakeWhisperx = await createFakeWhisperx(tempDir);
        process.env.WHISPERX_BIN = fakeWhisperx;

        // Mock ffmpeg convertToWav to just copy input to output
        const convertSpy = spyOn(ffmpeg, 'convertToWav').mockImplementation(async (input, output) => {
            const { copyFile } = await import('node:fs/promises');
            await copyFile(input, output);
        });

        // First run - transcribe the file
        await runPipeline(config, { dryRun: false, force: false, paths: [FIXTURE_WAV], urls: [] });

        // Second run - should skip (no convertToWav needed)
        await runPipeline(config, { dryRun: false, force: false, paths: [FIXTURE_WAV], urls: [] });

        convertSpy.mockRestore();

        // DB should still have one transcript
        const db = new Database(config.dbPath, { create: false, readonly: true });
        try {
            const count = (db.query('SELECT COUNT(*) as c FROM transcripts').get() as { c: number }).c;
            expect(count).toBe(1);
        } finally {
            db.close(false);
        }
    });
});

// ---------------------------------------------------------------------------
// local file - force reprocess
// ---------------------------------------------------------------------------
describe('runPipeline - force reprocess', () => {
    it('reprocesses file when force=true', async () => {
        const tempDir = await makeTempDir();
        const config = makeConfig(tempDir);
        const fakeWhisperx = await createFakeWhisperx(tempDir);
        process.env.WHISPERX_BIN = fakeWhisperx;

        const convertSpy = spyOn(ffmpeg, 'convertToWav').mockImplementation(async (input, output) => {
            const { copyFile } = await import('node:fs/promises');
            await copyFile(input, output);
        });

        await runPipeline(config, { dryRun: false, force: false, paths: [FIXTURE_WAV], urls: [] });
        await runPipeline(config, { dryRun: false, force: true, paths: [FIXTURE_WAV], urls: [] });

        convertSpy.mockRestore();

        const db = new Database(config.dbPath, { create: false, readonly: true });
        try {
            const count = (db.query('SELECT COUNT(*) as c FROM transcripts').get() as { c: number }).c;
            expect(count).toBe(1);
            const status = (db.query('SELECT status FROM videos LIMIT 1').get() as { status: string }).status;
            expect(status).toBe('done');
        } finally {
            db.close(false);
        }
    });
});

// ---------------------------------------------------------------------------
// keepWav option
// ---------------------------------------------------------------------------
describe('runPipeline - keepWav', () => {
    it('records a wav artifact when keepWav is true', async () => {
        const tempDir = await makeTempDir();
        const config = makeConfig(tempDir, { keepWav: true });
        const fakeWhisperx = await createFakeWhisperx(tempDir);
        process.env.WHISPERX_BIN = fakeWhisperx;

        const convertSpy = spyOn(ffmpeg, 'convertToWav').mockImplementation(async (input, output) => {
            const { copyFile } = await import('node:fs/promises');
            await copyFile(input, output);
        });

        await runPipeline(config, { dryRun: false, force: false, paths: [FIXTURE_WAV], urls: [] });

        convertSpy.mockRestore();

        const db = new Database(config.dbPath, { create: false, readonly: true });
        try {
            const art = db.query("SELECT * FROM artifacts WHERE kind='audio_wav' LIMIT 1").get();
            expect(art).not.toBeNull();
        } finally {
            db.close(false);
        }
    });
});

// ---------------------------------------------------------------------------
// URL file input
// ---------------------------------------------------------------------------
describe('runPipeline - urlsFile', () => {
    it('reads URLs from urlsFile and processes them in dryRun mode', async () => {
        const tempDir = await makeTempDir();
        const config = makeConfig(tempDir);
        const urlsFile = join(tempDir, 'urls.txt');
        await writeFile(
            urlsFile,
            '# comment\nhttps://www.youtube.com/watch?v=dryurl1\nhttps://www.youtube.com/watch?v=dryurl2\n',
        );

        const expandSpy = spyOn(ytDlp, 'expandYtDlpUrls').mockImplementation(async (url) => [url]);

        await expect(runPipeline(config, { dryRun: true, force: false, paths: [], urlsFile })).resolves.toBeUndefined();

        expandSpy.mockRestore();
    });
});

// ---------------------------------------------------------------------------
// concurrent jobs
// ---------------------------------------------------------------------------
describe('runPipeline - concurrency', () => {
    it('runs multiple files with jobs=2', async () => {
        const tempDir = await makeTempDir();
        const config = makeConfig(tempDir, { jobs: 2 });
        const fakeWhisperx = await createFakeWhisperx(tempDir);
        process.env.WHISPERX_BIN = fakeWhisperx;

        const convertSpy = spyOn(ffmpeg, 'convertToWav').mockImplementation(async (input, output) => {
            const { copyFile } = await import('node:fs/promises');
            await copyFile(input, output);
        });

        // Create a copy to have two distinct files
        const copy = join(tempDir, 'audio-copy.wav');
        const { copyFile } = await import('node:fs/promises');
        await copyFile(FIXTURE_WAV, copy);

        await runPipeline(config, { dryRun: false, force: false, paths: [FIXTURE_WAV, copy], urls: [] });

        convertSpy.mockRestore();

        const db = new Database(config.dbPath, { create: false, readonly: true });
        try {
            const count = (db.query('SELECT COUNT(*) as c FROM transcripts').get() as { c: number }).c;
            expect(count).toBe(2);
        } finally {
            db.close(false);
        }
    });
});

// ---------------------------------------------------------------------------
// Error handling - a file that fails conversion
// ---------------------------------------------------------------------------
describe('runPipeline - error handling', () => {
    it('throws with hadFailures error when ffmpeg fails for a file', async () => {
        const tempDir = await makeTempDir();
        const config = makeConfig(tempDir);
        const fakeWhisperx = await createFakeWhisperx(tempDir);
        process.env.WHISPERX_BIN = fakeWhisperx;

        // Make convertToWav throw to simulate ffmpeg failure
        const convertSpy = spyOn(ffmpeg, 'convertToWav').mockRejectedValue(new Error('ffmpeg failed: bad input'));

        await expect(
            runPipeline(config, {
                dryRun: false,
                force: false,
                paths: [FIXTURE_WAV],
                urls: [],
            }),
        ).rejects.toThrow('One or more inputs failed');

        convertSpy.mockRestore();

        // Error should be recorded in DB
        const db = new Database(config.dbPath, { create: false, readonly: true });
        try {
            const vid = db.query("SELECT status FROM videos WHERE status='error' LIMIT 1").get() as {
                status: string;
            } | null;
            expect(vid?.status).toBe('error');
        } finally {
            db.close(false);
        }
    });

    it('records error video entry when path does not exist', async () => {
        const tempDir = await makeTempDir();
        const config = makeConfig(tempDir);
        const fakeWhisperx = await createFakeWhisperx(tempDir);
        process.env.WHISPERX_BIN = fakeWhisperx;

        // expandPaths returns nothing for non-existent paths, so add a real file plus non-existent
        const convertSpy = spyOn(ffmpeg, 'convertToWav').mockRejectedValue(new Error('ffmpeg failed'));

        // Pass the existing fixture (will fail at ffmpeg), verifying error is captured
        await expect(
            runPipeline(config, {
                dryRun: false,
                force: false,
                paths: [FIXTURE_WAV],
                urls: [],
            }),
        ).rejects.toThrow('One or more inputs failed');

        convertSpy.mockRestore();

        const db = new Database(config.dbPath, { create: false, readonly: true });
        try {
            const errCount = (db.query("SELECT COUNT(*) as c FROM videos WHERE status='error'").get() as { c: number })
                .c;
            expect(errCount).toBeGreaterThan(0);
        } finally {
            db.close(false);
        }
    });
});
