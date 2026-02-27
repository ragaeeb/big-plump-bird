import { afterEach, beforeEach, describe, expect, it, mock, spyOn } from 'bun:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import type { EnhancementConfig } from '../../src/core/config';
import { DEFAULT_ENHANCEMENT_CONFIG } from '../../src/core/config';
import type { AudioAnalysis, ProcessingResult } from '../../src/core/enhance';
import { analyzeAudio, checkEnhancementAvailable, maybeEnhanceAudio, processAudio } from '../../src/core/enhance';
import * as utils from '../../src/core/utils';

const tempDirs: string[] = [];

afterEach(async () => {
    while (tempDirs.length > 0) {
        const dir = tempDirs.pop();
        if (!dir) {
            continue;
        }
        await rm(dir, { force: true, recursive: true });
    }
});

async function makeTempDir(): Promise<string> {
    const dir = await mkdtemp(join(tmpdir(), 'bpb-enhance-test-'));
    tempDirs.push(dir);
    return dir;
}

function makeEnhancementConfig(overrides: Partial<EnhancementConfig> = {}): EnhancementConfig {
    return { ...DEFAULT_ENHANCEMENT_CONFIG, mode: 'auto', ...overrides };
}

function makeAudioAnalysis(overrides: Partial<AudioAnalysis> = {}): AudioAnalysis {
    return {
        analysis_duration_ms: 100,
        duration_ms: 5000,
        input_path: '/tmp/audio.wav',
        regime_count: 1,
        regimes: [
            {
                end_ms: 5000,
                index: 0,
                noise_reference: null,
                noise_rms_db: -40,
                recommended: { atten_lim_db: 12, denoise: true, dereverb: false },
                spectral_centroid_hz: 2000,
                start_ms: 0,
            },
        ],
        sample_rate: 16000,
        silence_spans: [],
        snr_db: 10.0,
        speech_ratio: 0.8,
        speech_spans: [],
        version: 1,
        versions: { analyze_audio: '1.0' },
        ...overrides,
    };
}

// ---------------------------------------------------------------------------
// maybeEnhanceAudio - mode: 'off'
// ---------------------------------------------------------------------------
describe('maybeEnhanceAudio - mode off', () => {
    it('returns skipped result immediately when mode is off', async () => {
        const dir = await makeTempDir();
        const config = makeEnhancementConfig({ mode: 'off' });
        const result = await maybeEnhanceAudio({
            config,
            enhanceDir: dir,
            rawWavPath: join(dir, 'audio.wav'),
            videoId: 'vid-off',
        });
        expect(result.applied).toBe(false);
        expect(result.mode).toBe('off');
        expect(result.skipReason).toBe('enhancement_disabled');
        expect(result.analysis).toBeNull();
        expect(result.processingResult).toBeNull();
    });
});

// ---------------------------------------------------------------------------
// maybeEnhanceAudio - analyze-only mode
// ---------------------------------------------------------------------------
describe('maybeEnhanceAudio - analyze-only mode', () => {
    it('runs analysis and stops without processing', async () => {
        const dir = await makeTempDir();
        const rawWavPath = join(dir, 'audio.wav');
        const analysis = makeAudioAnalysis({ snr_db: 5.0 });

        // Write a fake wav file so it "exists"
        await writeFile(rawWavPath, Buffer.alloc(100));

        const config = makeEnhancementConfig({ mode: 'analyze-only' });

        // Mock runCommand to succeed for analyze_audio.py
        const runCommandSpy = spyOn(utils, 'runCommand').mockImplementation(async (_cmd, _args, _opts) => ({
            exitCode: 0,
            stderr: '',
            stdout: '',
        }));

        // Mock readFile (from fs/promises) by writing the expected output file before calling
        const enhanceDir = join(dir, 'enhance');
        const workDir = join(enhanceDir, 'vid-ao');
        const { mkdir } = await import('node:fs/promises');
        await mkdir(workDir, { recursive: true });
        await writeFile(join(workDir, 'analysis.json'), JSON.stringify(analysis));

        const result = await maybeEnhanceAudio({
            config,
            enhanceDir,
            rawWavPath,
            videoId: 'vid-ao',
        });

        expect(result.applied).toBe(false);
        expect(result.mode).toBe('analyze-only');
        expect(result.skipReason).toBe('analyze_only_mode');
        expect(result.analysis).not.toBeNull();
        expect(result.processingResult).toBeNull();

        runCommandSpy.mockRestore();
    });
});

