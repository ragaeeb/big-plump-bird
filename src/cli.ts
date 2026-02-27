import { resolve } from 'node:path';
import { loadConfig } from './core/config';
import { openDb, searchSegments } from './core/db';
import { ensureModelReady } from './core/model';
import { runPipeline } from './core/pipeline';
import { formatTimestamp } from './core/utils';

const HELP = `
Usage:
  bpb run --paths <file_or_dir> [--paths <file_or_dir>] [--urls <urls.txt>] [--url <url>] [options]
  bpb search "query" [--limit 10]

Options:
  --config <path>                Path to config.json (default: ./config.json)
  --paths <path>                 File or directory to process (repeatable)
  --urls <path>                  Text file with one URL per line
  --url <url>                    URL input (video/playlist/channel; repeatable)
  --engine <engine>              Transcription engine: whisperx|tafrigh (default: whisperx)
  --language <lang>              Language code (default: en)
  --model <name_or_path>         WhisperX model (default: turbo; ignored for tafrigh)
  --whisperx-compute-type <type> WhisperX compute type: int8|float16|float32
  --whisperx-batch-size <n>      WhisperX batch size
  --auto-download-model <bool>   Auto-download missing local model files
  --model-download-url <url>     URL used when downloading missing local model files
  --output-formats <list>        Comma-separated output formats (json,txt,srt,vtt,tsv)
  --jobs <n>                      Max concurrent jobs
  --keep-wav                      Keep derived WAV files
  --keep-source-audio <bool>     Keep downloaded reference audio (default: true)
  --download-video               Download full video instead of audio-only
  --force                         Reprocess even if transcript exists
  --dry-run                       Show planned operations without running commands
  -h, --help                      Show help

Tafrigh (wit.ai cloud engine):
  --wit-ai-api-keys <keys>       Comma-separated wit.ai API keys (required when --engine tafrigh)
                                 Can also be set via WIT_AI_API_KEYS env var (space-separated)

Enhancement:
  --enhance <mode>               off|auto|on|analyze-only (default: off)
  --source-class <class>         auto|studio|podium|far-field|cassette
  --enhance-atten-lim-db <n>    DeepFilterNet attenuation limit in dB (default: 12)
  --enhance-dereverb <mode>      off|auto|on (default: off)
  --enhance-snr-threshold <n>    Skip enhancement above this SNR (default: 15)
  --enhance-plan-in <dir>        Load pre-edited plan JSONs from directory
  --enhance-plan-out <dir>       Save analysis/plan JSONs to directory for review
  --enhance-keep-intermediate    Keep enhanced WAV and working files
  --enhance-fail-policy <p>      fallback_raw|fail (default: fallback_raw)
  --enhance-deep-filter-bin <p>  Path to deep-filter binary
`;

type ParsedArgs = {
    command: string | null;
    flags: Record<string, string | string[] | boolean>;
    positionals: string[];
};

type RunFlagContext = {
    dryRun: boolean;
    enhancePlanIn?: string;
    enhancePlanOut?: string;
    force: boolean;
    paths: string[];
    urls?: string[];
    urlsFile?: string;
};

const NUMERIC_FLAGS = new Set([
    'enhance-atten-lim-db',
    'enhance-snr-threshold',
    'jobs',
    'limit',
    'whisperx-batch-size',
]);

function isNumericLiteral(value: string): boolean {
    return /^-?\d+(\.\d+)?$/.test(value.trim());
}

function parseArgs(args: string[]): ParsedArgs {
    const flags: Record<string, string | string[] | boolean> = {};
    const positionals: string[] = [];
    let command: string | null = null;

    for (let i = 0; i < args.length; i++) {
        const arg = args[i];
        if (shouldCaptureCommand(command, arg)) {
            command = arg;
            continue;
        }

        if (isHelpFlag(arg)) {
            flags.help = true;
            continue;
        }

        if (arg.startsWith('--')) {
            const parsed = parseLongFlag(args, i);
            appendFlagValue(flags, parsed.key, parsed.value);
            i = parsed.nextIndex;
            continue;
        }

        positionals.push(arg);
    }

    return { command, flags, positionals };
}

function shouldCaptureCommand(currentCommand: string | null, arg: string): boolean {
    return !currentCommand && !arg.startsWith('-');
}

function isHelpFlag(arg: string): boolean {
    return arg === '-h' || arg === '--help';
}

function parseLongFlag(args: string[], index: number): { key: string; nextIndex: number; value: string | boolean } {
    const arg = args[index];
    const eqIdx = arg.indexOf('=');
    const key = eqIdx === -1 ? arg.slice(2) : arg.slice(2, eqIdx);
    let value: string | boolean | undefined = eqIdx === -1 ? undefined : arg.slice(eqIdx + 1);
    let nextIndex = index;

    if (value === undefined && index + 1 < args.length) {
        const nextArg = args[index + 1];
        if (canConsumeAsFlagValue(key, nextArg)) {
            value = nextArg;
            nextIndex += 1;
        }
    }

    return {
        key,
        nextIndex,
        value: value ?? true,
    };
}

