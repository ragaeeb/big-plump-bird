import { basename, dirname, extname, join } from "node:path";
import { rename, rm } from "node:fs/promises";
import { pathExists, runCommand } from "./utils";

export type WhisperXOutput = {
  outputBase: string;
  files: string[];
};

const OUTPUT_EXTENSIONS = ["json", "txt", "srt", "vtt", "tsv"] as const;
type OutputExt = (typeof OUTPUT_EXTENSIONS)[number];

function normalizeFormats(formats: string[]): OutputExt[] {
  const normalized = new Set<OutputExt>();
  for (const raw of formats) {
    const value = raw.toLowerCase();
    if (value === "json-full") {
      normalized.add("json");
      continue;
    }
    if (value === "json" || value === "txt" || value === "srt" || value === "vtt" || value === "tsv") {
      normalized.add(value);
    }
  }
  normalized.add("json");
  return Array.from(normalized);
}

async function runWhisperxCommand(args: string[]): Promise<void> {
  const candidates = [
    process.env.WHISPERX_BIN,
    "whisperx",
    join(process.cwd(), ".venv-whisperx311", "bin", "whisperx"),
    join(process.cwd(), ".venv", "bin", "whisperx"),
  ].filter((value): value is string => Boolean(value));

  const errors: string[] = [];
  for (const command of candidates) {
    try {
      const result = await runCommand(command, args, { stream: true });
      if (result.exitCode === 0) return;
      errors.push(`${command}: exit ${result.exitCode}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      errors.push(`${command}: ${message}`);
    }
  }

  throw new Error(
    `Failed to run whisperx. Tried: ${candidates.join(", ")}. ${errors.join(" | ")}`
  );
}

export async function runWhisperX(opts: {
  modelPath: string;
  wavPath: string;
  language: string;
  outputBase: string;
  formats: string[];
}): Promise<WhisperXOutput> {
  const outputDir = dirname(opts.outputBase);
  const requestedFormats = normalizeFormats(opts.formats);
  const inputStem = basename(opts.wavPath, extname(opts.wavPath));
  const outputStem = basename(opts.outputBase);

  const args = [
    opts.wavPath,
    "--model",
    opts.modelPath,
    "--language",
    opts.language,
    "--output_dir",
    outputDir,
    "--output_format",
    "all",
    "--compute_type",
    "int8",
    "--batch_size",
    "4",
    "--vad_method",
    "silero",
    "--print_progress",
    "True",
  ];

  await runWhisperxCommand(args);

  const keepExtensions = new Set<OutputExt>(requestedFormats);
  const files: string[] = [];

  for (const ext of OUTPUT_EXTENSIONS) {
    const generatedPath = join(outputDir, `${inputStem}.${ext}`);
    if (!(await pathExists(generatedPath))) continue;

    const targetPath = join(outputDir, `${outputStem}.${ext}`);
    if (generatedPath !== targetPath) {
      await rm(targetPath, { force: true });
      await rename(generatedPath, targetPath);
    }

    if (!keepExtensions.has(ext)) {
      await rm(targetPath, { force: true });
      continue;
    }
    files.push(targetPath);
  }

  return { outputBase: opts.outputBase, files };
}
