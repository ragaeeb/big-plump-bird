import { dirname, isAbsolute, resolve } from 'node:path';
import { pathExists } from './utils';

export type EnhancementMode = 'off' | 'auto' | 'on' | 'analyze-only';
export type SourceClass = 'auto' | 'studio' | 'podium' | 'far-field' | 'cassette';
export type DereverbMode = 'off' | 'auto' | 'on';
export type FailPolicy = 'fallback_raw' | 'fail';
export type TranscriptionEngine = 'whisperx' | 'tafrigh';

export type EnhancementConfig = {
    mode: EnhancementMode;
    sourceClass: SourceClass;
    snrSkipThresholdDb: number;
    attenLimDb: number;
    dereverbMode: DereverbMode;
    vadThreshold: number;
    minSilenceMs: number;
    maxRegimes: number;
    overlapMs: number;
    keepIntermediate: boolean;
    failPolicy: FailPolicy;
    pythonBin: string;
    deepFilterBin: string;
};

export const DEFAULT_ENHANCEMENT_CONFIG: EnhancementConfig = {
    attenLimDb: 12,
    deepFilterBin: 'tools/enhance/bin/deep-filter',
    dereverbMode: 'off',
    failPolicy: 'fallback_raw',
    keepIntermediate: false,
    maxRegimes: 8,
    minSilenceMs: 500,
    mode: 'off',
    overlapMs: 10,
    pythonBin: 'tools/enhance/.venv/bin/python3',
    snrSkipThresholdDb: 15,
    sourceClass: 'auto',
    vadThreshold: 0.35,
};

export type RunConfig = {
    dataDir: string;
    dbPath: string;
    engine: TranscriptionEngine;
    modelPath: string;
    whisperxComputeType: 'float16' | 'float32' | 'int8';
    whisperxBatchSize: number;
    autoDownloadModel: boolean;
    modelDownloadUrl: string;
    language: string;
    jobs: number;
    keepWav: boolean;
    downloadVideo: boolean;
    keepSourceAudio: boolean;
    sourceAudioFormat: string;
    sourceAudioMaxAbrKbps: number;
    outputFormats: string[];
    enhancement: EnhancementConfig;
    witAiApiKeys: string[];
};

export const DEFAULT_CONFIG: RunConfig = {
    autoDownloadModel: true,
    dataDir: 'data',
    dbPath: 'data/bpb.sqlite',
    downloadVideo: false,
    engine: 'whisperx',
    enhancement: DEFAULT_ENHANCEMENT_CONFIG,
    jobs: 1,
    keepSourceAudio: true,
    keepWav: false,
    language: 'en',
    modelDownloadUrl: 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-large-v3.bin',
    modelPath: 'turbo',
    outputFormats: ['txt', 'json'],
    sourceAudioFormat: 'opus-webm',
    sourceAudioMaxAbrKbps: 128,
    whisperxBatchSize: 1,
    whisperxComputeType: 'float32',
    witAiApiKeys: [],
};

const WHISPERX_COMPUTE_TYPES = new Set(['float16', 'float32', 'int8']);
const ENHANCEMENT_MODES = new Set(['off', 'auto', 'on', 'analyze-only']);
const SOURCE_CLASSES = new Set(['auto', 'studio', 'podium', 'far-field', 'cassette']);
const DEREVERB_MODES = new Set(['off', 'auto', 'on']);
const FAIL_POLICIES = new Set(['fallback_raw', 'fail']);
const TRANSCRIPTION_ENGINES = new Set(['whisperx', 'tafrigh']);

export async function loadConfig(configPath: string): Promise<RunConfig> {
    const absoluteConfigPath = resolve(configPath);
    const configDir = dirname(absoluteConfigPath);

    if (!(await pathExists(absoluteConfigPath))) {
        return resolveConfigPaths({ ...DEFAULT_CONFIG }, configDir);
    }
    const raw = await Bun.file(absoluteConfigPath).text();
    const parsed = JSON.parse(raw) as Partial<RunConfig & { enhancement?: Partial<EnhancementConfig> }>;
    const merged = resolveConfigPaths(
        {
            ...DEFAULT_CONFIG,
            ...parsed,
            enhancement: {
                ...DEFAULT_ENHANCEMENT_CONFIG,
                ...(parsed.enhancement ?? {}),
            },
            outputFormats: parsed.outputFormats ?? DEFAULT_CONFIG.outputFormats,
            witAiApiKeys: parsed.witAiApiKeys ?? DEFAULT_CONFIG.witAiApiKeys,
        },
        configDir,
    );
    return validateConfig(merged);
}

