type StepResult = {
    exitCode: number;
    name: string;
    optional: boolean;
};

async function run(script: string): Promise<number> {
    const proc = Bun.spawn(['bun', 'run', script], { stderr: 'inherit', stdout: 'inherit' });
    return await proc.exited;
}

async function runStep(step: { name: string; script: string; optional: boolean }): Promise<StepResult> {
    console.log(`[setup] Running ${step.name}...`);
    const exitCode = await run(step.script);
    if (exitCode !== 0) {
        const label = step.optional ? 'optional step failed' : 'required step failed';
        console.error(`[setup] ${label}: ${step.name} (exit ${exitCode})`);
    }
    return {
        exitCode,
        name: step.name,
        optional: step.optional,
    };
}

function printUsage(): void {
    console.log('Usage: bun run setup [--strict]');
    console.log('  default: installs web deps, then best-effort enhancement + whisperx setup');
    console.log('  --strict: fails if any setup step fails');
}

async function main(): Promise<void> {
    const args = Bun.argv.slice(2);
    if (args.includes('--help') || args.includes('-h')) {
        printUsage();
        return;
    }
    const strict = args.includes('--strict');

    const steps = [
        { name: 'web dependencies', optional: false, script: 'setup-web' },
        { name: 'enhancement environment', optional: true, script: 'setup-enhance' },
        { name: 'whisperx environment', optional: true, script: 'setup-whisperx' },
    ];
    const results: StepResult[] = [];
    for (const step of steps) {
        results.push(await runStep(step));
    }

    const requiredFailures = results.filter((result) => !result.optional && result.exitCode !== 0);
    const optionalFailures = results.filter((result) => result.optional && result.exitCode !== 0);
    const hasFailures = requiredFailures.length > 0 || (strict && optionalFailures.length > 0);

    if (requiredFailures.length > 0) {
        console.error('[setup] Failed required setup steps. Fix the errors above and re-run setup.');
    }

    if (optionalFailures.length > 0 && !strict) {
        console.log('[setup] Optional setup steps failed. Web development should still work.');
        console.log('[setup] To enable full transcription pipeline later, run:');
        console.log('  bun run setup-enhance');
        console.log('  bun run setup-whisperx');
    }

    if (optionalFailures.length > 0 && strict) {
        console.error('[setup] Optional steps failed and --strict was provided.');
    }

    if (hasFailures) {
        process.exitCode = 1;
        return;
    }

    console.log('[setup] Complete');
}

main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
});
