# AGENTS.md

## Project Identity
- Project name: Big Plump Bird
- Purpose: Local-first batch transcription pipeline for mixed Arabic + English audio/video using WhisperX, with searchable storage in SQLite.
- Runtime: Bun + TypeScript CLI.

## Current Scope (MVP)
- CLI-only workflow (no web UI yet).
- Input sources:
  - Local file paths / directories
  - URL list files
  - Single URL via `--url`
- URL handling: `yt-dlp` audio-first download, with source audio retention option.
- Transcription backend: WhisperX only.
- Storage: SQLite + local artifact files.

## Hard Constraints
- Do not reintroduce `whisper-cli` unless explicitly requested.
- Keep transcript payloads compact in DB:
  - `transcripts.json` must store word timestamps with short keys: `b` (begin ms), `e` (end ms), `w` (word).
  - Avoid duplicating segment `text` in compact JSON.
  - Avoid storing per-word `score` in compact JSON.
- Preserve full raw transcription JSON as on-disk artifact for provenance/debugging.

## Repo Layout
- `src/big_pump_bird/cli.ts`: CLI entrypoint (`bpb run`, `bpb search`)
- `src/big_pump_bird/pipeline.ts`: orchestration pipeline
- `src/big_pump_bird/whisperx.ts`: WhisperX execution wrapper
- `src/big_pump_bird/yt_dlp.ts`: URL metadata/download integration
- `src/big_pump_bird/ffmpeg.ts`: audio conversion helpers
- `src/big_pump_bird/db.ts`: schema + inserts + FTS search
- `config.json`: local defaults
- `data/`: generated runtime data (ignored)

## Data Model Notes
- `videos`: source/metadata status rows
- `transcripts`: canonical transcript text + compact JSON
- `segments`: segment rows used by FTS search
- `segments_fts`: FTS5 index over segment text
- `chapters`: source chapter metadata when available
- `artifacts`: pointers to local files (`source_audio`, `transcript_json`, etc.)

## External Dependencies
- Required on PATH:
  - `ffmpeg`
  - `yt-dlp`
  - `whisperx` (or local venv binary fallback)
- WhisperX bootstrap may require a Python environment and first-run model downloads.

## Expected Behavior
- `--force` means reprocess existing video IDs and refresh derived data.
- `--dry-run` prints planned work only.
- Keep live subprocess output visible during long-running operations.

## Dev Workflow
- Run CLI:
  - `bun run bpb run --paths <file_or_dir>`
  - `bun run bpb run --url "<youtube_url>"`
  - `bun run bpb search "<query>"`
- Validate key path quickly after changes:
  1. Force run against `sample/audio.wav`.
  2. Check `transcripts.json` DB field shape (`b/e/w`).
  3. Confirm search returns results.

## Change Guidance for Future Agents
- Prefer additive, backward-compatible DB changes.
- Keep disk-vs-DB duplication minimal.
- Treat transcript compactness as a performance requirement, not an optional optimization.
- If introducing UI/API layers, keep pipeline logic in reusable modules and avoid duplicating ingestion logic in handlers.