function canConsumeAsFlagValue(key: string, candidate: string): boolean {
    if (!candidate.startsWith('-')) {
        return true;
    }
    return NUMERIC_FLAGS.has(key) && isNumericLiteral(candidate);
}

function appendFlagValue(
    flags: Record<string, string | string[] | boolean>,
    key: string,
    value: string | boolean,
): void {
    const existing = flags[key];
    if (existing === undefined) {
        flags[key] = value;
        return;
    }
    if (Array.isArray(existing)) {
        existing.push(String(value));
        return;
    }
    flags[key] = [String(existing), String(value)];
}

function toArray(value: string | string[] | boolean | undefined, splitComma = false): string[] {
    if (!value) {
        return [];
    }
    if (Array.isArray(value)) {
        return splitComma ? value.flatMap((v) => v.split(',')) : value;
    }
    if (typeof value === 'boolean') {
        return [];
    }
    return splitComma ? value.split(',') : [value];
}

function toBoolean(value: string | string[] | boolean | undefined, defaultValue: boolean): boolean {
    if (typeof value === 'boolean') {
        return value;
    }
    if (Array.isArray(value)) {
        return toBoolean(value[value.length - 1], defaultValue);
    }
    if (value === undefined) {
        return defaultValue;
    }
    const normalized = value.toLowerCase();
    if (['true', '1', 'yes', 'y'].includes(normalized)) {
        return true;
    }
    if (['false', '0', 'no', 'n'].includes(normalized)) {
        return false;
    }
    return defaultValue;
}

function toNumber(value: string | string[] | boolean | undefined, defaultValue: number): number {
    if (typeof value === 'boolean' || value === undefined) {
        return defaultValue;
    }
    const raw = Array.isArray(value) ? value[value.length - 1] : value;
    const parsed = Number.parseFloat(raw);
    return Number.isNaN(parsed) ? defaultValue : parsed;
}

async function main() {
    const parsed = parseArgs(Bun.argv.slice(2));
    if (parsed.flags.help || !parsed.command) {
        console.log(HELP);
        return;
    }

    const configPath = String(parsed.flags.config ?? resolve('config.json'));
    const baseConfig = await loadConfig(configPath);
    const config = resolveRunConfig(baseConfig, parsed.flags);

    switch (parsed.command) {
        case 'run':
            await handleRunCommand(parsed.flags, config);
            return;
        case 'search':
            await handleSearchCommand(parsed.positionals, parsed.flags, config.dbPath);
            return;
        default:
            console.error(`Unknown command: ${parsed.command}\n`);
            console.error(HELP);
            process.exitCode = 1;
    }
}

function resolveRunConfig(baseConfig: Awaited<ReturnType<typeof loadConfig>>, flags: ParsedArgs['flags']) {
    const engine = typeof flags.engine === 'string' ? (flags.engine as typeof baseConfig.engine) : baseConfig.engine;
    const enhanceBase = baseConfig.enhancement;
    const enhancement = {
        ...enhanceBase,
        attenLimDb: toNumber(flags['enhance-atten-lim-db'], enhanceBase.attenLimDb),
        deepFilterBin:
            typeof flags['enhance-deep-filter-bin'] === 'string'
                ? flags['enhance-deep-filter-bin']
                : enhanceBase.deepFilterBin,
        dereverbMode:
            typeof flags['enhance-dereverb'] === 'string'
                ? (flags['enhance-dereverb'] as typeof enhanceBase.dereverbMode)
                : enhanceBase.dereverbMode,
        failPolicy:
            typeof flags['enhance-fail-policy'] === 'string'
                ? (flags['enhance-fail-policy'] as typeof enhanceBase.failPolicy)
                : enhanceBase.failPolicy,
        keepIntermediate: toBoolean(flags['enhance-keep-intermediate'], enhanceBase.keepIntermediate),
        mode: typeof flags.enhance === 'string' ? (flags.enhance as typeof enhanceBase.mode) : enhanceBase.mode,
        snrSkipThresholdDb: toNumber(flags['enhance-snr-threshold'], enhanceBase.snrSkipThresholdDb),
        sourceClass:
            typeof flags['source-class'] === 'string'
                ? (flags['source-class'] as typeof enhanceBase.sourceClass)
                : enhanceBase.sourceClass,
    };

    return {
        ...baseConfig,
        autoDownloadModel: toBoolean(flags['auto-download-model'], baseConfig.autoDownloadModel),
        downloadVideo: toBoolean(flags['download-video'], baseConfig.downloadVideo),
        engine,
        enhancement,
        jobs: resolveJobs(flags.jobs, baseConfig.jobs),
        keepSourceAudio: toBoolean(flags['keep-source-audio'], baseConfig.keepSourceAudio),
        keepWav: toBoolean(flags['keep-wav'], baseConfig.keepWav),
        language: typeof flags.language === 'string' ? flags.language : baseConfig.language,
        modelDownloadUrl:
            typeof flags['model-download-url'] === 'string' ? flags['model-download-url'] : baseConfig.modelDownloadUrl,
        modelPath: typeof flags.model === 'string' ? flags.model : baseConfig.modelPath,
        outputFormats: resolveOutputFormats(flags['output-formats'], baseConfig.outputFormats),
        whisperxBatchSize: Math.max(1, toNumber(flags['whisperx-batch-size'], baseConfig.whisperxBatchSize)),
        whisperxComputeType:
            typeof flags['whisperx-compute-type'] === 'string'
                ? (flags['whisperx-compute-type'] as typeof baseConfig.whisperxComputeType)
                : baseConfig.whisperxComputeType,
        witAiApiKeys: resolveWitAiApiKeys(flags['wit-ai-api-keys'], baseConfig.witAiApiKeys),
    };
}

