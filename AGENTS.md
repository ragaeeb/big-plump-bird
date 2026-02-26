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
- `src/cli.ts`: CLI entrypoint (`bpb run`, `bpb search`)
- `src/core/pipeline.ts`: orchestration pipeline
- `src/core/enhance.ts`: audio enhancement orchestration (TypeScript ↔ Python bridge)
- `src/core/whisperx.ts`: WhisperX execution wrapper
- `src/core/yt_dlp.ts`: URL metadata/download integration
- `src/core/ffmpeg.ts`: audio conversion helpers
- `src/core/db.ts`: schema + inserts + FTS search + enhancement telemetry
- `src/core/config.ts`: config types and loading
- `src/web-api/`: Bun API layer used by the web dashboard
- `tools/enhance/analyze_audio.py`: VAD + noise regime detection + SNR estimation
- `tools/enhance/process_audio.py`: `deep-filter` CLI denoising + NARA-WPE dereverberation
- `tools/enhance/requirements.txt`: Python dependencies for enhancement venv
- `config.json`: local defaults
- `data/`: generated runtime data (ignored)

## Data Model Notes
- `videos`: source/metadata status rows
- `transcripts`: canonical transcript text + compact JSON
- `segments`: segment rows used by FTS search
- `segments_fts`: FTS5 index over segment text
- `chapters`: source chapter metadata when available
- `artifacts`: pointers to local files (`source_audio`, `transcript_json`, `audio_wav_enhanced`, etc.)
- `enhancement_runs`: per-video enhancement decisions, SNR, config, timing, versions
- `enhancement_segments`: per-regime metrics (noise RMS, centroid, actions applied, attenuation limit)

## Audio Enhancement Pipeline
- Optional pre-WhisperX enhancement stage: `--enhance auto|on|analyze-only`
- Tools: Silero VAD (segmentation), ruptures (regime detection), `deep-filter` (denoising), NARA-WPE (dereverberation)
- Python scripts in `tools/enhance/`, separate venv at `tools/enhance/.venv/`
- Orchestrator: `src/core/enhance.ts` → calls `analyze_audio.py` then `process_audio.py`
- SNR gate: skips enhancement for clean audio (configurable threshold, default 15 dB)
- Regime-aware: detects noise floor changes mid-file and applies per-regime parameters
- Human-in-the-loop: `--enhance-plan-out` saves analysis plans, `--enhance-plan-in` loads edited plans
- Fail policy: `fallback_raw` (default) continues with unenhanced audio on failure
- Telemetry: `enhancement_runs` and `enhancement_segments` DB tables track all decisions and metrics

## Package Managers (consistency)
- **JavaScript/TypeScript:** Bun (`bun install`, `bun run`, etc.). Do not use npm or yarn for project scripts or lockfiles.
- **Python (enhancement only):** uv. All Python dependency and venv operations for `tools/enhance/` use uv (e.g. `uv venv`, `uv pip install`). Do not use pip or pip-tools directly; use `bun run setup-enhance` which invokes uv. This keeps a single, fast, reproducible Python toolchain for the enhancement venv.

## External Dependencies
- Required on PATH:
  - `ffmpeg`
  - `yt-dlp`
  - `whisperx` (or local venv binary fallback)
- WhisperX bootstrap may require a Python environment and first-run model downloads.
  - Reproducible setup: `bun run setup-whisperx` (uses uv to create `.venv-whisperx` on Python 3.13 and installs WhisperX).
- Enhancement venv (optional, only if `--enhance` is not `off`):
  - Requires **uv** on PATH (https://docs.astral.sh/uv/).
  - Reproducible setup: `bun run setup-enhance` (uv creates `tools/enhance/.venv`, installs `tools/enhance/requirements.txt`, and installs `deep-filter` binary under `tools/enhance/bin/`)
  - `postinstall` now runs setup helpers once per fresh `node_modules` tree (sentinel in `node_modules/.cache/`), then skips on subsequent installs/updates (for example `bun update --latest`)
  - For full runtime setup (enhancement + WhisperX): `bun run setup`

## Expected Behavior
- `--force` means reprocess existing video IDs and refresh derived data.
- `--dry-run` prints planned work only.
- Keep live subprocess output visible during long-running operations.

## Dev Workflow
- Run CLI:
  - `bun run bpb run --paths <file_or_dir>`
  - `bun run bpb run --url "<youtube_url>"`
  - `bun run bpb run --paths <file> --enhance auto`
  - `bun run bpb run --paths <file> --enhance analyze-only --enhance-plan-out ./plans/`
  - `bun run bpb search "<query>"`
- Validate key path quickly after changes:
  1. Force run against `sample/audio.wav`.
  2. Check `transcripts.json` DB field shape (`b/e/w`).
  3. Confirm search returns results.
- Validate enhancement path:
  1. Set up venv with uv: `bun run setup-enhance` (or rely on postinstall).
  2. Run: `bun run bpb run --paths sample/audio.wav --enhance auto --force`
  3. Check `enhancement_runs` table for SNR, regime count, applied status.
  4. Compare transcription quality with and without enhancement.

## Change Guidance for Future Agents
- Prefer additive, backward-compatible DB changes.
- Keep disk-vs-DB duplication minimal.
- Treat transcript compactness as a performance requirement, not an optional optimization.
- If introducing UI/API layers, keep pipeline logic in reusable modules and avoid duplicating ingestion logic in handlers.
- Use **uv** for all Python (enhancement) venv and dependency management; do not use pip or pip-tools in scripts or docs.
