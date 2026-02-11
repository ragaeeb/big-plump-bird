import { join, resolve } from "node:path";
import { readdir, readFile, rm, stat } from "node:fs/promises";
import {
  openDb,
  hasTranscript,
  upsertVideo,
  insertTranscript,
  insertSegments,
  insertArtifacts,
  insertChapters,
  updateVideoStatus,
  deleteVideoData,
} from "./db";
import type { SegmentRecord, ArtifactRecord, ChapterRecord } from "./db";
import { convertToWav } from "./ffmpeg";
import { runWhisperX } from "./whisperx";
import { getYtDlpId, downloadAudio } from "./yt_dlp";
import { ensureDir, pathExists, sha256File, sha256String } from "./utils";
import type { RunConfig } from "./config";

export type RunOptions = {
  paths: string[];
  urlsFile?: string;
  urls?: string[];
  force: boolean;
  dryRun: boolean;
};

type InputItem =
  | { source_type: "file"; source_uri: string }
  | { source_type: "url"; source_uri: string };

type DataDirs = {
  dataDir: string;
  sourceAudioDir: string;
  audioDir: string;
  transcriptsDir: string;
};

export async function runPipeline(config: RunConfig, options: RunOptions): Promise<void> {
  const dirs = await ensureDataDirs(config.dataDir);
  const db = await openDb(config.dbPath);

  const inputs: InputItem[] = [];

  const expandedPaths = await expandPaths(options.paths);
  for (const filePath of expandedPaths) {
    inputs.push({ source_type: "file", source_uri: filePath });
  }

  if (options.urlsFile) {
    const urlLines = await readUrlFile(options.urlsFile);
    for (const url of urlLines) {
      inputs.push({ source_type: "url", source_uri: url });
    }
  }

  if (options.urls && options.urls.length > 0) {
    for (const url of options.urls) {
      const trimmed = url.trim();
      if (trimmed.length > 0) {
        inputs.push({ source_type: "url", source_uri: trimmed });
      }
    }
  }

  if (inputs.length === 0) {
    throw new Error("No inputs provided. Use --paths and/or --urls.");
  }

  const concurrency = Math.max(1, config.jobs);
  await runWithConcurrency(inputs, concurrency, async (item) => {
    await processInput(item, config, options, dirs, db);
  });
}

