import { afterEach, describe, expect, it } from 'bun:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DEFAULT_CONFIG, DEFAULT_ENHANCEMENT_CONFIG, loadConfig } from '../../src/core/config';

const tempDirs: string[] = [];

afterEach(async () => {
    while (tempDirs.length > 0) {
        const dir = tempDirs.pop();
        if (!dir) {
            continue;
        }
        await rm(dir, { force: true, recursive: true });
    }
});

async function makeTempDir(): Promise<string> {
    const dir = await mkdtemp(join(tmpdir(), 'bpb-config-test-'));
    tempDirs.push(dir);
    return dir;
}

describe('loadConfig', () => {
    it('returns DEFAULT_CONFIG (with resolved paths) when config file does not exist', async () => {
        const dir = await makeTempDir();
        const nonExistent = join(dir, 'no-such-config.json');
        const config = await loadConfig(nonExistent);
        // Should return defaults with paths resolved from the config dir
        expect(config.language).toBe(DEFAULT_CONFIG.language);
        expect(config.jobs).toBe(DEFAULT_CONFIG.jobs);
        expect(config.outputFormats).toEqual(DEFAULT_CONFIG.outputFormats);
        expect(config.enhancement.mode).toBe('off');
    });

    it('merges partial config over defaults', async () => {
        const dir = await makeTempDir();
        const configPath = join(dir, 'config.json');
        await writeFile(configPath, JSON.stringify({ jobs: 2, language: 'ar' }));
        const config = await loadConfig(configPath);
        expect(config.language).toBe('ar');
        expect(config.jobs).toBe(2);
        expect(config.modelPath).toBe(DEFAULT_CONFIG.modelPath);
    });

    it('merges partial enhancement config over defaults', async () => {
        const dir = await makeTempDir();
        const configPath = join(dir, 'config.json');
        await writeFile(configPath, JSON.stringify({ enhancement: { mode: 'auto', snrSkipThresholdDb: 20 } }));
        const config = await loadConfig(configPath);
        expect(config.enhancement.mode).toBe('auto');
        expect(config.enhancement.snrSkipThresholdDb).toBe(20);
        expect(config.enhancement.attenLimDb).toBe(DEFAULT_ENHANCEMENT_CONFIG.attenLimDb);
    });

    it('uses config-supplied outputFormats', async () => {
        const dir = await makeTempDir();
        const configPath = join(dir, 'config.json');
        await writeFile(configPath, JSON.stringify({ outputFormats: ['txt'] }));
        const config = await loadConfig(configPath);
        expect(config.outputFormats).toEqual(['txt']);
    });

    it('falls back to DEFAULT outputFormats when not supplied in config', async () => {
        const dir = await makeTempDir();
        const configPath = join(dir, 'config.json');
        await writeFile(configPath, JSON.stringify({ language: 'en' }));
        const config = await loadConfig(configPath);
        expect(config.outputFormats).toEqual(DEFAULT_CONFIG.outputFormats);
    });

    describe('validateConfig - invalid dbPath', () => {
        it('throws when dbPath resolves to whitespace-only', async () => {
            const dir = await makeTempDir();
            const configPath = join(dir, 'config.json');
            // Supply an absolute path that is whitespace-only so resolveFromConfigDir returns it as-is
            // but the trim check catches it. We directly pass a trimmed-empty absolute path.
            // The easiest way: patch the parsed object by providing a non-empty string that will
            // be validated as empty after trim. But resolveFromConfigDir passes len=0 strings through.
            // So provide an empty string directly (isAbsolute('') = false, len=0 → returned as-is).
            await writeFile(configPath, JSON.stringify({ dbPath: '' }));
            await expect(loadConfig(configPath)).rejects.toThrow('dbPath is required');
        });
    });

    describe('validateConfig - invalid dataDir', () => {
        it('throws when dataDir is empty string', async () => {
            const dir = await makeTempDir();
            const configPath = join(dir, 'config.json');
            // Empty string: resolveFromConfigDir returns '' as-is, trim check fails
            await writeFile(configPath, JSON.stringify({ dataDir: '', dbPath: '/tmp/test.sqlite' }));
            await expect(loadConfig(configPath)).rejects.toThrow('dataDir is required');
        });
    });

    describe('validateConfig - invalid modelPath', () => {
        it('throws when modelPath is whitespace', async () => {
            const dir = await makeTempDir();
            const configPath = join(dir, 'config.json');
            // Provide a non-empty but whitespace-only absolute path to bypass resolveFromConfigDir
            // then the trim().length === 0 check catches it
            await writeFile(configPath, JSON.stringify({ modelPath: '   ' }));
            await expect(loadConfig(configPath)).rejects.toThrow('modelPath is required');
        });
    });

    describe('validateConfig - invalid whisperxComputeType', () => {
        it('throws when whisperxComputeType is not one of the allowed values', async () => {
            const dir = await makeTempDir();
            const configPath = join(dir, 'config.json');
            await writeFile(configPath, JSON.stringify({ whisperxComputeType: 'bfloat16' }));
            await expect(loadConfig(configPath)).rejects.toThrow('whisperxComputeType must be one of');
        });
    });

    describe('validateConfig - invalid jobs', () => {
        it('throws when jobs < 1', async () => {
            const dir = await makeTempDir();
            const configPath = join(dir, 'config.json');
            await writeFile(configPath, JSON.stringify({ jobs: 0 }));
            await expect(loadConfig(configPath)).rejects.toThrow('jobs must be a number >= 1');
        });

        it('throws when jobs is not a number', async () => {
            const dir = await makeTempDir();
            const configPath = join(dir, 'config.json');
            await writeFile(configPath, JSON.stringify({ jobs: 'lots' }));
            await expect(loadConfig(configPath)).rejects.toThrow('jobs must be a number >= 1');
        });
    });

    describe('validateConfig - invalid whisperxBatchSize', () => {
        it('throws when whisperxBatchSize < 1', async () => {
            const dir = await makeTempDir();
            const configPath = join(dir, 'config.json');
            await writeFile(configPath, JSON.stringify({ whisperxBatchSize: 0 }));
            await expect(loadConfig(configPath)).rejects.toThrow('whisperxBatchSize must be a number >= 1');
        });
    });

    describe('validateConfig - invalid outputFormats', () => {
        it('throws when outputFormats is empty array', async () => {
            const dir = await makeTempDir();
            const configPath = join(dir, 'config.json');
            await writeFile(configPath, JSON.stringify({ outputFormats: [] }));
            await expect(loadConfig(configPath)).rejects.toThrow('outputFormats must be a non-empty array');
        });
    });

    describe('validateConfig - invalid enhancement.mode', () => {
        it('throws when enhancement.mode is invalid', async () => {
            const dir = await makeTempDir();
            const configPath = join(dir, 'config.json');
            await writeFile(configPath, JSON.stringify({ enhancement: { mode: 'turbo' } }));
            await expect(loadConfig(configPath)).rejects.toThrow('enhancement.mode must be one of');
        });
    });

    describe('validateConfig - invalid enhancement.sourceClass', () => {
        it('throws when enhancement.sourceClass is invalid', async () => {
            const dir = await makeTempDir();
            const configPath = join(dir, 'config.json');
            await writeFile(configPath, JSON.stringify({ enhancement: { sourceClass: 'satellite' } }));
            await expect(loadConfig(configPath)).rejects.toThrow('enhancement.sourceClass must be one of');
        });
    });

    describe('validateConfig - invalid enhancement.dereverbMode', () => {
        it('throws when enhancement.dereverbMode is invalid', async () => {
            const dir = await makeTempDir();
            const configPath = join(dir, 'config.json');
            await writeFile(configPath, JSON.stringify({ enhancement: { dereverbMode: 'light' } }));
            await expect(loadConfig(configPath)).rejects.toThrow('enhancement.dereverbMode must be one of');
        });
    });

    describe('validateConfig - invalid enhancement.failPolicy', () => {
        it('throws when enhancement.failPolicy is invalid', async () => {
            const dir = await makeTempDir();
            const configPath = join(dir, 'config.json');
            await writeFile(configPath, JSON.stringify({ enhancement: { failPolicy: 'retry' } }));
            await expect(loadConfig(configPath)).rejects.toThrow('enhancement.failPolicy must be one of');
        });
    });

    describe('validateConfig - invalid enhancement.attenLimDb', () => {
        it('throws when enhancement.attenLimDb is not finite', async () => {
            const dir = await makeTempDir();
            const configPath = join(dir, 'config.json');
            await writeFile(configPath, JSON.stringify({ enhancement: { attenLimDb: null } }));
            await expect(loadConfig(configPath)).rejects.toThrow('enhancement.attenLimDb must be finite');
        });
    });

    describe('validateConfig - invalid enhancement.snrSkipThresholdDb', () => {
        it('throws when enhancement.snrSkipThresholdDb is not finite', async () => {
            const dir = await makeTempDir();
            const configPath = join(dir, 'config.json');
            await writeFile(configPath, JSON.stringify({ enhancement: { snrSkipThresholdDb: 'high' } }));
            await expect(loadConfig(configPath)).rejects.toThrow('enhancement.snrSkipThresholdDb must be finite');
        });
    });

    describe('validateConfig - invalid enhancement.vadThreshold', () => {
        it('throws when enhancement.vadThreshold is out of range', async () => {
            const dir = await makeTempDir();
            const configPath = join(dir, 'config.json');
            await writeFile(configPath, JSON.stringify({ enhancement: { vadThreshold: 1.5 } }));
            await expect(loadConfig(configPath)).rejects.toThrow('enhancement.vadThreshold must be between 0 and 1');
        });

        it('throws when enhancement.vadThreshold is negative', async () => {
            const dir = await makeTempDir();
            const configPath = join(dir, 'config.json');
            await writeFile(configPath, JSON.stringify({ enhancement: { vadThreshold: -0.1 } }));
            await expect(loadConfig(configPath)).rejects.toThrow('enhancement.vadThreshold must be between 0 and 1');
        });
    });

    describe('validateConfig - invalid enhancement.minSilenceMs', () => {
        it('throws when enhancement.minSilenceMs is negative', async () => {
            const dir = await makeTempDir();
            const configPath = join(dir, 'config.json');
            await writeFile(configPath, JSON.stringify({ enhancement: { minSilenceMs: -1 } }));
            await expect(loadConfig(configPath)).rejects.toThrow('enhancement.minSilenceMs must be >= 0');
        });
    });

    describe('validateConfig - invalid enhancement.maxRegimes', () => {
        it('throws when enhancement.maxRegimes is < 1', async () => {
            const dir = await makeTempDir();
            const configPath = join(dir, 'config.json');
            await writeFile(configPath, JSON.stringify({ enhancement: { maxRegimes: 0 } }));
            await expect(loadConfig(configPath)).rejects.toThrow('enhancement.maxRegimes must be >= 1');
        });
    });

    it('clamps jobs to integer', async () => {
        const dir = await makeTempDir();
        const configPath = join(dir, 'config.json');
        await writeFile(configPath, JSON.stringify({ jobs: 1.7 }));
        const config = await loadConfig(configPath);
        expect(config.jobs).toBe(2);
    });

    it('clamps whisperxBatchSize to integer', async () => {
        const dir = await makeTempDir();
        const configPath = join(dir, 'config.json');
        await writeFile(configPath, JSON.stringify({ whisperxBatchSize: 3.2 }));
        const config = await loadConfig(configPath);
        expect(config.whisperxBatchSize).toBe(3);
    });
});
