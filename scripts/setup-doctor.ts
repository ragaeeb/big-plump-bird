const CHECKS: Array<{ cmd: string; args: string[]; requiredFor: 'all' | 'full' }> = [
    { args: ['--version'], cmd: 'ffmpeg', requiredFor: 'all' },
    { args: ['--version'], cmd: 'yt-dlp', requiredFor: 'all' },
    { args: ['--version'], cmd: 'uv', requiredFor: 'full' },
];

async function isAvailable(cmd: string, args: string[]): Promise<boolean> {
    try {
        const proc = Bun.spawn([cmd, ...args], {
            stderr: 'ignore',
            stdout: 'ignore',
        });
        return (await proc.exited) === 0;
    } catch {
        return false;
    }
}

function printResult(ok: boolean, label: string): void {
    const status = ok ? 'OK' : 'MISSING';
    console.log(`[setup:doctor] ${status} ${label}`);
}

async function main(): Promise<void> {
    console.log('[setup:doctor] Checking local development prerequisites...');
    console.log(`[setup:doctor] Bun ${Bun.version}`);

    const results = await Promise.all(
        CHECKS.map(async (check) => ({
            ...check,
            ok: await isAvailable(check.cmd, check.args),
        })),
    );

    const missingAll = results.filter((result) => !result.ok && result.requiredFor === 'all');
    const missingFull = results.filter((result) => !result.ok && result.requiredFor === 'full');

    for (const result of results) {
        printResult(
            result.ok,
            `${result.cmd} (${result.requiredFor === 'all' ? 'required' : 'required for full setup'})`,
        );
    }

    if (missingAll.length > 0) {
        console.error('[setup:doctor] Missing required tools for normal development. Install and retry.');
        process.exitCode = 1;
        return;
    }

    if (missingFull.length > 0) {
        console.log('[setup:doctor] Core dev is ready; full transcription setup is not ready yet.');
        console.log('[setup:doctor] Install missing tools above, then run: bun run setup:full');
        return;
    }

    console.log('[setup:doctor] Full setup prerequisites are available.');
    console.log('[setup:doctor] Next step: bun run setup:full');
}

main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
});
