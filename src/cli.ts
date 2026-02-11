import { resolve } from "node:path";
import { loadConfig } from "./config";
import { runPipeline } from "./pipeline";
import { openDb, searchSegments } from "./db";
import { formatTimestamp } from "./utils";
import { ensureModelReady } from "./model";

const HELP = `
Usage:
  bpb run --paths <file_or_dir> [--paths <file_or_dir>] [--urls <urls.txt>] [--url <url>] [options]
  bpb search "query" [--limit 10]

Options:
  --config <path>                Path to config.json (default: ./config.json)
  --paths <path>                 File or directory to process (repeatable)
  --urls <path>                  Text file with one URL per line
  --url <url>                    Single URL (repeatable)
  --language <lang>              Whisper language (default: en)
  --model <name_or_path>         WhisperX model (default: large-v3)
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
`;

type ParsedArgs = {
  command: string | null;
  flags: Record<string, string | string[] | boolean>;
  positionals: string[];
};

function parseArgs(args: string[]): ParsedArgs {
  const flags: Record<string, string | string[] | boolean> = {};
  const positionals: string[] = [];
  let command: string | null = null;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (!command && !arg.startsWith("-")) {
      command = arg;
      continue;
    }

    if (arg === "-h" || arg === "--help") {
      flags.help = true;
      continue;
    }

    if (arg.startsWith("--")) {
      const [key, inlineValue] = arg.slice(2).split("=", 2);
      let value: string | boolean | undefined = inlineValue;

      if (value === undefined && i + 1 < args.length && !args[i + 1].startsWith("-")) {
        value = args[i + 1];
        i += 1;
      }

      if (value === undefined) {
        value = true;
      }

      const existing = flags[key];
      if (existing) {
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

function toArray(value: string | string[] | boolean | undefined): string[] {
  if (!value) return [];
  if (Array.isArray(value)) return value.flatMap((v) => v.split(","));
  if (typeof value === "boolean") return [];
  return value.split(",");
}

function toBoolean(value: string | string[] | boolean | undefined, defaultValue: boolean): boolean {
  if (typeof value === "boolean") return value;
  if (Array.isArray(value)) return toBoolean(value[value.length - 1], defaultValue);
  if (value === undefined) return defaultValue;
  const normalized = value.toLowerCase();
  if (["true", "1", "yes", "y"].includes(normalized)) return true;
  if (["false", "0", "no", "n"].includes(normalized)) return false;
  return defaultValue;
}

function toNumber(value: string | string[] | boolean | undefined, defaultValue: number): number {
  if (typeof value === "boolean" || value === undefined) return defaultValue;
  const raw = Array.isArray(value) ? value[value.length - 1] : value;
  const parsed = Number.parseInt(raw, 10);
  return Number.isNaN(parsed) ? defaultValue : parsed;
}

async function main() {
  const parsed = parseArgs(Bun.argv.slice(2));
  if (parsed.flags.help || !parsed.command) {
    console.log(HELP);
    return;
  }

  const configPath = String(parsed.flags.config ?? resolve("config.json"));
  const baseConfig = await loadConfig(configPath);

  const config = {
    ...baseConfig,
    language: typeof parsed.flags.language === "string" ? parsed.flags.language : baseConfig.language,
    modelPath: typeof parsed.flags.model === "string" ? parsed.flags.model : baseConfig.modelPath,
    autoDownloadModel: toBoolean(
      parsed.flags["auto-download-model"],
      baseConfig.autoDownloadModel
    ),
    modelDownloadUrl:
      typeof parsed.flags["model-download-url"] === "string"
        ? parsed.flags["model-download-url"]
        : baseConfig.modelDownloadUrl,
    jobs: toNumber(parsed.flags.jobs, baseConfig.jobs),
    keepWav: toBoolean(parsed.flags["keep-wav"], baseConfig.keepWav),
    keepSourceAudio: toBoolean(
      parsed.flags["keep-source-audio"],
      baseConfig.keepSourceAudio
    ),
    downloadVideo: toBoolean(parsed.flags["download-video"], baseConfig.downloadVideo),
    outputFormats: (() => {
      const provided = toArray(parsed.flags["output-formats"]);
      if (provided.length === 0) return baseConfig.outputFormats;
      return provided.map((f) => f.trim()).filter(Boolean);
    })(),
  };

  if (parsed.command === "run") {
    const runConfig = await ensureModelReady(config);
    const paths = toArray(parsed.flags.paths).map((p) => resolve(p.trim())).filter(Boolean);
    const urlsFile = typeof parsed.flags.urls === "string" ? resolve(parsed.flags.urls) : undefined;
    const urls = toArray(parsed.flags.url).map((u) => u.trim()).filter(Boolean);
    const force = toBoolean(parsed.flags.force, false);
    const dryRun = toBoolean(parsed.flags["dry-run"], false);

    await runPipeline(runConfig, {
      paths,
      urlsFile,
      urls,
      force,
      dryRun,
    });
    return;
  }

  if (parsed.command === "search") {
    const query = parsed.positionals.join(" ");
    if (!query) {
      console.log("Provide a search query.\n");
      console.log(HELP);
      return;
    }
    const limit = toNumber(parsed.flags.limit, 10);
    const db = await openDb(config.dbPath);
    const results = searchSegments(db, query, limit);
    for (const row of results) {
      const start = formatTimestamp(row.start_ms);
      const end = formatTimestamp(row.end_ms);
      console.log(`${row.video_id} [${start} - ${end}] ${row.text}`);
    }
    return;
  }

  console.log(`Unknown command: ${parsed.command}\n`);
  console.log(HELP);
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exitCode = 1;
});
