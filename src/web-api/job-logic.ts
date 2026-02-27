import { resolve } from 'node:path';
import type { DereverbMode, EnhancementMode, RunConfig, SourceClass, TranscriptionEngine } from '../core/config';
import type { RunOptions } from '../core/pipeline';

export type JobKind = 'url' | 'path';
export type JobStatus = 'queued' | 'running' | 'succeeded' | 'failed';

export type JobOverrides = {
    engine?: TranscriptionEngine;
    witAiApiKeys?: string[];
    language?: string;
    modelPath?: string;
    outputFormats?: string[];
    enhancementMode?: EnhancementMode;
    sourceClass?: SourceClass;
    dereverbMode?: DereverbMode;
    attenLimDb?: number;
    snrSkipThresholdDb?: number;
};

export type CreateJobRequest = {
    input: string;
    force?: boolean;
    overrides?: JobOverrides;
};

export type TranscriptionJob = {
    id: string;
    kind: JobKind;
    input: string;
    force: boolean;
    status: JobStatus;
    createdAt: string;
    startedAt: string | null;
    finishedAt: string | null;
    error: string | null;
    overrides: JobOverrides;
};

const OUTPUT_FORMATS = new Set(['json', 'txt', 'srt', 'vtt', 'tsv']);
const HTTP_URL_RE = /^https?:\/\/\S+$/i;

export function classifyJobInput(input: string): JobKind {
    return HTTP_URL_RE.test(input) ? 'url' : 'path';
}

export function normalizeOutputFormats(values: string[] | undefined): string[] | undefined {
    if (!values) {
        return undefined;
    }
    const normalized = Array.from(
        new Set(
            values
                .map((value) => value.trim().toLowerCase())
                .filter((value) => value.length > 0 && OUTPUT_FORMATS.has(value)),
        ),
    );
    return normalized.length > 0 ? normalized : undefined;
}

export function applyJobOverrides(baseConfig: RunConfig, overrides: JobOverrides | undefined): RunConfig {
    if (!overrides) {
        return baseConfig;
    }
    return {
        ...baseConfig,
        engine: overrides.engine ?? baseConfig.engine,
        enhancement: {
            ...baseConfig.enhancement,
            attenLimDb: overrides.attenLimDb ?? baseConfig.enhancement.attenLimDb,
            dereverbMode: overrides.dereverbMode ?? baseConfig.enhancement.dereverbMode,
            mode: overrides.enhancementMode ?? baseConfig.enhancement.mode,
            snrSkipThresholdDb: overrides.snrSkipThresholdDb ?? baseConfig.enhancement.snrSkipThresholdDb,
            sourceClass: overrides.sourceClass ?? baseConfig.enhancement.sourceClass,
        },
        language: overrides.language?.trim() || baseConfig.language,
        modelPath: overrides.modelPath?.trim() || baseConfig.modelPath,
        outputFormats: normalizeOutputFormats(overrides.outputFormats) ?? baseConfig.outputFormats,
        witAiApiKeys: normalizeWitAiApiKeys(overrides.witAiApiKeys) ?? baseConfig.witAiApiKeys,
    };
}

function normalizeWitAiApiKeys(values: string[] | undefined): string[] | undefined {
    if (!values) {
        return undefined;
    }
    const normalized = Array.from(new Set(values.map((value) => value.trim()).filter((value) => value.length > 0)));
    return normalized.length > 0 ? normalized : undefined;
}

export function toRunOptions(job: Pick<TranscriptionJob, 'force' | 'input' | 'kind'>): RunOptions {
    return {
        dryRun: false,
        force: job.force,
        paths: job.kind === 'path' ? [resolve(job.input)] : [],
        urls: job.kind === 'url' ? [job.input] : [],
    };
}
