import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import type { EnhancementConfig } from './config';
import { ensureDir, pathExists, runCommand } from './utils';

// ---------------------------------------------------------------------------
// Types — mirror the JSON schemas emitted by the Python scripts
// ---------------------------------------------------------------------------

export type RegimeRecommendation = {
    dereverb: boolean;
    denoise: boolean;
    atten_lim_db: number;
};

export type AnalysisRegime = {
    index: number;
    start_ms: number;
    end_ms: number;
    noise_rms_db: number;
    spectral_centroid_hz: number;
    noise_reference: { start_ms: number; end_ms: number } | null;
    recommended: RegimeRecommendation;
};

export type AudioAnalysis = {
    version: number;
    input_path: string;
    duration_ms: number;
    sample_rate: number;
    snr_db: number | null;
    speech_ratio: number;
    regime_count: number;
    regimes: AnalysisRegime[];
    silence_spans: Array<{ start_ms: number; end_ms: number }>;
    speech_spans: Array<{ start_ms: number; end_ms: number }>;
    analysis_duration_ms: number;
    versions: Record<string, string>;
};

export type ProcessingSegmentMetrics = {
    segment_index: number;
    start_ms: number;
    end_ms: number;
    dereverb_applied: boolean;
    denoise_applied: boolean;
    atten_lim_db: number;
    processing_ms: number;
};

export type ProcessingResult = {
    version: number;
    input_path: string;
    output_path: string;
    duration_ms: number;
    processing_ms: number;
    segments: ProcessingSegmentMetrics[];
    versions: Record<string, string>;
};

export type EnhancementResult = {
    wavPath: string;
    applied: boolean;
    mode: string;
    skipReason?: string;
    analysis: AudioAnalysis | null;
    processingResult: ProcessingResult | null;
    artifacts: Array<{ kind: string; path: string }>;
    startedAt: string;
    finishedAt: string;
};

let enhancementAvailableCacheKey: string | null = null;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function resolveScript(name: string): string {
    return resolve(join('tools', 'enhance', name));
}

function resolvePython(config: EnhancementConfig): string {
    return resolve(config.pythonBin);
}

function resolveDeepFilter(config: EnhancementConfig): string {
    return resolve(config.deepFilterBin);
}

function skippedResult(
    rawPath: string,
    mode: string,
    reason: string,
    analysis: AudioAnalysis | null,
    artifacts: Array<{ kind: string; path: string }>,
    startedAt: string,
): EnhancementResult {
    return {
        analysis,
        applied: false,
        artifacts,
        finishedAt: new Date().toISOString(),
        mode,
        processingResult: null,
        skipReason: reason,
        startedAt,
        wavPath: rawPath,
    };
}

// ---------------------------------------------------------------------------
// Pre-flight check
// ---------------------------------------------------------------------------

export async function checkEnhancementAvailable(config: EnhancementConfig): Promise<void> {
    const availabilityCacheKey = buildAvailabilityCacheKey(config);
    if (enhancementAvailableCacheKey === availabilityCacheKey) {
        return;
    }

    const py = resolvePython(config);
    await ensurePythonBinaryExists(py);
    await ensureEnhancementScriptsExist();
    await ensureEnhancementPythonHealthy(py);
    await ensureDeepFilterReady(config);

    enhancementAvailableCacheKey = availabilityCacheKey;
}

// ---------------------------------------------------------------------------
// Analysis
// ---------------------------------------------------------------------------

export async function analyzeAudio(opts: {
    wavPath: string;
    outputPath: string;
    config: EnhancementConfig;
}): Promise<AudioAnalysis> {
    const { wavPath, outputPath, config } = opts;
    await ensureDir(dirname(outputPath));

    const result = await runCommand(
        resolvePython(config),
        [
            resolveScript('analyze_audio.py'),
            '--input',
            wavPath,
            '--output',
            outputPath,
            '--vad-threshold',
            String(config.vadThreshold),
            '--min-silence-ms',
            String(config.minSilenceMs),
            '--max-regimes',
            String(config.maxRegimes),
        ],
        { stream: true },
    );

    if (result.exitCode !== 0) {
        const detail = result.stderr.trim() || result.stdout.trim();
        throw new Error(`analyze_audio.py failed (exit ${result.exitCode})${detail ? `: ${detail}` : ''}`);
    }

    return JSON.parse(await readFile(outputPath, 'utf-8')) as AudioAnalysis;
}