// ---------------------------------------------------------------------------
// maybeEnhanceAudio - SNR gate (auto mode, snr above threshold)
// ---------------------------------------------------------------------------
describe('maybeEnhanceAudio - SNR gate', () => {
    it('skips processing when SNR is above threshold in auto mode', async () => {
        const dir = await makeTempDir();
        const rawWavPath = join(dir, 'audio.wav');
        await writeFile(rawWavPath, Buffer.alloc(100));

        const config = makeEnhancementConfig({ mode: 'auto', snrSkipThresholdDb: 15 });
        const analysis = makeAudioAnalysis({ snr_db: 20.0 }); // above threshold

        const enhanceDir = join(dir, 'enhance');
        const workDir = join(enhanceDir, 'vid-snr');
        const { mkdir } = await import('node:fs/promises');
        await mkdir(workDir, { recursive: true });
        await writeFile(join(workDir, 'analysis.json'), JSON.stringify(analysis));

        const runCommandSpy = spyOn(utils, 'runCommand').mockResolvedValue({ exitCode: 0, stderr: '', stdout: '' });

        const result = await maybeEnhanceAudio({
            config,
            enhanceDir,
            rawWavPath,
            videoId: 'vid-snr',
        });

        expect(result.applied).toBe(false);
        expect(result.skipReason).toContain('snr_above_threshold');
        expect(result.analysis?.snr_db).toBe(20.0);

        runCommandSpy.mockRestore();
    });
});

// ---------------------------------------------------------------------------
// maybeEnhanceAudio - full enhancement applied
// ---------------------------------------------------------------------------
describe('maybeEnhanceAudio - enhancement applied', () => {
    it('returns applied=true and processingResult on success', async () => {
        const dir = await makeTempDir();
        const rawWavPath = join(dir, 'audio.wav');
        await writeFile(rawWavPath, Buffer.alloc(100));

        const config = makeEnhancementConfig({ mode: 'auto', snrSkipThresholdDb: 15 });
        const analysis = makeAudioAnalysis({ snr_db: 5.0 }); // below threshold → process

        const processingResult: ProcessingResult = {
            duration_ms: 5000,
            input_path: rawWavPath,
            output_path: join(dir, 'enhance', 'vid-apply', 'enhanced.wav'),
            processing_ms: 800,
            segments: [],
            version: 1,
            versions: { process_audio: '1.0' },
        };

        const enhanceDir = join(dir, 'enhance');
        const workDir = join(enhanceDir, 'vid-apply');
        const { mkdir } = await import('node:fs/promises');
        await mkdir(workDir, { recursive: true });

        // Pre-write the files the function will read
        await writeFile(join(workDir, 'analysis.json'), JSON.stringify(analysis));
        await writeFile(join(workDir, 'result.json'), JSON.stringify(processingResult));
        await writeFile(join(workDir, 'enhanced.wav'), Buffer.alloc(100));

        const runCommandSpy = spyOn(utils, 'runCommand').mockResolvedValue({ exitCode: 0, stderr: '', stdout: '' });

        const result = await maybeEnhanceAudio({
            config,
            enhanceDir,
            rawWavPath,
            videoId: 'vid-apply',
        });

        expect(result.applied).toBe(true);
        expect(result.mode).toBe('auto');
        expect(result.skipReason).toBeUndefined();
        expect(result.processingResult).not.toBeNull();

        runCommandSpy.mockRestore();
    });
});

