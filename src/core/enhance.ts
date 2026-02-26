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
    const py = resolvePython(config);
    if (!(await pathExists(py))) {
        throw new Error(
            `Enhancement Python binary not found at ${py}.\nSet up the environment:\n  bun run setup-enhance`,
        );
    }
    for (const script of ['analyze_audio.py', 'process_audio.py']) {
        const p = resolveScript(script);
        if (!(await pathExists(p))) {
            throw new Error(`Enhancement script not found: ${p}`);
        }
    }

    // Fast-fail on missing python dependencies.
    const sanity = await runCommand(py, [
        '-c',
        [
            'import numpy, soundfile, scipy, torch, torchaudio, ruptures, nara_wpe, silero_vad',
            'raise SystemExit(0)',
        ].join(';'),
    ]);
    if (sanity.exitCode !== 0) {
        throw new Error(
            'Enhancement environment is not healthy. Reinstall with:\n' +
                '  bun run setup-enhance\n' +
                'If the issue persists, remove `tools/enhance/.venv` and run setup again.',
        );
    }

    if (config.mode !== 'analyze-only') {
        const deepFilter = resolveDeepFilter(config);
        if (!(await pathExists(deepFilter))) {
            throw new Error(
                `deep-filter binary not found at ${deepFilter}.\nInstall it with:\n  bun run setup-enhance`,
            );
        }
        const deepFilterVersion = await runCommand(deepFilter, ['--version']);
        if (deepFilterVersion.exitCode !== 0) {
            throw new Error(
                `deep-filter is not executable at ${deepFilter}.\nReinstall with:\n  bun run setup-enhance`,
            );
        }
    }
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
        throw new Error(`analyze_audio.py failed (exit ${result.exitCode})`);
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
        throw new Error(`process_audio.py failed (exit ${result.exitCode})`);
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

    // --- Step 1: Analysis (or load existing plan) ---
    let analysis: AudioAnalysis;

    if (planInDir) {
        const planFile = join(planInDir, `${videoId}.json`);
        if (await pathExists(planFile)) {
            console.log(`[enhance] Loading plan from ${planFile}`);
            analysis = JSON.parse(await readFile(planFile, 'utf-8')) as AudioAnalysis;
        } else {
            console.log(`[enhance] No plan for ${videoId}, running analysis`);
            analysis = await analyzeAudio({
                config,
                outputPath: analysisPath,
                wavPath: rawWavPath,
            });
        }
    } else {
        analysis = await analyzeAudio({
            config,
            outputPath: analysisPath,
            wavPath: rawWavPath,
        });
    }

    artifacts.push({ kind: 'enhancement_analysis_json', path: analysisPath });

    // Save plan for review if requested
    if (planOutDir) {
        await ensureDir(planOutDir);
        const planFile = join(planOutDir, `${videoId}.json`);
        await writeFile(planFile, JSON.stringify(analysis, null, 2));
        artifacts.push({ kind: 'enhancement_plan_json', path: planFile });
    }

    // --- analyze-only: stop here ---
    if (config.mode === 'analyze-only') {
        return skippedResult(rawWavPath, 'analyze-only', 'analyze_only_mode', analysis, artifacts, startedAt);
    }

    // --- Step 2: SNR gate ---
    if (config.mode === 'auto' && analysis.snr_db !== null && analysis.snr_db >= config.snrSkipThresholdDb) {
        const reason = `snr_above_threshold (${analysis.snr_db.toFixed(1)} >= ${config.snrSkipThresholdDb})`;
        console.log(`[enhance] Skipping: ${reason}`);
        return skippedResult(rawWavPath, 'auto', reason, analysis, artifacts, startedAt);
    }

    // --- Step 3: Apply source-class overrides ---
    if (config.sourceClass === 'far-field' || config.sourceClass === 'podium') {
        for (const regime of analysis.regimes) {
            regime.recommended.dereverb = true;
        }
    }

    for (const regime of analysis.regimes) {
        regime.recommended.atten_lim_db = config.attenLimDb;
    }

    // Persist the (possibly mutated) analysis for the process script
    await writeFile(analysisPath, JSON.stringify(analysis, null, 2));

    // --- Step 4: Process ---
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
