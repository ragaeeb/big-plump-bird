#!/usr/bin/env python3
"""
Audio processing for the Big Plump Bird enhancement pipeline.

Reads an analysis plan (from analyze_audio.py) and applies optional
NARA-WPE dereverberation followed by DeepFilterNet denoising via the
`deep-filter` CLI per noise regime. Segments are reassembled without
changing total sample count.
"""

import argparse
import importlib.metadata
import json
import math
import os
import shutil
import subprocess
import sys
import tempfile
import time
from pathlib import Path

import numpy as np
import soundfile as sf
from scipy.signal import resample_poly


def _resample_audio(audio: np.ndarray, src_sr: int, dst_sr: int) -> np.ndarray:
    if src_sr == dst_sr:
        return audio.astype(np.float32)
    g = math.gcd(src_sr, dst_sr)
    up = dst_sr // g
    down = src_sr // g
    return resample_poly(audio, up, down).astype(np.float32)


def _run_cmd(args: list[str]) -> subprocess.CompletedProcess:
    return subprocess.run(args, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)


def _apply_deepfilter(
    segment: np.ndarray,
    sr: int,
    atten_lim_db: float,
    deep_filter_bin: str,
    work_dir: str,
    seg_idx: int,
) -> np.ndarray:
    in_path = os.path.join(work_dir, f"seg_{seg_idx}.wav")
    out_dir = os.path.join(work_dir, "out")
    os.makedirs(out_dir, exist_ok=True)

    sf.write(in_path, segment.astype(np.float32), sr, subtype="PCM_16")

    run = _run_cmd(
        [
            deep_filter_bin,
            "--output-dir",
            out_dir,
            "--atten-lim-db",
            str(atten_lim_db),
            in_path,
        ]
    )
    if run.returncode != 0:
        raise RuntimeError(
            "deep-filter failed "
            f"(exit {run.returncode}): {run.stderr.strip() or run.stdout.strip()}"
        )

    out_path = os.path.join(out_dir, os.path.basename(in_path))
    if not os.path.exists(out_path):
        raise RuntimeError(f"deep-filter did not produce output at {out_path}")

    enhanced, out_sr = sf.read(out_path, dtype="float32")
    if enhanced.ndim > 1:
        enhanced = enhanced.mean(axis=1)

    enhanced = _resample_audio(enhanced, out_sr, sr)

    # Keep exact segment length for stable timeline reconstruction.
    n = len(segment)
    if len(enhanced) > n:
        enhanced = enhanced[:n]
    elif len(enhanced) < n:
        enhanced = np.pad(enhanced, (0, n - len(enhanced)))
    return enhanced.astype(np.float32)


def _apply_wpe(segment: np.ndarray, sr: int, delay: int = 3, taps: int = 10, iterations: int = 3) -> np.ndarray:
    from nara_wpe.wpe import wpe_v0 as wpe
    from scipy.signal import stft as _stft, istft as _istft

    nperseg = 512
    noverlap = nperseg * 3 // 4

    _, _, Y = _stft(segment, fs=sr, nperseg=nperseg, noverlap=noverlap)
    Z = wpe(
        Y[:, np.newaxis, :],
        taps=taps,
        delay=delay,
        iterations=iterations,
        statistics_mode="full",
    )
    _, result = _istft(Z[:, 0, :], fs=sr, nperseg=nperseg, noverlap=noverlap)

    n = len(segment)
    if len(result) > n:
        result = result[:n]
    elif len(result) < n:
        result = np.pad(result, (0, n - len(result)))
    return result.astype(np.float32)


def _join_segments(segments: list[np.ndarray], fade_samples: int) -> np.ndarray:
    if not segments:
        return np.array([], dtype=np.float32)
    if len(segments) == 1:
        return segments[0].astype(np.float32)

    out = segments[0].astype(np.float32).copy()
    for next_seg in segments[1:]:
        seg = next_seg.astype(np.float32).copy()
        n = min(fade_samples, len(out), len(seg))

        # Smooth boundary without dropping samples.
        if n > 0:
            fade_out = np.linspace(1.0, 0.0, n, endpoint=False, dtype=np.float32)
            fade_in = np.linspace(0.0, 1.0, n, endpoint=False, dtype=np.float32)
            out[-n:] *= fade_out
            seg[:n] *= fade_in

        out = np.concatenate([out, seg])

    return out.astype(np.float32)