async function processInput(
  item: InputItem,
  config: RunConfig,
  options: RunOptions,
  dirs: DataDirs,
  db: Awaited<ReturnType<typeof openDb>>
): Promise<void> {
  const now = new Date().toISOString();
  let videoId: string | null = null;

  try {
    if (item.source_type === "url") {
      const url = item.source_uri;
      if (options.dryRun) {
        console.log(`[dry-run] Would download and transcribe URL: ${url}`);
        return;
      }
      videoId = await getYtDlpId(url);
      if (!options.force && hasTranscript(db, videoId)) {
        console.log(`Skipping (already transcribed): ${videoId}`);
        return;
      }
      if (options.force) {
        deleteVideoData(db, videoId);
      }

      upsertVideo(db, {
        video_id: videoId,
        source_type: "url",
        source_uri: url,
        status: "processing",
        created_at: now,
        updated_at: now,
      });

      const format = buildYtDlpFormat(config);
      const { info, infoJson, filePath, infoJsonPath } = await downloadAudio(url, {
        outputDir: dirs.sourceAudioDir,
        format,
        downloadVideo: config.downloadVideo,
        id: videoId,
        forceOverwrites: options.force,
      });

      const durationMs = info.duration ? Math.round(info.duration * 1000) : null;

      upsertVideo(db, {
        video_id: videoId,
        source_type: "url",
        source_uri: url,
        title: info.title ?? null,
        description: info.description ?? null,
        webpage_url: info.webpage_url ?? url,
        uploader: info.uploader ?? null,
        uploader_id: info.uploader_id ?? null,
        channel: info.channel ?? null,
        channel_id: info.channel_id ?? null,
        duration_ms: durationMs,
        upload_date: info.upload_date ?? null,
        timestamp: typeof info.timestamp === "number" ? info.timestamp : null,
        metadata_json: infoJson,
        local_path: filePath,
        status: "processing",
        created_at: now,
        updated_at: new Date().toISOString(),
      });

      const chapters = parseChapters(info, videoId);
      insertChapters(db, chapters);

      await transcribeAndStore({
        videoId,
        inputPath: filePath,
        sourceAudioPath: filePath,
        infoJsonPath,
        isUrl: true,
        config,
        dirs,
        db,
      });

      if (!config.keepSourceAudio) {
        await rm(filePath, { force: true });
      }
      return;
    }

    if (options.dryRun) {
      const filePath = resolve(item.source_uri);
      console.log(`[dry-run] Would transcribe file: ${filePath}`);
      return;
    }

    const filePath = resolve(item.source_uri);
    videoId = await sha256File(filePath);

    if (!options.force && hasTranscript(db, videoId)) {
      console.log(`Skipping (already transcribed): ${videoId}`);
      return;
    }
    if (options.force) {
      deleteVideoData(db, videoId);
    }

    upsertVideo(db, {
      video_id: videoId,
      source_type: "file",
      source_uri: filePath,
      local_path: filePath,
      status: "processing",
      created_at: now,
      updated_at: now,
    });

    await transcribeAndStore({
      videoId,
      inputPath: filePath,
      isUrl: false,
      config,
      dirs,
      db,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Error processing ${item.source_uri}: ${message}`);
    const id = videoId ?? sha256String(item.source_uri).slice(0, 16);
    const now = new Date().toISOString();
    upsertVideo(db, {
      video_id: id,
      source_type: item.source_type,
      source_uri: item.source_uri,
      status: "error",
      error: message,
      created_at: now,
      updated_at: now,
    });
  }
}

async function transcribeAndStore(opts: {
  videoId: string;
  inputPath: string;
  sourceAudioPath?: string;
  infoJsonPath?: string;
  isUrl: boolean;
  config: RunConfig;
  dirs: DataDirs;
  db: Awaited<ReturnType<typeof openDb>>;
}): Promise<void> {
  const { videoId, inputPath, sourceAudioPath, infoJsonPath, isUrl, config, dirs, db } =
    opts;
  const wavPath = join(dirs.audioDir, `${videoId}.wav`);
  const outputDir = join(dirs.transcriptsDir, videoId);
  const outputBase = join(outputDir, "transcript");

  await ensureDir(outputDir);

  await convertToWav(inputPath, wavPath);

  await runWhisperX({
    modelPath: config.modelPath,
    wavPath,
    language: config.language,
    outputBase,
    formats: config.outputFormats.map((f) => f.toLowerCase()),
  });

  const txtPath = `${outputBase}.txt`;
  const jsonPath = `${outputBase}.json`;

  const [txtExists, jsonExists] = await Promise.all([
    pathExists(txtPath),
    pathExists(jsonPath),
  ]);

  const text = txtExists ? await readFile(txtPath, "utf-8") : "";
  const json = jsonExists ? await readFile(jsonPath, "utf-8") : "";
  const parsedWhisper = json ? parseWhisperOutput(json, videoId) : null;
  const segments = parsedWhisper?.segments ?? [];
  const words = parsedWhisper?.words ?? [];
  const transcriptText =
    text || wordsToText(words) || segments.map((s) => s.text).join(" ").trim();
  const compactTranscriptJson = buildCompactTranscriptJson(
    parsedWhisper?.language ?? config.language,
    words
  );

  insertTranscript(db, {
    video_id: videoId,
    model: basename(config.modelPath),
    language: parsedWhisper?.language ?? config.language,
    text: transcriptText,
    json: compactTranscriptJson,
    created_at: new Date().toISOString(),
  });

  insertSegments(db, segments);

  const artifacts: ArtifactRecord[] = [];

  if (config.keepWav && (await pathExists(wavPath))) {
    artifacts.push({
      video_id: videoId,
      kind: "audio_wav",
      uri: wavPath,
      size_bytes: await fileSize(wavPath),
      created_at: new Date().toISOString(),
    });
  }

  if (isUrl && config.keepSourceAudio && sourceAudioPath) {
    artifacts.push({
      video_id: videoId,
      kind: "source_audio",
      uri: sourceAudioPath,
      size_bytes: await fileSize(sourceAudioPath),
      created_at: new Date().toISOString(),
    });
  }

  if (isUrl && infoJsonPath && (await pathExists(infoJsonPath))) {
    artifacts.push({
      video_id: videoId,
      kind: "source_info_json",
      uri: infoJsonPath,
      size_bytes: await fileSize(infoJsonPath),
      created_at: new Date().toISOString(),
    });
  }

  if (txtExists) {
    artifacts.push({
      video_id: videoId,
      kind: "transcript_txt",
      uri: txtPath,
      size_bytes: await fileSize(txtPath),
      created_at: new Date().toISOString(),
    });
  }

  if (jsonExists) {
    artifacts.push({
      video_id: videoId,
      kind: "transcript_json",
      uri: jsonPath,
      size_bytes: await fileSize(jsonPath),
      created_at: new Date().toISOString(),
    });
  }

  insertArtifacts(db, artifacts);
  updateVideoStatus(db, videoId, "done", null);

  if (!config.keepWav) {
    await rm(wavPath, { force: true });
  }
}

function basename(path: string): string {
  return path.split("/").pop() ?? path;
}

function parseWhisperOutput(
  jsonText: string,
  videoId: string
): { language: string | null; segments: SegmentRecord[]; words: WordRecord[] } {
  try {
    const parsed = JSON.parse(jsonText) as {
      language?: string;
      result?: { language?: string };
      params?: { language?: string };
      segments?: any[];
      transcription?: any[];
    };
    const language =
      (typeof parsed.result?.language === "string" && parsed.result.language) ||
      (typeof parsed.language === "string" && parsed.language) ||
      (typeof parsed.params?.language === "string" && parsed.params.language) ||
      null;
    const segmentsSource = Array.isArray(parsed.segments)
      ? parsed.segments
      : Array.isArray(parsed.transcription)
        ? parsed.transcription
        : [];
    const words: WordRecord[] = [];
    return {
      language,
      segments: segmentsSource
        .filter((seg) => typeof seg.text === "string")
        .map((seg) => {
          const wordItems = Array.isArray(seg.words) ? seg.words : [];
          const cleanWords = wordItems
            .filter(
              (word) =>
                typeof word.word === "string" &&
                typeof word.start === "number" &&
                typeof word.end === "number"
            )
            .map((word) => ({
              word: String(word.word).trim(),
              start_ms: Math.round(word.start * 1000),
              end_ms: Math.round(word.end * 1000),
            }))
            .filter((word) => word.word.length > 0);
          words.push(...cleanWords);

          const startMs =
            typeof seg.start === "number"
              ? Math.round(seg.start * 1000)
              : typeof seg.offsets?.from === "number"
                ? seg.offsets.from
                : cleanWords.length > 0
                  ? cleanWords[0].start_ms
                : 0;
          const endMs =
            typeof seg.end === "number"
              ? Math.round(seg.end * 1000)
              : typeof seg.offsets?.to === "number"
                ? seg.offsets.to
                : cleanWords.length > 0
                  ? cleanWords[cleanWords.length - 1].end_ms
                : startMs;
          const text = cleanWords.length > 0 ? joinWords(cleanWords.map((word) => word.word)) : String(seg.text).trim();
          return {
            video_id: videoId,
            start_ms: startMs,
            end_ms: endMs,
            text,
          };
        })
        .filter((seg) => seg.text.length > 0),
      words,
    };
  } catch {
    return { language: null, segments: [], words: [] };
  }
}

function buildCompactTranscriptJson(
  language: string,
  words: WordRecord[]
): string {
  const compact = {
    language,
    words: words.map((word) => ({
      b: word.start_ms,
      e: word.end_ms,
      w: word.word,
    })),
  };
  return JSON.stringify(compact);
}

type WordRecord = {
  word: string;
  start_ms: number;
  end_ms: number;
};

function joinWords(words: string[]): string {
  const raw = words.join(" ");
  return raw
    .replace(/\s+([,.;:!?،؟])/g, "$1")
    .replace(/\s+(['")\]}])/g, "$1")
    .replace(/([\[({])\s+/g, "$1")
    .trim();
}

function wordsToText(words: WordRecord[]): string {
  if (words.length === 0) return "";
  return joinWords(words.map((word) => word.word));
}

function parseChapters(info: { chapters?: Array<{ start_time?: number; end_time?: number; title?: string }> }, videoId: string): ChapterRecord[] {
  const chapters = info.chapters ?? [];
  return chapters
    .filter((chapter) => typeof chapter.start_time === "number")
    .map((chapter) => ({
      video_id: videoId,
      start_ms: Math.round((chapter.start_time ?? 0) * 1000),
      end_ms:
        typeof chapter.end_time === "number"
          ? Math.round(chapter.end_time * 1000)
          : null,
      title: String(chapter.title ?? "").trim() || "Chapter",
    }));
}

async function ensureDataDirs(dataDir: string): Promise<DataDirs> {
  const dataRoot = resolve(dataDir);
  const sourceAudioDir = join(dataRoot, "source_audio");
  const audioDir = join(dataRoot, "audio");
  const transcriptsDir = join(dataRoot, "transcripts");
  await ensureDir(sourceAudioDir);
  await ensureDir(audioDir);
  await ensureDir(transcriptsDir);
  return { dataDir: dataRoot, sourceAudioDir, audioDir, transcriptsDir };
}

async function expandPaths(paths: string[]): Promise<string[]> {
  const results: string[] = [];
  for (const inputPath of paths) {
    const resolved = resolve(inputPath);
    if (!(await pathExists(resolved))) continue;
    const stats = await stat(resolved);
    if (stats.isDirectory()) {
      const entries = await readdir(resolved, { withFileTypes: true });
      for (const entry of entries) {
        const childPath = join(resolved, entry.name);
        if (entry.isDirectory()) {
          const nested = await expandPaths([childPath]);
          results.push(...nested);
        } else if (entry.isFile()) {
          results.push(childPath);
        }
      }
    } else if (stats.isFile()) {
      results.push(resolved);
    }
  }
  return Array.from(new Set(results));
}

async function readUrlFile(filePath: string): Promise<string[]> {
  const raw = await readFile(filePath, "utf-8");
  return raw
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("#"));
}

function buildYtDlpFormat(config: RunConfig): string {
  if (config.sourceAudioFormat === "opus-webm") {
    const abr = config.sourceAudioMaxAbrKbps;
    return `bestaudio[acodec=opus][abr<=${abr}]/bestaudio[acodec=opus]/bestaudio[abr<=${abr}]/bestaudio`;
  }
  return "bestaudio";
}

async function fileSize(path: string): Promise<number> {
  const info = await stat(path);
  return info.size;
}

async function runWithConcurrency<T>(
  items: T[],
  limit: number,
  worker: (item: T) => Promise<void>
): Promise<void> {
  let index = 0;
  const workers = Array.from({ length: limit }, async () => {
    while (true) {
      const current = index++;
      if (current >= items.length) return;
      await worker(items[current]);
    }
  });
  await Promise.all(workers);
}