// ---------------------------------------------------------------------------
// maybeEnhanceAudio - planInDir
// ---------------------------------------------------------------------------
describe('maybeEnhanceAudio - planInDir', () => {
    it('loads plan from planInDir when file exists', async () => {
        const dir = await makeTempDir();
        const rawWavPath = join(dir, 'audio.wav');
        await writeFile(rawWavPath, Buffer.alloc(100));

        const planDir = join(dir, 'plans');
        const { mkdir } = await import('node:fs/promises');
        await mkdir(planDir, { recursive: true });

        const analysis = makeAudioAnalysis({ snr_db: 5.0 });
        await writeFile(join(planDir, 'vid-plan.json'), JSON.stringify(analysis));

        const enhanceDir = join(dir, 'enhance');
        const workDir = join(enhanceDir, 'vid-plan');
        await mkdir(workDir, { recursive: true });
        await writeFile(join(workDir, 'analysis.json'), JSON.stringify(analysis));

        const processingResult: ProcessingResult = {
            duration_ms: 5000,
            input_path: rawWavPath,
            output_path: join(workDir, 'enhanced.wav'),
            processing_ms: 500,
            segments: [],
            version: 1,
            versions: {},
        };
        await writeFile(join(workDir, 'result.json'), JSON.stringify(processingResult));
        await writeFile(join(workDir, 'enhanced.wav'), Buffer.alloc(100));

        const config = makeEnhancementConfig({ mode: 'auto', snrSkipThresholdDb: 15 });
        const runCommandSpy = spyOn(utils, 'runCommand').mockResolvedValue({ exitCode: 0, stderr: '', stdout: '' });

        const result = await maybeEnhanceAudio({
            config,
            enhanceDir,
            planInDir: planDir,
            rawWavPath,
            videoId: 'vid-plan',
        });

        // runCommand should NOT have been called for analyze since plan was loaded
        expect(runCommandSpy).not.toHaveBeenCalledWith(
            expect.anything(),
            expect.arrayContaining([expect.stringContaining('analyze_audio.py')]),
            expect.anything(),
        );
        expect(result.applied).toBe(true);

        runCommandSpy.mockRestore();
    });

    it('runs analysis when planInDir set but file does not exist', async () => {
        const dir = await makeTempDir();
        const rawWavPath = join(dir, 'audio.wav');
        await writeFile(rawWavPath, Buffer.alloc(100));

        const planDir = join(dir, 'plans-missing');
        const { mkdir } = await import('node:fs/promises');
        await mkdir(planDir, { recursive: true });
        // No plan file written for 'vid-noplan'

        const analysis = makeAudioAnalysis({ snr_db: 5.0 });
        const enhanceDir = join(dir, 'enhance');
        const workDir = join(enhanceDir, 'vid-noplan');
        await mkdir(workDir, { recursive: true });
        await writeFile(join(workDir, 'analysis.json'), JSON.stringify(analysis));

        const processingResult: ProcessingResult = {
            duration_ms: 5000,
            input_path: rawWavPath,
            output_path: join(workDir, 'enhanced.wav'),
            processing_ms: 500,
            segments: [],
            version: 1,
            versions: {},
        };
        await writeFile(join(workDir, 'result.json'), JSON.stringify(processingResult));
        await writeFile(join(workDir, 'enhanced.wav'), Buffer.alloc(100));

        const config = makeEnhancementConfig({ mode: 'auto', snrSkipThresholdDb: 15 });
        const runCommandSpy = spyOn(utils, 'runCommand').mockResolvedValue({ exitCode: 0, stderr: '', stdout: '' });

        const result = await maybeEnhanceAudio({
            config,
            enhanceDir,
            planInDir: planDir,
            rawWavPath,
            videoId: 'vid-noplan',
        });

        // runCommand SHOULD have been called since there was no plan file
        expect(runCommandSpy).toHaveBeenCalled();
        expect(result.applied).toBe(true);

        runCommandSpy.mockRestore();
    });
});

// ---------------------------------------------------------------------------
// maybeEnhanceAudio - planOutDir
// ---------------------------------------------------------------------------
describe('maybeEnhanceAudio - planOutDir', () => {
    it('saves plan to planOutDir', async () => {
        const dir = await makeTempDir();
        const rawWavPath = join(dir, 'audio.wav');
        await writeFile(rawWavPath, Buffer.alloc(100));

        const planOutDir = join(dir, 'out-plans');
        const analysis = makeAudioAnalysis({ snr_db: 5.0 });

        const enhanceDir = join(dir, 'enhance');
        const workDir = join(enhanceDir, 'vid-planout');
        const { mkdir } = await import('node:fs/promises');
        await mkdir(workDir, { recursive: true });
        await writeFile(join(workDir, 'analysis.json'), JSON.stringify(analysis));

        const processingResult: ProcessingResult = {
            duration_ms: 5000,
            input_path: rawWavPath,
            output_path: join(workDir, 'enhanced.wav'),
            processing_ms: 500,
            segments: [],
            version: 1,
            versions: {},
        };
        await writeFile(join(workDir, 'result.json'), JSON.stringify(processingResult));
        await writeFile(join(workDir, 'enhanced.wav'), Buffer.alloc(100));

        const config = makeEnhancementConfig({ mode: 'auto', snrSkipThresholdDb: 15 });
        const runCommandSpy = spyOn(utils, 'runCommand').mockResolvedValue({ exitCode: 0, stderr: '', stdout: '' });

        await maybeEnhanceAudio({
            config,
            enhanceDir,
            planOutDir,
            rawWavPath,
            videoId: 'vid-planout',
        });

        const planFile = join(planOutDir, 'vid-planout.json');
        const { pathExists } = utils;
        expect(await pathExists(planFile)).toBe(true);

        runCommandSpy.mockRestore();
    });
});