// ---------------------------------------------------------------------------
// Processing
// ---------------------------------------------------------------------------

export async function processAudio(opts: {
    wavPath: string;
    analysisPath: string;
    outputPath: string;
    resultPath: string;
    config: EnhancementConfig;
}): Promise<ProcessingResult> {
    const { wavPath, analysisPath, outputPath, resultPath, config } = opts;
    await ensureDir(dirname(outputPath));

    const result = await runCommand(
        resolvePython(config),
        [
            resolveScript('process_audio.py'),
            '--input',
            wavPath,
            '--analysis',
            analysisPath,
            '--output',
            outputPath,
            '--result',
            resultPath,
            '--atten-lim-db',
            String(config.attenLimDb),
            '--dereverb',
            config.dereverbMode,
            '--overlap-ms',
            String(config.overlapMs),
            '--deep-filter-bin',
            resolveDeepFilter(config),
        ],
        { stream: true },
    );

    if (result.exitCode !== 0) {
        const detail = result.stderr.trim() || result.stdout.trim();
        throw new Error(`process_audio.py failed (exit ${result.exitCode})${detail ? `: ${detail}` : ''}`);
    }

    return JSON.parse(await readFile(resultPath, 'utf-8')) as ProcessingResult;
}

// ---------------------------------------------------------------------------
// Orchestrator
// ---------------------------------------------------------------------------

export async function maybeEnhanceAudio(opts: {
    videoId: string;
    rawWavPath: string;
    enhanceDir: string;
    config: EnhancementConfig;
    planInDir?: string;
    planOutDir?: string;
}): Promise<EnhancementResult> {
    const { videoId, rawWavPath, enhanceDir, config, planInDir, planOutDir } = opts;
    const startedAt = new Date().toISOString();
    const artifacts: Array<{ kind: string; path: string }> = [];

    if (config.mode === 'off') {
        return skippedResult(rawWavPath, 'off', 'enhancement_disabled', null, artifacts, startedAt);
    }

    const workDir = join(enhanceDir, videoId);
    await ensureDir(workDir);

    const analysisPath = join(workDir, 'analysis.json');
    const enhancedPath = join(workDir, 'enhanced.wav');
    const resultPath = join(workDir, 'result.json');

    const analysis = await resolveAnalysis({
        analysisPath,
        config,
        planInDir,
        videoId,
        wavPath: rawWavPath,
    });

    artifacts.push({ kind: 'enhancement_analysis_json', path: analysisPath });

    await maybeWritePlanOut({ analysis, artifacts, planOutDir, videoId });

    if (config.mode === 'analyze-only') {
        return skippedResult(rawWavPath, 'analyze-only', 'analyze_only_mode', analysis, artifacts, startedAt);
    }

    const skipReason = getSnrSkipReason(config, analysis);
    if (skipReason) {
        const reason = `snr_above_threshold (${skipReason})`;
        console.log(`[enhance] Skipping: ${reason}`);
        return skippedResult(rawWavPath, 'auto', reason, analysis, artifacts, startedAt);
    }

    applySourceClassOverrides(analysis, config);

    await writeFile(analysisPath, JSON.stringify(analysis, null, 2));

    console.log(
        `[enhance] Processing ${videoId} ` +
            `(SNR: ${analysis.snr_db?.toFixed(1) ?? 'N/A'}dB, ` +
            `${analysis.regime_count} regime(s))`,
    );

    const processingResult = await processAudio({
        analysisPath,
        config,
        outputPath: enhancedPath,
        resultPath,
        wavPath: rawWavPath,
    });

    artifacts.push({ kind: 'audio_wav_enhanced', path: enhancedPath });
    artifacts.push({ kind: 'enhancement_result_json', path: resultPath });

    return {
        analysis,
        applied: true,
        artifacts,
        finishedAt: new Date().toISOString(),
        mode: config.mode,
        processingResult,
        startedAt,
        wavPath: enhancedPath,
    };
}

function buildAvailabilityCacheKey(config: EnhancementConfig): string {
    return [
        resolvePython(config),
        resolveScript('analyze_audio.py'),
        resolveScript('process_audio.py'),
        config.mode === 'analyze-only' ? 'analyze-only' : resolveDeepFilter(config),
    ].join('|');
}

