import { describe, expect, it } from 'bun:test';
import { resolve } from 'node:path';
import { DEFAULT_CONFIG } from '../../src/core/config';
import {
    applyJobOverrides,
    classifyJobInput,
    normalizeOutputFormats,
    type TranscriptionJob,
    toRunOptions,
} from '../../src/web-api/job-logic';

describe('job-logic', () => {
    it('should classify http inputs as url jobs', () => {
        expect(classifyJobInput('https://www.youtube.com/watch?v=fYMFefUdCTI')).toBe('url');
    });

    it('should classify non-url inputs as path jobs', () => {
        expect(classifyJobInput('tests/fixtures/audio/tone-600ms.wav')).toBe('path');
    });

    it('should normalize output formats by trimming, lowercasing, and deduplicating', () => {
        const formats = normalizeOutputFormats([' JSON ', 'txt', 'json', 'unknown']);
        expect(formats).toEqual(['json', 'txt']);
    });

    it('should apply job overrides on top of default run config', () => {
        const overridden = applyJobOverrides(DEFAULT_CONFIG, {
            enhancementMode: 'auto',
            language: 'ar',
            modelPath: 'large-v3',
            outputFormats: ['json', 'srt'],
        });

        expect(overridden.language).toBe('ar');
        expect(overridden.modelPath).toBe('large-v3');
        expect(overridden.outputFormats).toEqual(['json', 'srt']);
        expect(overridden.enhancement.mode).toBe('auto');
        expect(DEFAULT_CONFIG.language).toBe('en');
        expect(DEFAULT_CONFIG.enhancement.mode).toBe('off');
    });

    it('should build run options for local file jobs', () => {
        const job: Pick<TranscriptionJob, 'force' | 'input' | 'kind'> = {
            force: true,
            input: 'tests/fixtures/audio/tone-600ms.wav',
            kind: 'path',
        };

        const runOptions = toRunOptions(job);
        expect(runOptions.force).toBe(true);
        expect(runOptions.paths).toEqual([resolve('tests/fixtures/audio/tone-600ms.wav')]);
        expect(runOptions.urls).toEqual([]);
    });

    it('should build run options for url jobs', () => {
        const url = 'https://www.youtube.com/watch?v=fYMFefUdCTI';
        const job: Pick<TranscriptionJob, 'force' | 'input' | 'kind'> = {
            force: false,
            input: url,
            kind: 'url',
        };

        const runOptions = toRunOptions(job);
        expect(runOptions.force).toBe(false);
        expect(runOptions.paths).toEqual([]);
        expect(runOptions.urls).toEqual([url]);
    });
});
