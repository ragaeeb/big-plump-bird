# Big Plump Bird

![Big Plump Bird](icon.png)

[![Bun](https://img.shields.io/badge/runtime-Bun-000000?logo=bun)](https://bun.sh)
[![WhisperX](https://img.shields.io/badge/transcription-WhisperX-4B32C3)](https://github.com/m-bain/whisperX)
[![SQLite](https://img.shields.io/badge/storage-SQLite-003B57?logo=sqlite)](https://sqlite.org)
[![License: MIT](https://img.shields.io/badge/license-MIT-green.svg)](https://github.com/ragaeeb/big-plump-bird/blob/main/LICENSE.md)
[![wakatime](https://wakatime.com/badge/user/a0b906ce-b8e7-4463-8bce-383238df6d4b/project/3ea24e32-7bd1-4eca-b0c1-1baca9cbcced.svg)](https://wakatime.com/badge/user/a0b906ce-b8e7-4463-8bce-383238df6d4b/project/3ea24e32-7bd1-4eca-b0c1-1baca9cbcced)

Local-first transcription pipeline for mixed Arabic + English media.

Big Plump Bird ingests local files or URLs, keeps relevant source metadata, transcribes with WhisperX, and stores searchable output in SQLite.

## Features
- URL and local file ingestion
- Audio-first download with source retention option
- WhisperX transcription with word-level timestamps
- SQLite storage with FTS search
- Compact transcript JSON in DB to reduce storage growth

## Tech Stack
- Bun + TypeScript CLI
- WhisperX
- yt-dlp
- ffmpeg
- SQLite (FTS5)

## Requirements
- Bun
- `ffmpeg` on PATH
- `yt-dlp` on PATH
- `whisperx` available on PATH (or local venv binary)

## Installation
```bash
bun install
```

## Quick Start
Run on local media:
```bash
bun run bpb run --paths /absolute/path/to/file-or-dir
```

Run on a single URL:
```bash
bun run bpb run --url "https://www.youtube.com/watch?v=VIDEO_ID"
```

Run on a URL list file:
```bash
bun run bpb run --urls /absolute/path/to/urls.txt
```

Search transcript content:
```bash
bun run bpb search "keyword phrase"
```

## Configuration
Defaults are in `config.json`.

Key options:
- `dataDir`
- `dbPath`
- `modelPath` (WhisperX model alias by default: `large-v3`)
- `autoDownloadModel` (if `modelPath` is a missing local file, download on first run)
- `modelDownloadUrl` (default: `https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-large-v3.bin`)
- `language` (default `en`)
- `keepWav`
- `keepSourceAudio`
- `outputFormats` (default `txt`, `json`)

## Model Download Behavior
- With default `modelPath: "large-v3"` (WhisperX): WhisperX handles model caching automatically.
- If you set `modelPath` to a local file path (example: `models/ggml-large-v3.bin`) and the file is missing:
  - `bpb run` auto-downloads it on first run using `curl -L -o ...`.
  - The download URL is `modelDownloadUrl` from `config.json`.

## Storage Layout
Generated artifacts are written under `data/`:
- `data/source_audio/`
- `data/audio/`
- `data/transcripts/<video_id>/`
- `data/bpb.sqlite`

## Data Notes
- Full raw transcript JSON is preserved on disk for provenance/debugging.
- SQLite transcript JSON is compact and word-oriented:
  - shape: `{ language, words: [{ b, e, w }] }`
  - `b`: begin time in ms
  - `e`: end time in ms
  - `w`: token/word text

## CLI Reference
```text
bpb run --paths <file_or_dir> [--paths <file_or_dir>] [--urls <urls.txt>] [--url <url>] [options]

Options:
  --config <path>
  --language <lang>
  --model <name_or_path>
  --output-formats <list>
  --jobs <n>
  --keep-wav
  --keep-source-audio <bool>
  --download-video
  --force
  --dry-run

bpb search "query" [--limit 10]
```

## Repository
- GitHub: [github.com/ragaeeb/big-plump-bird](https://github.com/ragaeeb/big-plump-bird)

## Author
- Ragaeeb Haq
- GitHub: [github.com/ragaeeb](https://github.com/ragaeeb)
