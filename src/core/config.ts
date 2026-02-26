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

export async function loadConfig(configPath: string): Promise<RunConfig> {
    const absoluteConfigPath = resolve(configPath);
    const configDir = dirname(absoluteConfigPath);

    if (!(await pathExists(absoluteConfigPath))) {
        return resolveConfigPaths({ ...DEFAULT_CONFIG }, configDir);
    }
    const raw = await Bun.file(absoluteConfigPath).text();
    const parsed = JSON.parse(raw) as Partial<RunConfig & { enhancement?: Partial<EnhancementConfig> }>;
    return resolveConfigPaths(
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
