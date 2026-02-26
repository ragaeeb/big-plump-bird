#!/usr/bin/env python3
"""
Audio analysis for the Big Plump Bird enhancement pipeline.

Runs Silero VAD to locate speech/silence boundaries, computes per-gap
noise characteristics, detects noise-regime change-points via ruptures
PELT, and estimates global SNR.  Writes a JSON plan consumed by
process_audio.py.

Usage:
    python analyze_audio.py \
        --input audio.wav \
        --output analysis.json \
        [--vad-threshold 0.35] \
        [--min-silence-ms 500] \
        [--max-regimes 8]
"""

import argparse
import importlib.metadata
import json
import sys
import time
from pathlib import Path

import numpy as np
import soundfile as sf
import torch
from silero_vad import get_speech_timestamps, load_silero_vad

# ---------------------------------------------------------------------------
# Silero VAD helpers
# ---------------------------------------------------------------------------

def _load_vad():
    model = load_silero_vad()
    return model


def _run_vad(audio, sr, model, threshold):
    tensor = torch.from_numpy(audio).float()
    return get_speech_timestamps(
        tensor,
        model,
        sampling_rate=sr,
        threshold=threshold,
        min_speech_duration_ms=250,
        min_silence_duration_ms=100,
    )


# ---------------------------------------------------------------------------
# Feature helpers
# ---------------------------------------------------------------------------

def _silence_spans(speech, total_samples, min_gap):
    spans = []
    prev = 0
    for s in speech:
        if s["start"] - prev >= min_gap:
            spans.append({"start": prev, "end": s["start"]})
        prev = s["end"]
    if total_samples - prev >= min_gap:
        spans.append({"start": prev, "end": total_samples})
    return spans


def _rms_db(seg):
    rms = np.sqrt(np.mean(seg.astype(np.float64) ** 2))
    return 20.0 * np.log10(max(rms, 1e-10))


def _spectral_centroid(seg, sr):
    if len(seg) < 64:
        return 0.0
    spec = np.abs(np.fft.rfft(seg))
    freqs = np.fft.rfftfreq(len(seg), d=1.0 / sr)
    total = spec.sum()
    if total < 1e-10:
        return 0.0
    return float(np.dot(freqs, spec) / total)


# ---------------------------------------------------------------------------
# Regime detection
# ---------------------------------------------------------------------------

def _detect_changepoints(rms_vals, max_regimes):
    import ruptures

    n = len(rms_vals)
    if n < 4:
        return []

    signal = np.array(rms_vals, dtype=np.float64).reshape(-1, 1)
    pen = max(3.0, np.log(n) * 2.0)
    bkps = ruptures.Pelt(model="rbf", min_size=2).fit(signal).predict(pen=pen)
    cps = [b for b in bkps if b < n]
    return cps[: max_regimes - 1]


# ---------------------------------------------------------------------------
# SNR estimation
# ---------------------------------------------------------------------------

