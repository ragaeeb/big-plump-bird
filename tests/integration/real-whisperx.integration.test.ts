import { expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { ensureDir, pathExists } from '../../src/core/utils';
import { ensureWhisperXAvailable, runWhisperX } from '../../src/core/whisperx';

const runReal = process.env.BPB_RUN_REAL_INTEGRATION === '1';
const maybeRealTest = runReal ? test : test.skip;

maybeRealTest('real whisperx smoke test runs on tiny fixture audio', async () => {
    const whisperxBin = process.env.WHISPERX_BIN ?? resolve('.venv-whisperx/bin/whisperx');
    if (!(await pathExists(whisperxBin))) {
        throw new Error(`WhisperX binary not found at ${whisperxBin}. Run: bun run setup-whisperx`);
    }
    process.env.WHISPERX_BIN = whisperxBin;

    await ensureWhisperXAvailable();

    const tempDir = await mkdtemp(join(tmpdir(), 'bpb-real-it-'));
    const outputBase = join(tempDir, 'transcript');
    const wavPath = resolve('tests/fixtures/audio/silence-600ms.wav');
    const modelPath = process.env.BPB_REAL_TEST_MODEL ?? 'tiny';

    try {
        await ensureDir(dirname(outputBase));
        const result = await runWhisperX({
            batchSize: 4,
            computeType: 'int8',
            formats: ['json'],
            language: 'auto',
            modelPath,
            outputBase,
            wavPath,
        });
        expect(result.files.some((file) => file.endsWith('.json'))).toBe(true);
        expect(await pathExists(`${outputBase}.json`)).toBe(true);
    } finally {
        await rm(tempDir, { force: true, recursive: true });
    }
});
