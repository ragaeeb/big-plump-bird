import { pathExists } from "./utils";

export type RunConfig = {
  dataDir: string;
  dbPath: string;
  modelPath: string;
  autoDownloadModel: boolean;
  modelDownloadUrl: string;
  language: string;
  jobs: number;
  keepWav: boolean;
  downloadVideo: boolean;
  keepSourceAudio: boolean;
  sourceAudioFormat: string;
  sourceAudioMaxAbrKbps: number;
  outputFormats: string[];
};

export const DEFAULT_CONFIG: RunConfig = {
  dataDir: "/Users/rhaq/workspace/big-pump-bird/data",
  dbPath: "/Users/rhaq/workspace/big-pump-bird/data/bpb.sqlite",
  modelPath: "large-v3",
  autoDownloadModel: true,
  modelDownloadUrl:
    "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-large-v3.bin",
  language: "en",
  jobs: 1,
  keepWav: false,
  downloadVideo: false,
  keepSourceAudio: true,
  sourceAudioFormat: "opus-webm",
  sourceAudioMaxAbrKbps: 128,
  outputFormats: ["txt", "json"],
};

export async function loadConfig(configPath: string): Promise<RunConfig> {
  if (!(await pathExists(configPath))) {
    return { ...DEFAULT_CONFIG };
  }
  const raw = await Bun.file(configPath).text();
  const parsed = JSON.parse(raw) as Partial<RunConfig>;
  return {
    ...DEFAULT_CONFIG,
    ...parsed,
    outputFormats: parsed.outputFormats ?? DEFAULT_CONFIG.outputFormats,
  };
}