// ---------------------------------------------------------------------------
// maybeEnhanceAudio - source class overrides
// ---------------------------------------------------------------------------
describe('maybeEnhanceAudio - source class far-field sets dereverb', () => {
    it('sets dereverb=true on regimes when sourceClass is far-field', async () => {
        const dir = await makeTempDir();
        const rawWavPath = join(dir, 'audio.wav');
        await writeFile(rawWavPath, Buffer.alloc(100));

        const config = makeEnhancementConfig({ mode: 'auto', snrSkipThresholdDb: 15, sourceClass: 'far-field' });
        const analysis = makeAudioAnalysis({ snr_db: 5.0 });
        // regime recommended.dereverb starts as false
        expect(analysis.regimes[0].recommended.dereverb).toBe(false);

        const enhanceDir = join(dir, 'enhance');
        const workDir = join(enhanceDir, 'vid-farfield');
        const { mkdir } = await import('node:fs/promises');
        await mkdir(workDir, { recursive: true });
        await writeFile(join(workDir, 'analysis.json'), JSON.stringify(analysis));

        const processingResult: ProcessingResult = {
            duration_ms: 5000,
            input_path: rawWavPath,
            output_path: join(workDir, 'enhanced.wav'),
            processing_ms: 500,
            segments: [],
            version: 1,
            versions: {},
        };
        await writeFile(join(workDir, 'result.json'), JSON.stringify(processingResult));
        await writeFile(join(workDir, 'enhanced.wav'), Buffer.alloc(100));

        const runCommandSpy = spyOn(utils, 'runCommand').mockResolvedValue({ exitCode: 0, stderr: '', stdout: '' });

        const result = await maybeEnhanceAudio({
            config,
            enhanceDir,
            rawWavPath,
            videoId: 'vid-farfield',
        });

        // Analysis regimes should have been mutated to have dereverb=true
        expect(result.analysis?.regimes[0].recommended.dereverb).toBe(true);

        runCommandSpy.mockRestore();
    });
});

// ---------------------------------------------------------------------------
// analyzeAudio - failure
// ---------------------------------------------------------------------------
describe('analyzeAudio', () => {
    it('throws when analyze_audio.py exits non-zero', async () => {
        const dir = await makeTempDir();
        const config = makeEnhancementConfig();
        const runCommandSpy = spyOn(utils, 'runCommand').mockResolvedValue({
            exitCode: 1,
            stderr: 'some error',
            stdout: '',
        });

        await expect(
            analyzeAudio({ config, outputPath: join(dir, 'analysis.json'), wavPath: join(dir, 'audio.wav') }),
        ).rejects.toThrow('analyze_audio.py failed');

        runCommandSpy.mockRestore();
    });
});

// ---------------------------------------------------------------------------
// processAudio - failure
// ---------------------------------------------------------------------------
describe('processAudio', () => {
    it('throws when process_audio.py exits non-zero', async () => {
        const dir = await makeTempDir();
        const config = makeEnhancementConfig();
        const runCommandSpy = spyOn(utils, 'runCommand').mockResolvedValue({
            exitCode: 2,
            stderr: 'process error',
            stdout: '',
        });

        await expect(
            processAudio({
                analysisPath: join(dir, 'analysis.json'),
                config,
                outputPath: join(dir, 'enhanced.wav'),
                resultPath: join(dir, 'result.json'),
                wavPath: join(dir, 'audio.wav'),
            }),
        ).rejects.toThrow('process_audio.py failed');

        runCommandSpy.mockRestore();
    });
});

