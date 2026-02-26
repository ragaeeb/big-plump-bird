import { Database } from 'bun:sqlite';
import { afterEach, expect, test } from 'bun:test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { DEFAULT_CONFIG, DEFAULT_ENHANCEMENT_CONFIG, type RunConfig } from '../../src/core/config';
import { runPipeline } from '../../src/core/pipeline';
import { createFakeWhisperx } from '../helpers/fake-whisperx';

const FIXTURE_WAV = resolve('tests/fixtures/audio/silence-600ms.wav');

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

test('runs local-file pipeline end-to-end with auto language and writes compact transcript JSON', async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'bpb-pipeline-it-'));
    const fakeWhisperx = await createFakeWhisperx(tempDir);
    process.env.WHISPERX_BIN = fakeWhisperx;

    const config: RunConfig = {
        ...DEFAULT_CONFIG,
        dataDir: join(tempDir, 'data'),
        dbPath: join(tempDir, 'data', 'bpb.sqlite'),
        enhancement: {
            ...DEFAULT_ENHANCEMENT_CONFIG,
            mode: 'off',
        },
        keepWav: false,
        language: 'auto',
        outputFormats: ['json'],
    };

    await runPipeline(config, {
        dryRun: false,
        force: true,
        paths: [FIXTURE_WAV],
        urls: [],
    });

    const db = new Database(config.dbPath, { create: false, readonly: true });
    try {
        const transcriptArtifact = db
            .query("SELECT uri FROM artifacts WHERE kind = 'transcript_json' LIMIT 1")
            .get() as { uri: string } | null;
        expect(transcriptArtifact).not.toBeNull();
        const rawWhisperJson = await readFile(transcriptArtifact?.uri ?? '', 'utf-8');
        const whisperJson = JSON.parse(rawWhisperJson) as {
            params?: { batch_size_arg?: string; compute_type_arg?: string; language_arg?: string };
        };
        expect(whisperJson.params?.language_arg ?? '').toBe('');
        expect(whisperJson.params?.compute_type_arg ?? '').toBe('float32');
        expect(whisperJson.params?.batch_size_arg ?? '').toBe('1');

        const transcript = db.query('SELECT language, text, json FROM transcripts LIMIT 1').get() as {
            json: string;
            language: string;
            text: string;
        } | null;
        expect(transcript).not.toBeNull();
        expect(transcript?.language).toBe('ar');
        expect(transcript?.text).toContain('Assalamu');

        const compact = JSON.parse(transcript?.json ?? '{}') as {
            language?: string;
            words?: Array<{ b?: number; e?: number; score?: number; w?: string }>;
        };
        expect(compact.language).toBe('ar');
        expect(Array.isArray(compact.words)).toBe(true);
        expect(compact.words?.length).toBe(2);
        expect(compact.words?.[0]).toEqual({ b: 0, e: 300, w: 'Assalamu' });
        expect('score' in (compact.words?.[0] ?? {})).toBe(false);
    } finally {
        db.close(false);
    }
});
