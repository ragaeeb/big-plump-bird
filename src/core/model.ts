import { rename, rm } from 'node:fs/promises';
import { basename, dirname, resolve } from 'node:path';
import type { RunConfig } from './config';
import { ensureDir, pathExists, runCommand } from './utils';

const DEFAULT_MODEL_URLS: Record<string, string> = {
    'ggml-large-v3.bin': 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-large-v3.bin',
};

function isLocalModelPath(modelPath: string): boolean {
    return modelPath.includes('/') || modelPath.includes('\\') || modelPath.endsWith('.bin');
}

function inferModelUrl(modelPath: string): string | null {
    const file = basename(modelPath);
    return DEFAULT_MODEL_URLS[file] ?? null;
}

export async function ensureModelReady(config: RunConfig): Promise<RunConfig> {
    if (!isLocalModelPath(config.modelPath)) {
        return config;
    }

    const resolvedModelPath = resolve(config.modelPath);
    if (await pathExists(resolvedModelPath)) {
        return { ...config, modelPath: resolvedModelPath };
    }

    if (!config.autoDownloadModel) {
        throw new Error(
            `Model not found at ${resolvedModelPath}. Enable autoDownloadModel or provide an existing model path.`,
        );
    }

    const modelUrl = config.modelDownloadUrl || inferModelUrl(resolvedModelPath);
    if (!modelUrl) {
        throw new Error(`Model not found at ${resolvedModelPath}, and no modelDownloadUrl is configured.`);
    }

    await ensureDir(dirname(resolvedModelPath));
    console.log(`Model not found. Downloading to ${resolvedModelPath} ...`);
    const tempPath = `${resolvedModelPath}.part`;
    const result = await runCommand('curl', ['--fail', '-L', '-o', tempPath, modelUrl], { stream: true });
    if (result.exitCode !== 0) {
        await rm(tempPath, { force: true });
        throw new Error(`Model download failed (curl exit ${result.exitCode}).`);
    }
    await rename(tempPath, resolvedModelPath);

    if (!(await pathExists(resolvedModelPath))) {
        throw new Error(`Model download finished but file is missing: ${resolvedModelPath}`);
    }

    return { ...config, modelPath: resolvedModelPath };
}