// ---------------------------------------------------------------------------
// checkEnhancementAvailable
// ---------------------------------------------------------------------------
describe('checkEnhancementAvailable', () => {
    it('throws when python binary does not exist', async () => {
        const config = makeEnhancementConfig({
            pythonBin: '/nonexistent/python3',
        });

        await expect(checkEnhancementAvailable(config)).rejects.toThrow('Enhancement Python binary not found');
    });

    it('throws when analyze_audio.py script does not exist', async () => {
        const dir = await makeTempDir();
        // Create a fake python binary
        const pythonBin = join(dir, 'python3');
        await writeFile(pythonBin, '#!/bin/sh\nexec echo ok\n');
        const { chmod } = await import('node:fs/promises');
        await chmod(pythonBin, 0o755);

        // Mock pathExists so python exists but analyze_audio.py does not
        const pathExistsSpy = spyOn(utils, 'pathExists').mockImplementation(async (p: string) => {
            if (p === resolve(pythonBin)) {
                return true;
            }
            if (p.endsWith('analyze_audio.py')) {
                return false; // simulate missing script
            }
            return false;
        });

        const config = makeEnhancementConfig({ pythonBin });

        await expect(checkEnhancementAvailable(config)).rejects.toThrow('Enhancement script not found');

        pathExistsSpy.mockRestore();
    });

    it('throws when python dependencies are missing (sanity check fails)', async () => {
        const dir = await makeTempDir();
        const pythonBin = join(dir, 'python3');
        await writeFile(pythonBin, '#!/bin/sh\necho ok\n');
        const { chmod } = await import('node:fs/promises');
        await chmod(pythonBin, 0o755);

        // We can't easily mock the script existence, so mock pathExists instead
        const pathExistsSpy = spyOn(utils, 'pathExists').mockImplementation(async (p: string) => {
            if (p === resolve(pythonBin)) {
                return true;
            }
            if (p.endsWith('analyze_audio.py') || p.endsWith('process_audio.py')) {
                return true;
            }
            return false;
        });

        const runCommandSpy = spyOn(utils, 'runCommand').mockResolvedValue({
            exitCode: 1,
            stderr: 'ModuleNotFoundError: No module named numpy',
            stdout: '',
        });

        const config = makeEnhancementConfig({ pythonBin });

        await expect(checkEnhancementAvailable(config)).rejects.toThrow('Enhancement environment is not healthy');

        pathExistsSpy.mockRestore();
        runCommandSpy.mockRestore();
    });

    it('throws when deep-filter binary is missing', async () => {
        const dir = await makeTempDir();
        const pythonBin = join(dir, 'python3');
        await writeFile(pythonBin, '#!/bin/sh\necho ok\n');
        const { chmod } = await import('node:fs/promises');
        await chmod(pythonBin, 0o755);

        const pathExistsSpy = spyOn(utils, 'pathExists').mockImplementation(async (p: string) => {
            if (p === resolve(pythonBin)) {
                return true;
            }
            if (p.endsWith('analyze_audio.py') || p.endsWith('process_audio.py')) {
                return true;
            }
            if (p.endsWith('deep-filter')) {
                return false; // missing
            }
            return false;
        });

        const runCommandSpy = spyOn(utils, 'runCommand').mockResolvedValue({
            exitCode: 0,
            stderr: '',
            stdout: '',
        });

        const config = makeEnhancementConfig({ pythonBin });

        await expect(checkEnhancementAvailable(config)).rejects.toThrow('deep-filter binary not found');

        pathExistsSpy.mockRestore();
        runCommandSpy.mockRestore();
    });

    it('throws when deep-filter binary is not executable', async () => {
        const dir = await makeTempDir();
        const pythonBin = join(dir, 'python3');
        await writeFile(pythonBin, '#!/bin/sh\necho ok\n');
        const { chmod } = await import('node:fs/promises');
        await chmod(pythonBin, 0o755);

        const pathExistsSpy = spyOn(utils, 'pathExists').mockImplementation(async (p: string) => {
            if (p === resolve(pythonBin)) {
                return true;
            }
            if (p.endsWith('analyze_audio.py') || p.endsWith('process_audio.py')) {
                return true;
            }
            if (p.endsWith('deep-filter')) {
                return true;
            }
            return false;
        });

        let callCount = 0;
        const runCommandSpy = spyOn(utils, 'runCommand').mockImplementation(async () => {
            callCount++;
            // First call is sanity check (python deps) → success
            // Second call is deep-filter --version → failure
            return callCount === 1
                ? { exitCode: 0, stderr: '', stdout: '' }
                : { exitCode: 1, stderr: 'not exec', stdout: '' };
        });

        const config = makeEnhancementConfig({ pythonBin });

        await expect(checkEnhancementAvailable(config)).rejects.toThrow('deep-filter is not executable');

        pathExistsSpy.mockRestore();
        runCommandSpy.mockRestore();
    });
});