async function ensurePythonBinaryExists(py: string): Promise<void> {
    if (await pathExists(py)) {
        return;
    }
    throw new Error(`Enhancement Python binary not found at ${py}.\nSet up the environment:\n  bun run setup-enhance`);
}

async function ensureEnhancementScriptsExist(): Promise<void> {
    for (const script of ['analyze_audio.py', 'process_audio.py']) {
        const path = resolveScript(script);
        if (!(await pathExists(path))) {
            throw new Error(`Enhancement script not found: ${path}`);
        }
    }
}

async function ensureEnhancementPythonHealthy(py: string): Promise<void> {
    const sanity = await runCommand(py, [
        '-c',
        [
            'import numpy, soundfile, scipy, torch, torchaudio, ruptures, nara_wpe, silero_vad',
            'raise SystemExit(0)',
        ].join(';'),
    ]);
    if (sanity.exitCode === 0) {
        return;
    }

    const detail = sanity.stderr.trim() || sanity.stdout.trim();
    throw new Error(
        'Enhancement environment is not healthy. Reinstall with:\n' +
            '  bun run setup-enhance\n' +
            'If the issue persists, remove `tools/enhance/.venv` and run setup again.\n' +
            (detail ? `Details: ${detail}` : ''),
    );
}

async function ensureDeepFilterReady(config: EnhancementConfig): Promise<void> {
    if (config.mode === 'analyze-only') {
        return;
    }
    const deepFilter = resolveDeepFilter(config);
    if (!(await pathExists(deepFilter))) {
        throw new Error(`deep-filter binary not found at ${deepFilter}.\nInstall it with:\n  bun run setup-enhance`);
    }
    const deepFilterVersion = await runCommand(deepFilter, ['--version']);
    if (deepFilterVersion.exitCode === 0) {
        return;
    }
    const detail = deepFilterVersion.stderr.trim() || deepFilterVersion.stdout.trim();
    throw new Error(
        `deep-filter is not executable at ${deepFilter}.\nReinstall with:\n  bun run setup-enhance` +
            (detail ? `\nDetails: ${detail}` : ''),
    );
}

async function resolveAnalysis(opts: {
    videoId: string;
    wavPath: string;
    analysisPath: string;
    config: EnhancementConfig;
    planInDir?: string;
}): Promise<AudioAnalysis> {
    const { videoId, wavPath, analysisPath, config, planInDir } = opts;
    if (!planInDir) {
        return analyzeAudio({ config, outputPath: analysisPath, wavPath });
    }

    const planFile = join(planInDir, `${videoId}.json`);
    if (await pathExists(planFile)) {
        console.log(`[enhance] Loading plan from ${planFile}`);
        return JSON.parse(await readFile(planFile, 'utf-8')) as AudioAnalysis;
    }

    console.log(`[enhance] No plan for ${videoId}, running analysis`);
    return analyzeAudio({ config, outputPath: analysisPath, wavPath });
}

async function maybeWritePlanOut(opts: {
    analysis: AudioAnalysis;
    artifacts: Array<{ kind: string; path: string }>;
    planOutDir?: string;
    videoId: string;
}): Promise<void> {
    const { analysis, artifacts, planOutDir, videoId } = opts;
    if (!planOutDir) {
        return;
    }
    await ensureDir(planOutDir);
    const planFile = join(planOutDir, `${videoId}.json`);
    await writeFile(planFile, JSON.stringify(analysis, null, 2));
    artifacts.push({ kind: 'enhancement_plan_json', path: planFile });
}

function getSnrSkipReason(config: EnhancementConfig, analysis: AudioAnalysis): string | null {
    if (config.mode !== 'auto' || analysis.snr_db === null || analysis.snr_db < config.snrSkipThresholdDb) {
        return null;
    }
    return `${analysis.snr_db.toFixed(1)} >= ${config.snrSkipThresholdDb}`;
}

function applySourceClassOverrides(analysis: AudioAnalysis, config: EnhancementConfig): void {
    const forceDereverb = config.sourceClass === 'far-field' || config.sourceClass === 'podium';
    for (const regime of analysis.regimes) {
        if (forceDereverb) {
            regime.recommended.dereverb = true;
        }
        regime.recommended.atten_lim_db = config.attenLimDb;
    }
}
