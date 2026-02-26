import { afterEach, describe, expect, it } from 'bun:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadConfig } from '../../src/core/config';

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

describe('config path resolution', () => {
    it('should resolve relative paths from the config file directory', async () => {
        const dir = await mkdtemp(join(tmpdir(), 'bpb-config-paths-'));
        tempDirs.push(dir);

        const configPath = join(dir, 'config.json');
        await writeFile(
            configPath,
            JSON.stringify({
                dataDir: 'data',
                dbPath: 'data/custom.sqlite',
                enhancement: {
                    deepFilterBin: 'tools/enhance/bin/deep-filter',
                    pythonBin: 'tools/enhance/.venv/bin/python3',
                },
            }),
        );

        const config = await loadConfig(configPath);

        expect(config.dataDir).toBe(join(dir, 'data'));
        expect(config.dbPath).toBe(join(dir, 'data/custom.sqlite'));
        expect(config.enhancement.deepFilterBin).toBe(join(dir, 'tools/enhance/bin/deep-filter'));
        expect(config.enhancement.pythonBin).toBe(join(dir, 'tools/enhance/.venv/bin/python3'));
    });

    it('should keep absolute paths unchanged', async () => {
        const dir = await mkdtemp(join(tmpdir(), 'bpb-config-paths-'));
        tempDirs.push(dir);

        const absDataDir = join(dir, 'abs-data');
        const absDbPath = join(dir, 'abs-data', 'bpb.sqlite');
        const absPythonBin = join(dir, 'venv', 'bin', 'python3');
        const absDeepFilterBin = join(dir, 'enhance', 'bin', 'deep-filter');

        const configPath = join(dir, 'config.json');
        await writeFile(
            configPath,
            JSON.stringify({
                dataDir: absDataDir,
                dbPath: absDbPath,
                enhancement: {
                    deepFilterBin: absDeepFilterBin,
                    pythonBin: absPythonBin,
                },
            }),
        );

        const config = await loadConfig(configPath);

        expect(config.dataDir).toBe(absDataDir);
        expect(config.dbPath).toBe(absDbPath);
        expect(config.enhancement.deepFilterBin).toBe(absDeepFilterBin);
        expect(config.enhancement.pythonBin).toBe(absPythonBin);
    });
});
