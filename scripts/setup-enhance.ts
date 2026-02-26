import { chmod, mkdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathExists } from '../src/core/utils';

const DEEP_FILTER_VERSION = '0.5.6';

function assetForCurrentPlatform(version: string): string {
    const platform = process.platform;
    const arch = process.arch;

    if (platform === 'darwin' && arch === 'arm64') {
        return `deep-filter-${version}-aarch64-apple-darwin`;
    }
    if (platform === 'darwin' && arch === 'x64') {
        return `deep-filter-${version}-x86_64-apple-darwin`;
    }
    if (platform === 'linux' && arch === 'arm64') {
        return `deep-filter-${version}-aarch64-unknown-linux-gnu`;
    }
    if (platform === 'linux' && arch === 'x64') {
        return `deep-filter-${version}-x86_64-unknown-linux-musl`;
    }
    if (platform === 'win32' && arch === 'x64') {
        return `deep-filter-${version}-x86_64-pc-windows-msvc.exe`;
    }

    throw new Error(`Unsupported platform for deep-filter binary: ${platform}/${arch}`);
}

async function run(cmd: string, args: string[]): Promise<void> {
    const proc = Bun.spawn([cmd, ...args], { stderr: 'inherit', stdout: 'inherit' });
    const exitCode = await proc.exited;
    if (exitCode !== 0) {
        throw new Error(`${cmd} ${args.join(' ')} failed with exit code ${exitCode}`);
    }
}

async function outputOf(cmd: string, args: string[]): Promise<{ exitCode: number; stdout: string; stderr: string }> {
    const proc = Bun.spawn([cmd, ...args], { stderr: 'pipe', stdout: 'pipe' });
    const [stdout, stderr, exitCode] = await Promise.all([
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
        proc.exited,
    ]);
    return { exitCode, stderr: stderr.trim(), stdout: stdout.trim() };
}

async function installDeepFilter(): Promise<void> {
    const binDir = resolve('tools', 'enhance', 'bin');
    await mkdir(binDir, { recursive: true });

    const asset = assetForCurrentPlatform(DEEP_FILTER_VERSION);
    const fileName = process.platform === 'win32' ? 'deep-filter.exe' : 'deep-filter';
    const deepFilterPath = join(binDir, fileName);

    if (await pathExists(deepFilterPath)) {
        const probe = await outputOf(deepFilterPath, ['--version']);
        if (probe.exitCode === 0 && `${probe.stdout}\n${probe.stderr}`.includes(DEEP_FILTER_VERSION)) {
            console.log(`[setup-enhance] deep-filter ${DEEP_FILTER_VERSION} already installed`);
            return;
        }
    }

    const url = `https://github.com/Rikorose/DeepFilterNet/releases/download/v${DEEP_FILTER_VERSION}/${asset}`;
    console.log(`[setup-enhance] Downloading ${url}`);

    const res = await fetch(url);
    if (!res.ok) {
        throw new Error(`Failed to download deep-filter: HTTP ${res.status}`);
    }
    const body = await res.arrayBuffer();
    await Bun.write(deepFilterPath, body);

    if (process.platform !== 'win32') {
        await chmod(deepFilterPath, 0o755);
    }

    const verify = await outputOf(deepFilterPath, ['--version']);
    if (verify.exitCode !== 0) {
        throw new Error(`Installed deep-filter is not executable: ${deepFilterPath}`);
    }
    console.log(`[setup-enhance] Installed ${verify.stdout || verify.stderr}`);
}

async function main(): Promise<void> {
    const pythonVersion = process.env.BPB_PYTHON_VERSION ?? '3.14';
    const venvDir = resolve('tools', 'enhance', '.venv');
    const pythonBin =
        process.platform === 'win32' ? join(venvDir, 'Scripts', 'python.exe') : join(venvDir, 'bin', 'python');

    await run('uv', ['--version']);
    await run('uv', ['venv', venvDir, '--python', pythonVersion]);
    await run('uv', ['pip', 'install', '--python', pythonBin, '-r', resolve('tools', 'enhance', 'requirements.txt')]);
    await installDeepFilter();

    console.log('[setup-enhance] Complete');
}

main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
});
