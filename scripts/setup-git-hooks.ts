import { chmod } from 'node:fs/promises';
import { resolve } from 'node:path';

async function run(cmd: string, args: string[]): Promise<{ exitCode: number; stdout: string; stderr: string }> {
    const proc = Bun.spawn([cmd, ...args], { stderr: 'pipe', stdout: 'pipe' });
    const [stdout, stderr, exitCode] = await Promise.all([
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
        proc.exited,
    ]);
    return { exitCode, stderr: stderr.trim(), stdout: stdout.trim() };
}

async function main(): Promise<void> {
    const inRepo = await run('git', ['rev-parse', '--is-inside-work-tree']);
    if (inRepo.exitCode !== 0 || inRepo.stdout !== 'true') {
        console.log('[setup-git-hooks] Skipping (not inside a git repo).');
        return;
    }

    const hookPath = resolve('.githooks', 'pre-commit');
    await chmod(hookPath, 0o755);

    const config = await run('git', ['config', 'core.hooksPath', '.githooks']);
    if (config.exitCode !== 0) {
        throw new Error(config.stderr || 'failed to configure core.hooksPath');
    }

    console.log('[setup-git-hooks] Installed pre-commit hook via core.hooksPath=.githooks');
}

main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
});
