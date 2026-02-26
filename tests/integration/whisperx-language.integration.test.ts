import { afterEach, describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { runWhisperX } from '../../src/core/whisperx';
import { createFakeWhisperx } from '../helpers/fake-whisperx';

const FIXTURE_WAV = resolve('tests/fixtures/audio/tone-600ms.wav');

let tempDir: string | null = null;
const prevWhisperxBin = process.env.WHISPERX_BIN;

afterEach(async () => {
    if (tempDir) {
        await rm(tempDir, { force: true, recursive: true });
        tempDir = null;
    }
    if (prevWhisperxBin === undefined) {
        delete process.env.WHISPERX_BIN;
    } else {
        process.env.WHISPERX_BIN = prevWhisperxBin;
    }
});

describe('WhisperX language argument handling', () => {
    test('omits --language when language is auto', async () => {
        tempDir = await mkdtemp(join(tmpdir(), 'bpb-whisperx-auto-'));
        const bin = await createFakeWhisperx(tempDir);
        process.env.WHISPERX_BIN = bin;

        const outputBase = join(tempDir, 'out', 'transcript');
        await mkdir(dirname(outputBase), { recursive: true });

        await runWhisperX({
            batchSize: 4,
            computeType: 'int8',
            formats: ['json'],
            language: 'auto',
            modelPath: 'large-v3',
            outputBase,
            wavPath: FIXTURE_WAV,
        });

        const raw = await readFile(`${outputBase}.json`, 'utf-8');
        const parsed = JSON.parse(raw) as {
            params?: { batch_size_arg?: string; compute_type_arg?: string; language_arg?: string };
        };
        expect(parsed.params?.language_arg ?? '').toBe('');
        expect(parsed.params?.compute_type_arg ?? '').toBe('int8');
        expect(parsed.params?.batch_size_arg ?? '').toBe('4');
    });

    test('passes --language when an explicit language is set', async () => {
        tempDir = await mkdtemp(join(tmpdir(), 'bpb-whisperx-explicit-'));
        const bin = await createFakeWhisperx(tempDir);
        process.env.WHISPERX_BIN = bin;

        const outputBase = join(tempDir, 'out', 'transcript');
        await mkdir(dirname(outputBase), { recursive: true });

        await runWhisperX({
            batchSize: 4,
            computeType: 'int8',
            formats: ['json'],
            language: 'en',
            modelPath: 'large-v3',
            outputBase,
            wavPath: FIXTURE_WAV,
        });

        const raw = await readFile(`${outputBase}.json`, 'utf-8');
        const parsed = JSON.parse(raw) as {
            params?: { batch_size_arg?: string; compute_type_arg?: string; language_arg?: string };
        };
        expect(parsed.params?.language_arg ?? '').toBe('en');
        expect(parsed.params?.compute_type_arg ?? '').toBe('int8');
        expect(parsed.params?.batch_size_arg ?? '').toBe('4');
    });
});