function resolveWitAiApiKeys(flagValue: string | string[] | boolean | undefined, fallback: string[]): string[] {
    const fromFlag = toArray(flagValue, true)
        .map((key) => key.trim())
        .filter(Boolean);
    if (fromFlag.length > 0) {
        return fromFlag;
    }
    const fromEnv = (process.env.WIT_AI_API_KEYS ?? '').trim();
    if (fromEnv.length > 0) {
        return fromEnv.split(/\\s+/).filter(Boolean);
    }
    return fallback;
}

function resolveOutputFormats(value: string | string[] | boolean | undefined, fallback: string[]): string[] {
    const provided = toArray(value, true)
        .map((entry) => entry.trim())
        .filter(Boolean);
    if (provided.length > 0) {
        return provided;
    }
    return fallback;
}

function resolveJobs(value: string | string[] | boolean | undefined, fallback: number): number {
    const parsedJobs = toNumber(value, fallback);
    if (Number.isFinite(parsedJobs)) {
        return Math.max(1, Math.round(parsedJobs));
    }
    return Math.max(1, fallback);
}

function resolveRunFlags(flags: ParsedArgs['flags']): RunFlagContext {
    return {
        dryRun: toBoolean(flags['dry-run'], false),
        enhancePlanIn: typeof flags['enhance-plan-in'] === 'string' ? resolve(flags['enhance-plan-in']) : undefined,
        enhancePlanOut: typeof flags['enhance-plan-out'] === 'string' ? resolve(flags['enhance-plan-out']) : undefined,
        force: toBoolean(flags.force, false),
        paths: toArray(flags.paths)
            .map((path) => resolve(path.trim()))
            .filter(Boolean),
        urls: toArray(flags.url)
            .map((url) => url.trim())
            .filter(Boolean),
        urlsFile: typeof flags.urls === 'string' ? resolve(flags.urls) : undefined,
    };
}

async function handleRunCommand(
    flags: ParsedArgs['flags'],
    config: Awaited<ReturnType<typeof loadConfig>>,
): Promise<void> {
    const runFlags = resolveRunFlags(flags);
    const runConfig = runFlags.dryRun ? config : await ensureModelReady(config);
    const abortController = new AbortController();
    let interrupted = false;

    const handleSignal = (signal: NodeJS.Signals) => {
        if (interrupted) {
            console.error(`Received ${signal} again. Still shutting down...`);
            return;
        }
        interrupted = true;
        abortController.abort(signal);
        console.error(`Received ${signal}. Cancelling remaining work...`);
    };

    process.on('SIGINT', handleSignal);
    process.on('SIGTERM', handleSignal);

    try {
        try {
            await runPipeline(runConfig, {
                abortSignal: abortController.signal,
                dryRun: runFlags.dryRun,
                enhancePlanIn: runFlags.enhancePlanIn,
                enhancePlanOut: runFlags.enhancePlanOut,
                force: runFlags.force,
                paths: runFlags.paths,
                urls: runFlags.urls,
                urlsFile: runFlags.urlsFile,
            });
        } catch (error) {
            if (!interrupted) {
                throw error;
            }
        }
    } finally {
        process.off('SIGINT', handleSignal);
        process.off('SIGTERM', handleSignal);
    }

    if (interrupted) {
        process.exitCode = 130;
    }
}

async function handleSearchCommand(positionals: string[], flags: ParsedArgs['flags'], dbPath: string): Promise<void> {
    const query = positionals.join(' ');
    if (!query) {
        console.log('Provide a search query.\\n');
        console.log(HELP);
        return;
    }

    const limit = toNumber(flags.limit, 10);
    const db = await openDb(dbPath);
    try {
        const results = searchSegments(db, query, limit);
        for (const row of results) {
            const start = formatTimestamp(row.start_ms);
            const end = formatTimestamp(row.end_ms);
            console.log(`${row.video_id} [${start} - ${end}] ${row.text}`);
        }
    } finally {
        db.close(false);
    }
}

main().catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(message);
    process.exitCode = 1;
});
