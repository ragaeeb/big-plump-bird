import { dirname, isAbsolute, resolve } from 'node:path';
import { pathExists } from './utils';

export type EnhancementMode = 'off' | 'auto' | 'on' | 'analyze-only';
export type SourceClass = 'auto' | 'studio' | 'podium' | 'far-field' | 'cassette';
export type DereverbMode = 'off' | 'auto' | 'on';
export type FailPolicy = 'fallback_raw' | 'fail';

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
};

export const DEFAULT_CONFIG: RunConfig = {
    autoDownloadModel: true,
    dataDir: 'data',
    dbPath: 'data/bpb.sqlite',
    downloadVideo: false,
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
};

const WHISPERX_COMPUTE_TYPES = new Set(['float16', 'float32', 'int8']);
const ENHANCEMENT_MODES = new Set(['off', 'auto', 'on', 'analyze-only']);
const SOURCE_CLASSES = new Set(['auto', 'studio', 'podium', 'far-field', 'cassette']);
const DEREVERB_MODES = new Set(['off', 'auto', 'on']);
const FAIL_POLICIES = new Set(['fallback_raw', 'fail']);

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
    if (typeof config.dbPath !== 'string' || config.dbPath.trim().length === 0) {
        throw new Error('Invalid config: dbPath is required.');
    }
    if (typeof config.dataDir !== 'string' || config.dataDir.trim().length === 0) {
        throw new Error('Invalid config: dataDir is required.');
    }
    if (typeof config.modelPath !== 'string' || config.modelPath.trim().length === 0) {
        throw new Error('Invalid config: modelPath is required.');
    }
    if (!WHISPERX_COMPUTE_TYPES.has(config.whisperxComputeType)) {
        throw new Error(
            `Invalid config: whisperxComputeType must be one of ${Array.from(WHISPERX_COMPUTE_TYPES).join(', ')}.`,
        );
    }
    if (!Number.isFinite(config.jobs) || config.jobs < 1) {
        throw new Error('Invalid config: jobs must be a number >= 1.');
    }
    if (!Number.isFinite(config.whisperxBatchSize) || config.whisperxBatchSize < 1) {
        throw new Error('Invalid config: whisperxBatchSize must be a number >= 1.');
    }
    if (!Array.isArray(config.outputFormats) || config.outputFormats.length === 0) {
        throw new Error('Invalid config: outputFormats must be a non-empty array.');
    }

    if (!ENHANCEMENT_MODES.has(config.enhancement.mode)) {
        throw new Error(`Invalid config: enhancement.mode must be one of ${Array.from(ENHANCEMENT_MODES).join(', ')}.`);
    }
    if (!SOURCE_CLASSES.has(config.enhancement.sourceClass)) {
        throw new Error(
            `Invalid config: enhancement.sourceClass must be one of ${Array.from(SOURCE_CLASSES).join(', ')}.`,
        );
    }
    if (!DEREVERB_MODES.has(config.enhancement.dereverbMode)) {
        throw new Error(
            `Invalid config: enhancement.dereverbMode must be one of ${Array.from(DEREVERB_MODES).join(', ')}.`,
        );
    }
    if (!FAIL_POLICIES.has(config.enhancement.failPolicy)) {
        throw new Error(
            `Invalid config: enhancement.failPolicy must be one of ${Array.from(FAIL_POLICIES).join(', ')}.`,
        );
    }
    if (!Number.isFinite(config.enhancement.attenLimDb)) {
        throw new Error('Invalid config: enhancement.attenLimDb must be finite.');
    }
    if (!Number.isFinite(config.enhancement.snrSkipThresholdDb)) {
        throw new Error('Invalid config: enhancement.snrSkipThresholdDb must be finite.');
    }
    if (
        !Number.isFinite(config.enhancement.vadThreshold) ||
        config.enhancement.vadThreshold < 0 ||
        config.enhancement.vadThreshold > 1
    ) {
        throw new Error('Invalid config: enhancement.vadThreshold must be between 0 and 1.');
    }
    if (!Number.isFinite(config.enhancement.minSilenceMs) || config.enhancement.minSilenceMs < 0) {
        throw new Error('Invalid config: enhancement.minSilenceMs must be >= 0.');
    }
    if (!Number.isFinite(config.enhancement.maxRegimes) || config.enhancement.maxRegimes < 1) {
        throw new Error('Invalid config: enhancement.maxRegimes must be >= 1.');
    }

    return {
        ...config,
        jobs: Math.max(1, Math.round(config.jobs)),
        whisperxBatchSize: Math.max(1, Math.round(config.whisperxBatchSize)),
    };
}