function resolveConfigPaths(config: RunConfig, configDir: string): RunConfig {
    return {
        ...config,
        dataDir: resolveFromConfigDir(config.dataDir, configDir),
        dbPath: resolveFromConfigDir(config.dbPath, configDir),
        enhancement: {
            ...config.enhancement,
            deepFilterBin: resolveFromConfigDir(config.enhancement.deepFilterBin, configDir),
            pythonBin: resolveFromConfigDir(config.enhancement.pythonBin, configDir),
        },
    };
}

function resolveFromConfigDir(value: string, configDir: string): string {
    if (value.length === 0 || isAbsolute(value)) {
        return value;
    }
    return resolve(configDir, value);
}

function validateConfig(config: RunConfig): RunConfig {
    assertRequiredString(config.dbPath, 'dbPath');
    assertRequiredString(config.dataDir, 'dataDir');
    assertInSet(config.engine, TRANSCRIPTION_ENGINES, 'engine');
    assertWitAiApiKeys(config.witAiApiKeys);
    assertRequiredString(config.modelPath, 'modelPath');
    assertInSet(config.whisperxComputeType, WHISPERX_COMPUTE_TYPES, 'whisperxComputeType');
    assertFiniteAtLeast(config.jobs, 1, 'jobs');
    assertFiniteAtLeast(config.whisperxBatchSize, 1, 'whisperxBatchSize');
    assertNonEmptyArray(config.outputFormats, 'outputFormats');
    assertEnhancementConfig(config.enhancement);

    if (config.engine === 'tafrigh' && config.witAiApiKeys.length === 0) {
        throw new Error('Invalid config: witAiApiKeys must be a non-empty array when engine is "tafrigh".');
    }

    return {
        ...config,
        jobs: Math.max(1, Math.round(config.jobs)),
        whisperxBatchSize: Math.max(1, Math.round(config.whisperxBatchSize)),
    };
}

function assertRequiredString(value: unknown, field: string): void {
    if (typeof value !== 'string' || value.trim().length === 0) {
        throw new Error(`Invalid config: ${field} is required.`);
    }
}

function assertInSet(value: string, allowed: Set<string>, field: string): void {
    if (allowed.has(value)) {
        return;
    }
    throw new Error(`Invalid config: ${field} must be one of ${Array.from(allowed).join(', ')}.`);
}

function assertFiniteAtLeast(value: number, minimum: number, field: string): void {
    if (Number.isFinite(value) && value >= minimum) {
        return;
    }
    throw new Error(`Invalid config: ${field} must be a number >= ${minimum}.`);
}

function assertFiniteNumber(value: number, field: string): void {
    if (Number.isFinite(value)) {
        return;
    }
    throw new Error(`Invalid config: ${field} must be finite.`);
}

function assertFiniteBetween(value: number, min: number, max: number, field: string): void {
    if (Number.isFinite(value) && value >= min && value <= max) {
        return;
    }
    throw new Error(`Invalid config: ${field} must be between ${min} and ${max}.`);
}

function assertWitAiApiKeys(value: unknown): asserts value is string[] {
    if (Array.isArray(value) && value.every((item) => typeof item === 'string')) {
        return;
    }
    throw new Error('Invalid config: witAiApiKeys must be an array of strings.');
}

function assertNonEmptyArray(value: unknown, field: string): void {
    if (Array.isArray(value) && value.length > 0) {
        return;
    }
    throw new Error(`Invalid config: ${field} must be a non-empty array.`);
}

function assertEnhancementConfig(config: EnhancementConfig): void {
    assertInSet(config.mode, ENHANCEMENT_MODES, 'enhancement.mode');
    assertInSet(config.sourceClass, SOURCE_CLASSES, 'enhancement.sourceClass');
    assertInSet(config.dereverbMode, DEREVERB_MODES, 'enhancement.dereverbMode');
    assertInSet(config.failPolicy, FAIL_POLICIES, 'enhancement.failPolicy');
    assertFiniteNumber(config.attenLimDb, 'enhancement.attenLimDb');
    assertFiniteNumber(config.snrSkipThresholdDb, 'enhancement.snrSkipThresholdDb');
    assertFiniteBetween(config.vadThreshold, 0, 1, 'enhancement.vadThreshold');
    assertFiniteAtLeast(config.minSilenceMs, 0, 'enhancement.minSilenceMs');
    assertFiniteAtLeast(config.maxRegimes, 1, 'enhancement.maxRegimes');
}
