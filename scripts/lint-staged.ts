async function runOutput(cmd: string, args: string[]): Promise<{ exitCode: number; stderr: string; stdout: string }> {
    const proc = Bun.spawn([cmd, ...args], { stderr: 'pipe', stdout: 'pipe' });
    const [stdout, stderr, exitCode] = await Promise.all([
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
        proc.exited,
    ]);
    return { exitCode, stderr: stderr.trim(), stdout: stdout.trim() };
}

async function main(): Promise<void> {
    const staged = await runOutput('git', ['diff', '--cached', '--name-only', '--diff-filter=ACMR']);
    if (staged.exitCode !== 0) {
        throw new Error(staged.stderr || 'failed to list staged files');
    }

    const files = staged.stdout
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean);
    if (files.length === 0) {
        console.log('[lint:staged] No staged files.');
        return;
    }

    const BIOME_FILE_EXTENSIONS = new Set([
        '.cjs',
        '.css',
        '.cts',
        '.js',
        '.json',
        '.jsonc',
        '.jsx',
        '.mjs',
        '.mts',
        '.ts',
        '.tsx',
    ]);
    const biomeFiles = files.filter((file) => {
        const match = file.toLowerCase().match(/\.[^./\\]+$/);
        return match ? BIOME_FILE_EXTENSIONS.has(match[0]) : false;
    });
    if (biomeFiles.length === 0) {
        console.log('[lint:staged] No staged files supported by Biome. Skipping.');
        return;
    }

    const check = Bun.spawn(['bunx', 'biome', 'check', ...biomeFiles], { stderr: 'inherit', stdout: 'inherit' });
    const exitCode = await check.exited;
    if (exitCode !== 0) {
        throw new Error(`biome check failed with exit code ${exitCode}`);
    }
}

main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
});