def _resolve_binary(path: str) -> str:
    p = Path(path)
    if p.is_absolute():
        return str(p)
    return str((Path.cwd() / p).resolve())


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--input", required=True)
    ap.add_argument("--analysis", required=True)
    ap.add_argument("--output", required=True)
    ap.add_argument("--result", required=True)
    ap.add_argument("--atten-lim-db", type=float, default=12.0)
    ap.add_argument("--dereverb", choices=["off", "auto", "on"], default="auto")
    ap.add_argument("--overlap-ms", type=int, default=10)
    ap.add_argument("--deep-filter-bin", required=True)
    args = ap.parse_args()

    t0 = time.monotonic()

    deep_filter_bin = _resolve_binary(args.deep_filter_bin)
    if not os.path.exists(deep_filter_bin):
        raise FileNotFoundError(f"deep-filter binary not found at {deep_filter_bin}")

    ver = _run_cmd([deep_filter_bin, "--version"])
    if ver.returncode != 0:
        raise RuntimeError(
            "deep-filter --version failed: "
            f"{ver.stderr.strip() or ver.stdout.strip() or 'unknown error'}"
        )
    deep_filter_version = (ver.stdout.strip() or ver.stderr.strip() or "unknown").splitlines()[0]

    audio, sr = sf.read(args.input, dtype="float32")
    if audio.ndim > 1:
        audio = audio.mean(axis=1)
    original_len = len(audio)

    analysis = json.loads(Path(args.analysis).read_text())
    regimes = analysis.get("regimes", [])
    if not regimes:
        regimes = [
            {
                "index": 0,
                "start_ms": 0,
                "end_ms": int(original_len / sr * 1000),
                "recommended": {
                    "dereverb": False,
                    "denoise": True,
                    "atten_lim_db": args.atten_lim_db,
                },
            }
        ]

    regimes = sorted(regimes, key=lambda r: (r.get("start_ms", 0), r.get("index", 0)))

    fade_samples = max(0, int(args.overlap_ms * sr / 1000))
    processed: list[np.ndarray] = []
    seg_metrics = []

    with tempfile.TemporaryDirectory(prefix="bpb-enhance-") as work_dir:
        cursor = 0
        for i, regime in enumerate(regimes):
            start = cursor

            if i == len(regimes) - 1:
                end = original_len
            else:
                proposed_end = int(round(float(regime.get("end_ms", 0)) * sr / 1000.0))
                end = max(start, min(proposed_end, original_len))

            segment = audio[start:end].copy()
            cursor = end

            if len(segment) == 0:
                continue

            rec = regime.get("recommended", {})
            do_dereverb = args.dereverb == "on" or (args.dereverb == "auto" and rec.get("dereverb", False))
            do_denoise = rec.get("denoise", True)
            atten = float(rec.get("atten_lim_db", args.atten_lim_db))

            seg_t0 = time.monotonic()

            if do_dereverb:
                print(f"[process] Regime {regime.get('index', i)}: WPE dereverberation", file=sys.stderr)
                segment = _apply_wpe(segment, sr)

            if do_denoise:
                print(
                    f"[process] Regime {regime.get('index', i)}: deep-filter (atten_lim={atten}dB)",
                    file=sys.stderr,
                )
                segment = _apply_deepfilter(segment, sr, atten_lim_db=atten, deep_filter_bin=deep_filter_bin, work_dir=work_dir, seg_idx=i)

            seg_ms = int((time.monotonic() - seg_t0) * 1000)
            processed.append(segment)
            seg_metrics.append(
                {
                    "segment_index": int(regime.get("index", i)),
                    "start_ms": int(round(start / sr * 1000.0)),
                    "end_ms": int(round(end / sr * 1000.0)),
                    "dereverb_applied": bool(do_dereverb),
                    "denoise_applied": bool(do_denoise),
                    "atten_lim_db": atten,
                    "processing_ms": seg_ms,
                }
            )

        # In case rounding produced uncovered tail (defensive).
        if cursor < original_len:
            processed.append(audio[cursor:original_len].copy())

    enhanced = _join_segments(processed, fade_samples)

    if len(enhanced) > original_len:
        enhanced = enhanced[:original_len]
    elif len(enhanced) < original_len:
        enhanced = np.pad(enhanced, (0, original_len - len(enhanced)))

    sf.write(args.output, enhanced, sr, subtype="PCM_16")

    elapsed_ms = int((time.monotonic() - t0) * 1000)

    versions = {}
    for pkg in ("nara-wpe", "numpy", "soundfile", "scipy"):
        try:
            versions[pkg] = importlib.metadata.version(pkg)
        except Exception:
            pass
    versions["deep-filter"] = deep_filter_version

    result_data = {
        "version": 2,
        "input_path": str(Path(args.input).resolve()),
        "output_path": str(Path(args.output).resolve()),
        "duration_ms": int(original_len / sr * 1000),
        "processing_ms": elapsed_ms,
        "segments": seg_metrics,
        "versions": versions,
    }

    Path(args.result).write_text(json.dumps(result_data, indent=2))
    print(f"[process] {len(seg_metrics)} segment(s), {elapsed_ms}ms total", file=sys.stderr)


if __name__ == "__main__":
    main()