def _estimate_snr(audio, speech, silence):
    s_rms = [
        np.sqrt(np.mean(audio[sp["start"]:sp["end"]].astype(np.float64) ** 2))
        for sp in speech if sp["end"] > sp["start"]
    ]
    n_rms = [
        np.sqrt(np.mean(audio[sp["start"]:sp["end"]].astype(np.float64) ** 2))
        for sp in silence if sp["end"] > sp["start"]
    ]
    if not s_rms or not n_rms:
        return None
    s = float(np.mean(s_rms))
    n = float(np.mean(n_rms))
    if n < 1e-10:
        return 60.0
    return 20.0 * np.log10(s / n)


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--input", required=True)
    ap.add_argument("--output", required=True)
    ap.add_argument("--vad-threshold", type=float, default=0.35)
    ap.add_argument("--min-silence-ms", type=int, default=500)
    ap.add_argument("--max-regimes", type=int, default=8)
    args = ap.parse_args()
    if not 0.0 <= args.vad_threshold <= 1.0:
        ap.error("--vad-threshold must be between 0 and 1")
    if args.min_silence_ms < 0:
        ap.error("--min-silence-ms must be >= 0")
    if args.max_regimes < 1:
        ap.error("--max-regimes must be >= 1")

    t0 = time.monotonic()

    audio, sr = sf.read(args.input, dtype="float32")
    if audio.ndim > 1:
        audio = audio.mean(axis=1)
    n_samples = len(audio)
    duration_ms = int(n_samples / sr * 1000)

    print(f"[analyze] {duration_ms / 1000:.1f}s @ {sr}Hz", file=sys.stderr)

    # --- VAD ---
    vad_model = _load_vad()
    speech = _run_vad(audio, sr, vad_model, args.vad_threshold)
    min_gap = int(args.min_silence_ms * sr / 1000)
    silence = _silence_spans(speech, n_samples, min_gap)

    print(
        f"[analyze] {len(speech)} speech / {len(silence)} silence spans",
        file=sys.stderr,
    )

    # --- Per-gap features ---
    sil_info = []
    rms_vals = []
    for sp in silence:
        seg = audio[sp["start"]:sp["end"]]
        r = _rms_db(seg)
        c = _spectral_centroid(seg, sr)
        rms_vals.append(r)
        sil_info.append({
            "start_ms": int(sp["start"] / sr * 1000),
            "end_ms": int(sp["end"] / sr * 1000),
            "rms_db": round(r, 2),
            "spectral_centroid_hz": round(c, 1),
        })

    # --- Regime change-point detection ---
    cps = _detect_changepoints(rms_vals, args.max_regimes)

    group_bounds = [0] + cps + [len(sil_info)]
    regimes = []
    for gi in range(len(group_bounds) - 1):
        g_start = group_bounds[gi]
        g_end = group_bounds[gi + 1]
        grp = sil_info[g_start:g_end]
        if not grp:
            continue

        if gi == 0:
            r_start = 0
        else:
            s = sil_info[g_start]
            r_start = (s["start_ms"] + s["end_ms"]) // 2

        if gi == len(group_bounds) - 2:
            r_end = duration_ms
        else:
            ns = sil_info[group_bounds[gi + 1]]
            r_end = (ns["start_ms"] + ns["end_ms"]) // 2

        best_ref = max(grp, key=lambda x: x["end_ms"] - x["start_ms"])
        avg_rms = float(np.mean([s["rms_db"] for s in grp]))
        avg_cent = float(np.mean([s["spectral_centroid_hz"] for s in grp]))

        regimes.append({
            "index": gi,
            "start_ms": r_start,
            "end_ms": r_end,
            "noise_rms_db": round(avg_rms, 2),
            "spectral_centroid_hz": round(avg_cent, 1),
            "noise_reference": {
                "start_ms": best_ref["start_ms"],
                "end_ms": best_ref["end_ms"],
            },
            "recommended": {
                "dereverb": False,
                "denoise": True,
                "atten_lim_db": 12,
            },
        })

    if not regimes:
        regimes = [{
            "index": 0,
            "start_ms": 0,
            "end_ms": duration_ms,
            "noise_rms_db": -100.0,
            "spectral_centroid_hz": 0.0,
            "noise_reference": None,
            "recommended": {"dereverb": False, "denoise": True, "atten_lim_db": 12},
        }]

    snr = _estimate_snr(audio, speech, silence)
    total_speech = sum(s["end"] - s["start"] for s in speech)
    speech_ratio = total_speech / n_samples if n_samples > 0 else 0.0

    elapsed_ms = int((time.monotonic() - t0) * 1000)

    versions = {}
    for pkg in ("torch", "torchaudio", "silero-vad", "numpy", "soundfile", "ruptures", "scipy"):
        try:
            versions[pkg] = importlib.metadata.version(pkg)
        except importlib.metadata.PackageNotFoundError:
            pass

    result = {
        "version": 1,
        "input_path": str(Path(args.input).resolve()),
        "duration_ms": duration_ms,
        "sample_rate": sr,
        "snr_db": round(snr, 2) if snr is not None else None,
        "speech_ratio": round(speech_ratio, 4),
        "regime_count": len(regimes),
        "regimes": regimes,
        "silence_spans": [
            {"start_ms": s["start_ms"], "end_ms": s["end_ms"]} for s in sil_info
        ],
        "speech_spans": [
            {"start_ms": int(s["start"] / sr * 1000), "end_ms": int(s["end"] / sr * 1000)}
            for s in speech
        ],
        "analysis_duration_ms": elapsed_ms,
        "versions": versions,
    }

    Path(args.output).write_text(json.dumps(result, indent=2))

    snr_str = f"{snr:.1f}" if snr is not None else "N/A"
    print(
        f"[analyze] SNR={snr_str}dB, {len(regimes)} regime(s), "
        f"speech={speech_ratio:.1%}, {elapsed_ms}ms",
        file=sys.stderr,
    )


if __name__ == "__main__":
    main()
