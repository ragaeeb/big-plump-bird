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
  --language <lang>              Whisper language (default: en)
  --model <name_or_path>         WhisperX model (default: turbo)
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
        if (!command && !arg.startsWith('-')) {
            command = arg;
            continue;
        }

        if (arg === '-h' || arg === '--help') {
            flags.help = true;
            continue;
        }

        if (arg.startsWith('--')) {
            const eqIdx = arg.indexOf('=');
            const key = eqIdx === -1 ? arg.slice(2) : arg.slice(2, eqIdx);
            const inlineValue = eqIdx === -1 ? undefined : arg.slice(eqIdx + 1);
            let value: string | boolean | undefined = inlineValue;

            if (value === undefined && i + 1 < args.length) {
                const nextArg = args[i + 1];
                const canUseNext = !nextArg.startsWith('-') || (NUMERIC_FLAGS.has(key) && isNumericLiteral(nextArg));
                if (canUseNext) {
                    value = nextArg;
                    i += 1;
                }
            }

            if (value === undefined) {
                value = true;
            }

            const existing = flags[key];
            if (existing !== undefined) {
                if (Array.isArray(existing)) {
                    existing.push(String(value));
                } else {
                    flags[key] = [String(existing), String(value)];
                }
            } else {
                flags[key] = value;
            }
            continue;
        }

        positionals.push(arg);
    }

    return { command, flags, positionals };
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

    const enhanceBase = baseConfig.enhancement;
    const enhancement = {
        ...enhanceBase,
        attenLimDb: toNumber(parsed.flags['enhance-atten-lim-db'], enhanceBase.attenLimDb),
        deepFilterBin:
            typeof parsed.flags['enhance-deep-filter-bin'] === 'string'
                ? parsed.flags['enhance-deep-filter-bin']
                : enhanceBase.deepFilterBin,
        dereverbMode:
            typeof parsed.flags['enhance-dereverb'] === 'string'
                ? (parsed.flags['enhance-dereverb'] as typeof enhanceBase.dereverbMode)
                : enhanceBase.dereverbMode,
        failPolicy:
            typeof parsed.flags['enhance-fail-policy'] === 'string'
                ? (parsed.flags['enhance-fail-policy'] as typeof enhanceBase.failPolicy)
                : enhanceBase.failPolicy,
        keepIntermediate: toBoolean(parsed.flags['enhance-keep-intermediate'], enhanceBase.keepIntermediate),
        mode:
            typeof parsed.flags.enhance === 'string'
                ? (parsed.flags.enhance as typeof enhanceBase.mode)
                : enhanceBase.mode,
        snrSkipThresholdDb: toNumber(parsed.flags['enhance-snr-threshold'], enhanceBase.snrSkipThresholdDb),
        sourceClass:
            typeof parsed.flags['source-class'] === 'string'
                ? (parsed.flags['source-class'] as typeof enhanceBase.sourceClass)
                : enhanceBase.sourceClass,
    };

    const config = {
        ...baseConfig,
        autoDownloadModel: toBoolean(parsed.flags['auto-download-model'], baseConfig.autoDownloadModel),
        downloadVideo: toBoolean(parsed.flags['download-video'], baseConfig.downloadVideo),
        enhancement,
        jobs: (() => {
            const parsedJobs = toNumber(parsed.flags.jobs, baseConfig.jobs);
            return Number.isFinite(parsedJobs) ? Math.max(1, Math.round(parsedJobs)) : Math.max(1, baseConfig.jobs);
        })(),
        keepSourceAudio: toBoolean(parsed.flags['keep-source-audio'], baseConfig.keepSourceAudio),
        keepWav: toBoolean(parsed.flags['keep-wav'], baseConfig.keepWav),
        language: typeof parsed.flags.language === 'string' ? parsed.flags.language : baseConfig.language,
        modelDownloadUrl:
            typeof parsed.flags['model-download-url'] === 'string'
                ? parsed.flags['model-download-url']
                : baseConfig.modelDownloadUrl,
        modelPath: typeof parsed.flags.model === 'string' ? parsed.flags.model : baseConfig.modelPath,
        outputFormats: (() => {
            const provided = toArray(parsed.flags['output-formats'], true);
            if (provided.length === 0) {
                return baseConfig.outputFormats;
            }
            return provided.map((f) => f.trim()).filter(Boolean);
        })(),
        whisperxBatchSize: Math.max(1, toNumber(parsed.flags['whisperx-batch-size'], baseConfig.whisperxBatchSize)),
        whisperxComputeType:
            typeof parsed.flags['whisperx-compute-type'] === 'string'
                ? (parsed.flags['whisperx-compute-type'] as typeof baseConfig.whisperxComputeType)
                : baseConfig.whisperxComputeType,
    };

    if (parsed.command === 'run') {
        const paths = toArray(parsed.flags.paths)
            .map((p) => resolve(p.trim()))
            .filter(Boolean);
        const urlsFile = typeof parsed.flags.urls === 'string' ? resolve(parsed.flags.urls) : undefined;
        const urls = toArray(parsed.flags.url)
            .map((u) => u.trim())
            .filter(Boolean);
        const force = toBoolean(parsed.flags.force, false);
        const dryRun = toBoolean(parsed.flags['dry-run'], false);
        const enhancePlanIn =
            typeof parsed.flags['enhance-plan-in'] === 'string' ? resolve(parsed.flags['enhance-plan-in']) : undefined;
        const enhancePlanOut =
            typeof parsed.flags['enhance-plan-out'] === 'string'
                ? resolve(parsed.flags['enhance-plan-out'])
                : undefined;
        const runConfig = dryRun ? config : await ensureModelReady(config);
        let interrupted = false;
        const handleSignal = (signal: NodeJS.Signals) => {
            interrupted = true;
            console.error(`Received ${signal}. Waiting for active work to finish...`);
        };
        process.once('SIGINT', handleSignal);
        process.once('SIGTERM', handleSignal);

        try {
            await runPipeline(runConfig, {
                dryRun,
                enhancePlanIn,
                enhancePlanOut,
                force,
                paths,
                urls,
                urlsFile,
            });
        } finally {
            process.off('SIGINT', handleSignal);
            process.off('SIGTERM', handleSignal);
        }

        if (interrupted) {
            process.exitCode = 130;
        }
        return;
    }

    if (parsed.command === 'search') {
        const query = parsed.positionals.join(' ');
        if (!query) {
            console.log('Provide a search query.\n');
            console.log(HELP);
            return;
        }
        const limit = toNumber(parsed.flags.limit, 10);
        const db = await openDb(config.dbPath);
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
        return;
    }

    console.error(`Unknown command: ${parsed.command}\n`);
    console.error(HELP);
    process.exitCode = 1;
}

main().catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(message);
    process.exitCode = 1;
});
