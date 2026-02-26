# Big Plump Bird

![Big Plump Bird](icon.png)

[![Runtime: Bun](https://img.shields.io/badge/runtime-Bun-000000?logo=bun)](https://bun.sh)
[![CI](https://github.com/ragaeeb/big-plump-bird/actions/workflows/ci.yml/badge.svg)](https://github.com/ragaeeb/big-plump-bird/actions/workflows/ci.yml)
[![Release Please](https://github.com/ragaeeb/big-plump-bird/actions/workflows/release-please.yml/badge.svg)](https://github.com/ragaeeb/big-plump-bird/actions/workflows/release-please.yml)
[![TypeScript](https://img.shields.io/badge/language-TypeScript-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Frontend: React](https://img.shields.io/badge/frontend-React-61DAFB?logo=react&logoColor=111827)](https://react.dev)
[![Build: Vite](https://img.shields.io/badge/build-Vite-646CFF?logo=vite&logoColor=white)](https://vite.dev)
[![Lint/Format: Biome](https://img.shields.io/badge/lint%2Fformat-Biome-60A5FA)](https://biomejs.dev/)
[![Transcription: WhisperX](https://img.shields.io/badge/transcription-WhisperX-4B32C3)](https://github.com/m-bain/whisperX)
[![Storage: SQLite FTS5](https://img.shields.io/badge/storage-SQLite%20FTS5-003B57?logo=sqlite)](https://sqlite.org)
[![Python env: uv](https://img.shields.io/badge/python%20env-uv-6A5ACD)](https://docs.astral.sh/uv/)
[![License: MIT](https://img.shields.io/badge/license-MIT-green.svg)](https://github.com/ragaeeb/big-plump-bird/blob/main/LICENSE.md)
[![wakatime](https://wakatime.com/badge/user/a0b906ce-b8e7-4463-8bce-383238df6d4b/project/3ea24e32-7bd1-4eca-b0c1-1baca9cbcced.svg)](https://wakatime.com/badge/user/a0b906ce-b8e7-4463-8bce-383238df6d4b/project/3ea24e32-7bd1-4eca-b0c1-1baca9cbcced)
[![codecov](https://codecov.io/gh/ragaeeb/big-plump-bird/graph/badge.svg?token=NRA0QKYOHB)](https://codecov.io/gh/ragaeeb/big-plump-bird)
![CodeRabbit Pull Request Reviews](https://img.shields.io/coderabbit/prs/github/ragaeeb/big-plump-bird?utm_source=oss&utm_medium=github&utm_campaign=ragaeeb%2Fbig-plump-bird&labelColor=171717&color=FF570A&link=https%3A%2F%2Fcoderabbit.ai&label=CodeRabbit+Reviews)

Local-first transcription pipeline for mixed Arabic + English media, with a desktop-first web control plane.

Big Plump Bird ingests local files and URLs, downloads/normalizes audio, optionally enhances noisy inputs, transcribes with WhisperX, and stores searchable transcripts/artifacts in SQLite.

## What It Does

- Ingest local media, single URLs, URL lists, playlists, and channel feeds
- Download audio/video via `yt-dlp` with resilient retry/fallback logic
- Normalize audio with `ffmpeg`
- Optional enhancement pipeline (`auto|on|analyze-only`) for noisy/reverberant inputs
- Transcribe with WhisperX (word-level timing)
- Persist compact transcript payloads in SQLite + full raw transcript artifacts on disk
- Search transcript segments with SQLite FTS5
- Manage jobs from the web UI (desktop-targeted)

## Architecture

```text
apps/web/                 React + Vite UI (desktop-first)
src/web-api/              Bun API for job/control plane
src/core/                 Shared pipeline modules (ingest, yt-dlp, ffmpeg, whisperx, db)
src/cli.ts                CLI entrypoint (bpb)
tools/enhance/            Python enhancement scripts + venv
scripts/                  setup/dev helpers
data/                     runtime artifacts + SQLite DB (generated)
```

## Requirements

- Bun `>= 1.3.9`
- `ffmpeg` on `PATH`
- `yt-dlp` on `PATH`
- For full transcription setup: `uv` + Python 3 (WhisperX/enhancement envs are created via scripts)

## First-Time Setup

```bash
# 1) install JS deps at repo root
bun install

# 2) run preflight checks (what is missing on your machine)
bun run setup:doctor

# 3) standard contributor setup (web required; transcription envs best-effort)
bun run setup
```

`bun install` behavior:

- On first install for a fresh `node_modules`, `postinstall` runs setup helpers (`setup-git-hooks`, `setup-enhance`) once.
- On later installs/updates in the same install tree (for example `bun update --latest`), setup is skipped automatically.
- To rerun setup explicitly at any time: `bun run setup` (or `bun run setup:full` for strict mode).

`bun run setup` behavior:

- Required: installs web dependencies (`apps/web`)
- Optional: attempts enhancement + WhisperX environment setup
- If optional steps fail, setup still succeeds for web/API development and prints follow-up commands

For a strict/full setup (recommended before running full transcription pipeline):

```bash
bun run setup:full
```

This fails on any missing dependency so issues are caught early.

## Environment Notes

- `setup-enhance` uses `uv` and defaults to Python `3.14` (`BPB_PYTHON_VERSION` to override)
- `setup-whisperx` uses `uv` and defaults to Python `3.13` (`BPB_WHISPERX_PYTHON_VERSION` to override)
- Real URL ingestion/transcription needs `ffmpeg` and `yt-dlp` installed system-wide
- `deep-filter` is a runtime artifact downloaded by `setup-enhance` into `tools/enhance/bin/` and is intentionally not committed

## Setup Paths

Web/API only:

```bash
bun install
bun run setup:doctor
bun run setup
bun run dev:web
```

Dependency updates without rerunning setup:

```bash
bun update --latest
```

Full pipeline (CLI + web + enhancement + WhisperX):

```bash
bun install
bun run setup:doctor
bun run setup:full
bun run dev:web
```

## Run

CLI:

```bash
bun run bpb run --paths /absolute/path/to/file-or-dir
bun run bpb run --url "https://www.youtube.com/watch?v=VIDEO_ID"
bun run bpb run --urls /absolute/path/to/urls.txt
bun run bpb search "keyword phrase"
```

Web (API + frontend together):

```bash
bun run dev:web
```

Web separately:

```bash
bun run api:dev
bun run web:dev
```

## Enhancement Modes

```text
--enhance off|auto|on|analyze-only
```

- `off`: no enhancement
- `auto`: analyze and enhance only when needed
- `on`: force enhancement
- `analyze-only`: produce analysis/plan artifacts without applying enhancement

## Data and Artifacts

Generated under `data/`:

- `data/bpb.sqlite`
- `data/source_audio/`
- `data/audio/`
- `data/transcripts/<video_id>/`

Transcript storage contract in DB remains compact:

```json
{ "language": "...", "words": [{ "b": 123, "e": 456, "w": "text" }] }
```

## Scripts

- `bun run format` - Biome format write
- `bun run lint` - Biome checks
- `bun run lint:fix` - Biome check with fixes
- `bun run setup` - required web setup + best-effort transcription env setup
- `bun run setup:doctor` - checks required tools (`ffmpeg`, `yt-dlp`, `uv`) and readiness level
- `bun run setup:full` - strict setup; fails if any setup step fails
- `bun run test` - all tests
- `bun run test:integration` - integration tests
- `bun run test:e2e` - real YouTube + WhisperX E2E (opt-in)
- `bun run web:build` - production web build

## Releases (Semver)

This repo uses `release-please` + Conventional Commits to automate version bumps and changelog generation.

- `fix:` -> patch bump (`0.1.0` -> `0.1.1`)
- `feat:` -> minor bump (`0.1.0` -> `0.2.0`)
- `feat!:` or `BREAKING CHANGE:` -> major bump (`0.1.0` -> `1.0.0`)

The `Release Please` workflow runs on pushes to `main` and opens/updates a release PR. Merging that PR creates the tag/release and updates `package.json` + `CHANGELOG.md`.

The `PR Title Semver` workflow validates PR titles use Conventional Commit types so squash-merge titles can drive release bumps cleanly.

If your repo disables PR creation by `GITHUB_TOKEN`, set a `RELEASE_PLEASE_TOKEN` secret (PAT with `repo` scope) for the workflow, or enable:
`Settings -> Actions -> General -> Workflow permissions -> Allow GitHub Actions to create and approve pull requests`.

## Docs

- WhisperKit proposal: [docs/whisperkit.md](docs/whisperkit.md)
- Repo structure recommendations: [docs/repo-structure-recommendation.md](docs/repo-structure-recommendation.md)
- Research artifacts and historical planning notes: `docs/results/` and `docs/*-plan*.md`

## Notes

- This repo uses Biome only (ESLint removed).
- Frontend is intentionally desktop-first; mobile-specific hooks/layout behavior were removed.

## Author

- Ragaeeb Haq
- GitHub: [github.com/ragaeeb](https://github.com/ragaeeb)
