import { chmod, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

async function run(cmd: string, args: string[]): Promise<void> {
    const proc = Bun.spawn([cmd, ...args], { stderr: 'inherit', stdout: 'inherit' });
    const exitCode = await proc.exited;
    if (exitCode !== 0) {
        throw new Error(`${cmd} ${args.join(' ')} failed with exit code ${exitCode}`);
    }
}

async function runOutput(cmd: string, args: string[]): Promise<{ exitCode: number; stdout: string; stderr: string }> {
    const proc = Bun.spawn([cmd, ...args], {
        env: { ...process.env, PYTHONWARNINGS: 'ignore' },
        stderr: 'pipe',
        stdout: 'pipe',
    });
    const [stdout, stderr, exitCode] = await Promise.all([
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
        proc.exited,
    ]);
    return { exitCode, stderr: stderr.trim(), stdout: stdout.trim() };
}

async function main(): Promise<void> {
    const pythonVersion = process.env.BPB_WHISPERX_PYTHON_VERSION ?? '3.13';
    const venvDir = resolve('.venv-whisperx');
    const pythonBin =
        process.platform === 'win32' ? join(venvDir, 'Scripts', 'python.exe') : join(venvDir, 'bin', 'python');
    const whisperxBin =
        process.platform === 'win32' ? join(venvDir, 'Scripts', 'whisperx.exe') : join(venvDir, 'bin', 'whisperx');

    console.log(`[setup-whisperx] Ensuring Python ${pythonVersion} is available...`);
    await run('uv', ['--version']);
    await run('uv', ['python', 'install', pythonVersion]);
    console.log('[setup-whisperx] Recreating .venv-whisperx...');
    await run('uv', ['venv', venvDir, '--python', pythonVersion, '--clear']);
    console.log('[setup-whisperx] Installing WhisperX...');
    await run('uv', ['pip', 'install', '--python', pythonBin, 'whisperx==3.8.1']);

    if (process.platform !== 'win32') {
        const wrapper = `#!${pythonBin}
import importlib
import sys
import warnings

torchaudio = importlib.import_module("torchaudio")
if not hasattr(torchaudio, "list_audio_backends"):
    torchaudio.list_audio_backends = lambda: ["soundfile"]

# pyannote warns about optional torchcodec backend on some macOS setups.
# WhisperX continues to work with file paths via ffmpeg/torchaudio, so hide this noise.
warnings.filterwarnings(
    "ignore",
    category=UserWarning,
    module="pyannote.audio.core.io",
)
warnings.filterwarnings(
    "ignore",
    message=".*torchcodec is not installed correctly so built-in audio decoding will fail.*",
    category=UserWarning,
)

from whisperx.__main__ import cli

if __name__ == "__main__":
    sys.exit(cli())
`;
        await writeFile(whisperxBin, wrapper, 'utf-8');
        await chmod(whisperxBin, 0o755);
    }

    console.log('[setup-whisperx] Verifying whisperx executable...');
    await run(whisperxBin, ['--version']);

    console.log('[setup-whisperx] Running runtime import preflight (can take 30-120s)...');
    const rtCheck = await runOutput(pythonBin, [
        '-c',
        [
            'import torchaudio',
            "setattr(torchaudio, 'list_audio_backends', getattr(torchaudio, 'list_audio_backends', (lambda: ['soundfile'])))",
            'from whisperx.transcribe import transcribe_task',
            'raise SystemExit(0)',
        ].join(';'),
    ]);
    if (rtCheck.exitCode !== 0) {
        throw new Error(`WhisperX runtime preflight failed. ${rtCheck.stderr || rtCheck.stdout || 'unknown error'}`);
    }

    console.log('[setup-whisperx] Complete');
}

main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
});
