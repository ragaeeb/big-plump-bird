import { afterEach, describe, expect, it, spyOn } from 'bun:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as utils from '../../src/core/utils';
import { ensureWhisperXAvailable, runWhisperX } from '../../src/core/whisperx';

const tempDirs: string[] = [];

afterEach(async () => {
    while (tempDirs.length > 0) {
        const dir = tempDirs.pop();
        if (!dir) {
            continue;
        }
        await rm(dir, { force: true, recursive: true });
    }
    delete process.env.WHISPERX_BIN;
});

async function makeTempDir(): Promise<string> {
    const dir = await mkdtemp(join(tmpdir(), 'bpb-whisperx-test-'));
    tempDirs.push(dir);
    return dir;
}

// ---------------------------------------------------------------------------
// ensureWhisperXAvailable
// ---------------------------------------------------------------------------
describe('ensureWhisperXAvailable', () => {
    it('resolves when one candidate returns exit code 0', async () => {
        const spy = spyOn(utils, 'runCommand').mockResolvedValue({ exitCode: 0, stderr: '', stdout: 'whisperx 3.0' });
        process.env.WHISPERX_BIN = 'fake-whisperx';
        await expect(ensureWhisperXAvailable()).resolves.toBeUndefined();
        spy.mockRestore();
    });

    it('throws when all candidates fail with non-zero exit code', async () => {
        const spy = spyOn(utils, 'runCommand').mockResolvedValue({ exitCode: 1, stderr: 'not found', stdout: '' });
        process.env.WHISPERX_BIN = 'fake-whisperx';
        await expect(ensureWhisperXAvailable()).rejects.toThrow('whisperx is not available');
        spy.mockRestore();
    });

    it('throws when all candidates throw errors (command not found)', async () => {
        const spy = spyOn(utils, 'runCommand').mockRejectedValue(new Error('spawn ENOENT'));
        process.env.WHISPERX_BIN = 'missing-whisperx';
        await expect(ensureWhisperXAvailable()).rejects.toThrow('whisperx is not available');
        spy.mockRestore();
    });

    it('includes detail from stderr in error message when candidate fails', async () => {
        const spy = spyOn(utils, 'runCommand').mockResolvedValue({
            exitCode: 1,
            stderr: 'ImportError: no module',
            stdout: '',
        });
        process.env.WHISPERX_BIN = 'fake-bin';
        await expect(ensureWhisperXAvailable()).rejects.toThrow('ImportError');
        spy.mockRestore();
    });
});

