import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { pathExists } from '../src/core/utils';

const SENTINEL_PATH = resolve('node_modules/.cache/bpb-postinstall-ran');

async function run(cmd: string, args: string[]): Promise<number> {
    const proc = Bun.spawn([cmd, ...args], {
        stderr: 'inherit',
        stdout: 'inherit',
    });
    return await proc.exited;
}

async function main(): Promise<void> {
    if (await pathExists(SENTINEL_PATH)) {
        console.log('[postinstall] First-time setup already ran for this node_modules. Skipping.');
        return;
    }

    console.log('[postinstall] First install detected. Running setup flow...');

    try {
        const hookExit = await run('bun', ['run', 'setup-git-hooks']);
        if (hookExit !== 0) {
            console.warn('[postinstall] setup-git-hooks failed. You can rerun manually with: bun run setup-git-hooks');
        }

        const enhanceExit = await run('bun', ['run', 'setup-enhance']);
        if (enhanceExit !== 0) {
            console.warn('[postinstall] setup-enhance failed. You can rerun manually with: bun run setup-enhance');
        }
    } finally {
        try {
            await mkdir(dirname(SENTINEL_PATH), { recursive: true });
            await writeFile(SENTINEL_PATH, `${new Date().toISOString()}\n`, 'utf-8');
            console.log('[postinstall] Setup flow marked complete for this install tree.');
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            console.error(`[postinstall] Failed to write sentinel: ${message}`);
        }
    }
}

main().catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[postinstall] ${message}`);
    process.exitCode = 1;
});
