# Audio enhancement (pre-WhisperX)

Optional pipeline stage: VAD + noise-regime detection + `deep-filter` denoising + NARA-WPE dereverberation. Used when you run `bpb run --enhance auto` (or `on` / `analyze-only`).

## Reproducible setup

From the **repository root** (requires **uv** on PATH):

```bash
bun run setup-enhance
```

This uses **uv** to:

1. Create a virtualenv at `tools/enhance/.venv`
2. Install dependencies from `tools/enhance/requirements.txt` (`silero-vad`, `nara-wpe`, `ruptures`, etc.)
3. Download and install the `deep-filter` binary under `tools/enhance/bin/`

`tools/enhance/bin/` contains runtime-only binaries and is ignored by git.

`bun install` runs the same step as **postinstall** (best-effort: install still succeeds if uv or Python is missing).

## Requirements

- **uv** (https://docs.astral.sh/uv/) and Python 3
- Full runtime setup (enhancement + WhisperX): `bun run setup`

## Config

The CLI and `config.json` point the pipeline at `tools/enhance/.venv/bin/python3` and `tools/enhance/bin/deep-filter` by default. Override with `enhancement.pythonBin` / `enhancement.deepFilterBin` if needed.

## Scripts

- **analyze_audio.py** — Silero VAD, silence extraction, ruptures PELT regime detection, SNR estimation. Writes a JSON plan.
- **process_audio.py** — Reads the plan; runs optional WPE dereverberation and `deep-filter` denoising per regime; writes enhanced WAV and result JSON.

The TypeScript layer in `src/core/enhance.ts` invokes these via `Bun.spawn` and handles SNR gating, source-class overrides, and plan I/O.