// ---------------------------------------------------------------------------
// runWhisperX
// ---------------------------------------------------------------------------
describe('runWhisperX', () => {
    it('throws when all whisperx candidates fail', async () => {
        process.env.WHISPERX_BIN = 'fake-whisperx';
        const spy = spyOn(utils, 'runCommand').mockResolvedValue({ exitCode: 1, stderr: 'error', stdout: '' });

        const dir = await makeTempDir();
        await expect(
            runWhisperX({
                batchSize: 1,
                computeType: 'float32',
                formats: ['json'],
                language: 'en',
                modelPath: 'turbo',
                outputBase: join(dir, 'out', 'transcript'),
                wavPath: join(dir, 'audio.wav'),
            }),
        ).rejects.toThrow('Failed to run whisperx');

        spy.mockRestore();
    });

    it('returns files that exist after successful run', async () => {
        process.env.WHISPERX_BIN = 'fake-whisperx';
        const dir = await makeTempDir();
        const outDir = join(dir, 'out');

        // Simulate whisperx writing output files named after the wav stem
        const spy = spyOn(utils, 'runCommand').mockImplementation(async () => {
            const { mkdir, writeFile: wf } = await import('node:fs/promises');
            await mkdir(outDir, { recursive: true });
            await wf(join(outDir, 'audio.json'), '{}');
            await wf(join(outDir, 'audio.txt'), 'hello');
            return { exitCode: 0, stderr: '', stdout: '' };
        });

        const result = await runWhisperX({
            batchSize: 1,
            computeType: 'float32',
            formats: ['json', 'txt'],
            language: 'en',
            modelPath: 'turbo',
            outputBase: join(outDir, 'transcript'),
            wavPath: join(dir, 'audio.wav'),
        });

        expect(result.outputBase).toBe(join(outDir, 'transcript'));
        // Files should be renamed from audio.* to transcript.*
        expect(result.files.some((f) => f.endsWith('transcript.json'))).toBe(true);
        expect(result.files.some((f) => f.endsWith('transcript.txt'))).toBe(true);

        spy.mockRestore();
    });

    it('skips language arg when language is "auto"', async () => {
        process.env.WHISPERX_BIN = 'fake-whisperx';
        const dir = await makeTempDir();

        const spy = spyOn(utils, 'runCommand').mockResolvedValue({ exitCode: 0, stderr: '', stdout: '' });

        await runWhisperX({
            batchSize: 1,
            computeType: 'float32',
            formats: ['json'],
            language: 'auto',
            modelPath: 'turbo',
            outputBase: join(dir, 'out', 'transcript'),
            wavPath: join(dir, 'audio.wav'),
        }).catch(() => {}); // may throw due to missing files, that's fine

        const calls = spy.mock.calls;
        if (calls.length > 0) {
            const args = calls[0][1] as string[];
            expect(args).not.toContain('--language');
        }

        spy.mockRestore();
    });

    it('skips language arg when language is empty string', async () => {
        process.env.WHISPERX_BIN = 'fake-whisperx';
        const dir = await makeTempDir();

        const spy = spyOn(utils, 'runCommand').mockResolvedValue({ exitCode: 0, stderr: '', stdout: '' });

        await runWhisperX({
            batchSize: 1,
            computeType: 'float32',
            formats: ['json'],
            language: '',
            modelPath: 'turbo',
            outputBase: join(dir, 'out', 'transcript'),
            wavPath: join(dir, 'audio.wav'),
        }).catch(() => {});

        const calls = spy.mock.calls;
        if (calls.length > 0) {
            const args = calls[0][1] as string[];
            expect(args).not.toContain('--language');
        }

        spy.mockRestore();
    });

    it('normalises json-full to json format', async () => {
        process.env.WHISPERX_BIN = 'fake-whisperx';
        const dir = await makeTempDir();
        const outDir = join(dir, 'out');

        const spy = spyOn(utils, 'runCommand').mockImplementation(async () => {
            const { mkdir, writeFile: wf } = await import('node:fs/promises');
            await mkdir(outDir, { recursive: true });
            await wf(join(outDir, 'audio.json'), '{}');
            return { exitCode: 0, stderr: '', stdout: '' };
        });

        const result = await runWhisperX({
            batchSize: 1,
            computeType: 'float32',
            formats: ['json-full'],
            language: 'en',
            modelPath: 'turbo',
            outputBase: join(outDir, 'transcript'),
            wavPath: join(dir, 'audio.wav'),
        });

        expect(result.files.some((f) => f.endsWith('.json'))).toBe(true);

        spy.mockRestore();
    });

    it('removes output files not in requested formats', async () => {
        process.env.WHISPERX_BIN = 'fake-whisperx';
        const dir = await makeTempDir();
        const outDir = join(dir, 'out');

        const spy = spyOn(utils, 'runCommand').mockImplementation(async () => {
            const { mkdir, writeFile: wf } = await import('node:fs/promises');
            await mkdir(outDir, { recursive: true });
            // whisperx writes both json and txt
            await wf(join(outDir, 'audio.json'), '{}');
            await wf(join(outDir, 'audio.txt'), 'text');
            return { exitCode: 0, stderr: '', stdout: '' };
        });

        // Only request json
        const result = await runWhisperX({
            batchSize: 1,
            computeType: 'float32',
            formats: ['json'],
            language: 'en',
            modelPath: 'turbo',
            outputBase: join(outDir, 'transcript'),
            wavPath: join(dir, 'audio.wav'),
        });

        // txt should not be in files
        expect(result.files.every((f) => !f.endsWith('.txt'))).toBe(true);
        expect(result.files.some((f) => f.endsWith('.json'))).toBe(true);

        spy.mockRestore();
    });
});
