import { join } from "node:path";
import { readFile } from "node:fs/promises";
import { runCommand } from "./utils";

export type YtDlpInfo = {
  id: string;
  title?: string;
  description?: string;
  webpage_url?: string;
  uploader?: string;
  uploader_id?: string;
  channel?: string;
  channel_id?: string;
  duration?: number;
  upload_date?: string;
  timestamp?: number;
  chapters?: Array<{
    start_time?: number;
    end_time?: number;
    title?: string;
  }>;
  ext?: string;
};

export async function getYtDlpId(url: string): Promise<string> {
  const result = await runCommand("yt-dlp", [
    "--no-playlist",
    "--skip-download",
    "--print",
    "%(id)s",
    url,
  ]);
  if (result.exitCode !== 0) {
    throw new Error(`yt-dlp failed to get id: exit code ${result.exitCode}`);
  }
  const lines = result.stdout.trim().split("\n").filter(Boolean);
  if (lines.length === 0) {
    throw new Error("yt-dlp returned empty id");
  }
  return lines[lines.length - 1];
}

export async function downloadAudio(
  url: string,
  opts: {
    outputDir: string;
    format: string;
    downloadVideo: boolean;
    id: string;
    forceOverwrites?: boolean;
  }
): Promise<{
  info: YtDlpInfo;
  infoJson: string;
  filePath: string;
  infoJsonPath: string;
}> {
  const outputTemplate = join(opts.outputDir, "%(id)s.%(ext)s");
  const args = [
    "--no-playlist",
    "--write-info-json",
    "-o",
    outputTemplate,
  ];

  if (opts.forceOverwrites) {
    args.push("--force-overwrites");
  }

  if (opts.downloadVideo) {
    args.push("-f", "bestvideo+bestaudio/best");
  } else {
    args.push("-f", opts.format);
  }

  args.push(url);

  const result = await runCommand("yt-dlp", args, { stream: true });
  if (result.exitCode !== 0) {
    throw new Error(`yt-dlp download failed: exit code ${result.exitCode}`);
  }

  const infoJsonPath = join(opts.outputDir, `${opts.id}.info.json`);
  const infoRaw = await readFile(infoJsonPath, "utf-8");
  const info = JSON.parse(infoRaw) as YtDlpInfo;
  if (!info.id) {
    throw new Error("yt-dlp info.json missing id");
  }
  const ext = info.ext ?? "webm";
  const filePath = join(opts.outputDir, `${info.id}.${ext}`);
  return { info, infoJson: infoRaw, filePath, infoJsonPath };
}
