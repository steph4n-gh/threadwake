#!/usr/bin/env python3
"""Render Threadwake's original, two-stem score. Build tool, not a game dependency.

Requires NumPy and ffmpeg/ffprobe. All oscillators, envelopes and room responses
are synthesized here; no samples or external instruments are used. Notes and the
room are accumulated on a circular timeline so releases continue across the loop.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import math
from pathlib import Path
import subprocess

import numpy as np

RATE = 44100
INSTRUMENTS = {"felt", "glass", "pad", "pluck", "bell", "bass"}


def sha(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def validate(score, fixture=False):
    assert score["bpm"] == 80 and (fixture or score["beats"] == 256)
    assert {s["id"] for s in score["stems"]} == {"foundation", "filigree"}
    total = 0
    for stem in score["stems"]:
        if not fixture:
            assert len(stem["events"]) >= (48 if stem["id"] == "foundation" else 32)
        for e in stem["events"]:
            assert 0 <= e["beat"] < score["beats"]
            assert .1 <= e["duration"] <= 32
            assert 36 <= e["midi"] <= 88 and .05 <= e["velocity"] <= .75
            assert -.7 <= e["pan"] <= .7 and e["instrument"] in INSTRUMENTS
            assert all(math.isfinite(float(e[k])) for k in ("beat", "duration", "midi", "velocity", "pan"))
        total += len(stem["events"])
    assert total < 400


def gate(t, hold, attack, release):
    return (1 - np.exp(-t / attack)) * np.exp(-np.maximum(t - hold, 0) / release)


def voice(e, seconds_per_beat, rng):
    """Small modal instruments with moving spectra, not static wave presets."""
    kind, velocity = e["instrument"], float(e["velocity"])
    hold = e["duration"] * seconds_per_beat
    release = {"felt": 2.1, "glass": 3.4, "pad": 3.1, "pluck": 1.6, "bell": 1.8, "bass": 1.5}[kind]
    length = hold + release * 5
    t = np.arange(round(length * RATE), dtype=np.float32) / RATE
    f = 440 * 2 ** ((e["midi"] - 69) / 12)
    y = np.zeros(len(t), dtype=np.float32)
    phase = rng.uniform(0, 2 * np.pi)
    if kind == "felt":
        # Slight string stiffness and beating; high modes decay faster.
        for h, amp in enumerate((1, .35, .18, .085, .043, .022), 1):
            ratio = h * math.sqrt(1 + .00011 * h * h)
            decay = (2.8 * (220 / f) ** .18) / (1 + .32 * (h - 1))
            tone = np.sin(2 * np.pi * f * ratio * t)
            tone += .22 * np.sin(2 * np.pi * f * ratio * 1.0012 * t + .08)
            y += amp * (.45 + velocity if h > 1 else 1) * np.exp(-t / decay) * tone
        y *= gate(t, hold, .006 + .006 * (1 - velocity), release)
        # The soft hammer is filtered noise, individually seeded per note.
        n = rng.normal(0, 1, len(t)).astype(np.float32)
        n = (n + np.roll(n, 1) + np.roll(n, 2) + np.roll(n, 3)) * .25
        y += n * np.exp(-t / .016) * .018 * velocity
        level = .19
    elif kind in ("pad", "glass"):
        partials = ((1, 1), (2, .12), (3, .035), (4, .012), (5, .004)) if kind == "pad" else ((1, 1), (2.003, .17), (2.756, .065), (4.12, .028), (5.43, .01))
        for j, (ratio, amp) in enumerate(partials):
            drift = .0018 * np.sin(2 * np.pi * (.065 + j * .009) * t + phase)
            shimmer = .86 + .14 * np.sin(2 * np.pi * (.11 + j * .027) * t + phase + j)
            for side in (-1, 1):
                detune = 2 ** (side * (2.4 if kind == "pad" else 1.2) / 1200)
                y += amp * .5 * shimmer * np.sin(2 * np.pi * f * ratio * detune * t + drift + j * .37)
        attack = min(2.6, max(.6, hold * .16)) if kind == "pad" else min(1.7, max(.35, hold * .12))
        y *= gate(t, hold, attack, release)
        y *= .92 + .08 * np.sin(2 * np.pi * .18 * t + phase)
        level = .105 if kind == "pad" else .095
    elif kind in ("pluck", "bell"):
        partials = ((1, 1), (2, .32), (3, .12), (4, .065), (5, .03), (6, .015)) if kind == "pluck" else ((1, 1), (2.008, .10), (2.71, .035), (4.03, .012))
        for j, (ratio, amp) in enumerate(partials):
            decay = (1.8 if kind == "pluck" else 2.4 * (440 / f) ** .15) / (1 + j * .48)
            tone = np.sin(2 * np.pi * f * ratio * t + j * .12)
            if kind == "bell":
                tone = (tone + .1 * np.sin(2 * np.pi * f * ratio * 1.0009 * t + j * .12 + .15)) / 1.1
                tone *= .95 + .05 * np.sin(t * (1.3 + j * .17) + phase)
            y += amp * np.exp(-t / decay) * tone
        y *= gate(t, hold, .009 if kind == "pluck" else .045 + .025 * (1 - velocity), release)
        level = .17 if kind == "pluck" else .115
    else:
        y = np.sin(2 * np.pi * f * t) + .2 * np.sin(2 * np.pi * f * 2 * t) + .045 * np.sin(2 * np.pi * f * 3 * t)
        y *= gate(t, hold, .07, release) * (.75 + .25 * np.exp(-t / 2))
        level = .15
    # Long releases reach zero smoothly before circular accumulation.
    fade = min(round(.15 * RATE), len(y))
    y[-fade:] *= np.linspace(1, 0, fade, dtype=np.float32)
    y *= level * velocity ** 1.25
    pan = float(e["pan"]) + .035 * np.sin(t * .17 + phase)
    angle = (np.clip(pan, -1, 1) + 1) * np.pi / 4
    # Phase-coherent dry voices survive mono playback. Event panning and the
    # decorrelated chamber supply width; no interchannel delay alters pitch gain.
    return np.column_stack((y * np.cos(angle), y * np.sin(angle))).astype(np.float32)


def add_wrapped(target, note, start):
    cursor = 0
    start %= len(target)
    while cursor < len(note):
        count = min(len(target) - start, len(note) - cursor)
        target[start:start + count] += note[cursor:cursor + count]
        cursor += count
        start = 0


def room_ir(seed, channel):
    """Original warm chamber: sparse early bounces into a diffuse dark tail."""
    rng = np.random.default_rng(seed + 3701 + channel * 101)
    n = round(5.6 * RATE)
    t = np.arange(n) / RATE
    noise = rng.normal(0, 1, n)
    # Frequency-shaped diffuse response; high frequencies die sooner.
    spectrum = np.fft.rfft(noise)
    hz = np.fft.rfftfreq(n, 1 / RATE)
    spectrum *= 1 / np.sqrt(1 + (hz / 2700) ** 4)
    diffuse = np.fft.irfft(spectrum, n)
    diffuse *= np.exp(-t / 1.05) * (1 - np.exp(-t / .075))
    diffuse[:round(.026 * RATE)] = 0
    diffuse /= max(np.linalg.norm(diffuse), 1e-12)
    ir = diffuse * .34
    for delay, gain in ((.031, .17), (.057, -.12), (.083, .095), (.119, .07), (.173, -.04)):
        ir[round((delay + channel * .0043) * RATE)] += gain
    ir[-round(.15 * RATE):] *= np.linspace(1, 0, round(.15 * RATE))
    return ir


def finish_stem(dry, seed):
    n = len(dry)
    out = np.empty_like(dry)
    for ch in range(2):
        ir = room_ir(seed, ch)
        # Circular convolution is the periodic steady state, including past loops.
        excitation = dry[:, ch] * .8 + dry[:, 1 - ch] * .2
        wet = np.fft.irfft(np.fft.rfft(excitation) * np.fft.rfft(ir, n), n)
        sig = dry[:, ch] + wet * .6
        hz = np.fft.rfftfreq(n, 1 / RATE)
        filt = (1 - np.exp(-(hz / 31) ** 2)) / np.sqrt(1 + (hz / 10500) ** 8)
        out[:, ch] = np.fft.irfft(np.fft.rfft(sig) * filt, n).astype(np.float32)
    return out


def write_wav(path, samples):
    proc = subprocess.Popen(["ffmpeg", "-v", "error", "-y", "-f", "f32le", "-ar", str(RATE), "-ac", "2", "-i", "pipe:0", "-c:a", "pcm_s24le", str(path)], stdin=subprocess.PIPE)
    for chunk in range(0, len(samples), RATE * 10):
        proc.stdin.write(np.asarray(samples[chunk:chunk + RATE * 10], dtype="<f4").tobytes())
    proc.stdin.close()
    if proc.wait():
        raise RuntimeError("ffmpeg WAV write failed")


def encode(wav, output):
    codec = ["-c:a", "libopus", "-b:a", "128k", "-application", "audio", "-vbr", "on"] if output.suffix == ".ogg" else ["-c:a", "libmp3lame", "-b:a", "96k", "-write_xing", "1"]
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", str(wav), *codec, "-map_metadata", "-1", str(output)], check=True)


def metrics(samples):
    peak = float(np.max(np.abs(samples)))
    rms = float(np.sqrt(np.mean(samples.astype(np.float64) ** 2)))
    diffs = np.diff(samples, axis=0)
    seam = samples[0] - samples[-1]
    block = samples[:len(samples) // RATE * RATE].reshape(-1, RATE, 2)
    rms_blocks = np.sqrt(np.mean(block.astype(np.float64) ** 2, axis=(1, 2)))
    db = lambda x: round(20 * math.log10(max(float(x), 1e-12)), 3)
    mid = np.mean(samples, axis=1)
    side = (samples[:, 0] - samples[:, 1]) * .5
    mono_rms = float(np.sqrt(np.mean(mid.astype(np.float64) ** 2)))
    side_rms = float(np.sqrt(np.mean(side.astype(np.float64) ** 2)))
    return {"samplesPerChannel": len(samples), "seconds": len(samples) / RATE,
            "samplePeakDBFS": db(peak), "rmsDBFS": db(rms),
            "crestDB": round(db(peak) - db(rms), 3),
            "oneSecondRMSPercentileDBFS": {str(q): db(np.percentile(rms_blocks, q)) for q in (5, 50, 95)},
            "seamStepPeak": float(np.max(np.abs(seam))),
            "seamStepVsTypicalDifferenceRMS": float(np.max(np.abs(seam)) / max(np.sqrt(np.mean(diffs.astype(np.float64) ** 2)), 1e-12)),
            "monoFoldDownDB": round(db(mono_rms) - db(rms), 3),
            "sideRMSDBFS": db(side_rms),
            "stereoCorrelation": float(np.corrcoef(samples[:, 0], samples[:, 1])[0, 1]),
            "nonfinite": int(np.count_nonzero(~np.isfinite(samples))),
            "hardClipSamples": int(np.count_nonzero(np.abs(samples) >= 1))}


def decode(path):
    result = subprocess.run(["ffmpeg", "-v", "error", "-i", str(path), "-f", "f32le", "-ar", str(RATE), "-ac", "2", "pipe:1"], check=True, stdout=subprocess.PIPE)
    return np.frombuffer(result.stdout, dtype="<f4").reshape(-1, 2)


def fixture_score():
    # Renderer fixture only. Never attributed to the commissioned composition.
    return {"title": "Renderer fixture — not the game score", "bpm": 80, "beats": 16, "seed": 2718,
            "stems": [{"id": "foundation", "events": [
                {"beat": i * 2, "duration": 5, "midi": n, "velocity": .4, "pan": -.25 + i * .1, "instrument": k}
                for i, (n, k) in enumerate(((45, "bass"), (57, "pad"), (61, "glass"), (64, "felt")))]},
                {"id": "filigree", "events": [
                {"beat": i * 3 + 1, "duration": 2, "midi": n, "velocity": .35, "pan": (-1) ** i * .3, "instrument": k}
                for i, (n, k) in enumerate(((76, "bell"), (73, "pluck"), (69, "felt"), (66, "glass")))]}], "form": []}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--score", type=Path)
    parser.add_argument("--out", required=True, type=Path)
    parser.add_argument("--masters", required=True, type=Path)
    parser.add_argument("--fixture", action="store_true")
    args = parser.parse_args()
    score = fixture_score() if args.fixture else json.loads(args.score.read_text())
    validate(score, args.fixture)
    args.out.mkdir(parents=True, exist_ok=True)
    args.masters.mkdir(parents=True, exist_ok=True)
    beat_seconds = 60 / score["bpm"]
    n = round(score["beats"] * beat_seconds * RATE)
    stems = {}
    for i, stem in enumerate(score["stems"]):
        print(f"Synthesizing {stem['id']}: {len(stem['events'])} events", flush=True)
        dry = np.zeros((n, 2), dtype=np.float32)
        rng = np.random.default_rng(score["seed"] + i * 1009)
        for e in sorted(stem["events"], key=lambda x: x["beat"]):
            add_wrapped(dry, voice(e, beat_seconds, rng), round(e["beat"] * beat_seconds * RATE))
        stems[stem["id"]] = finish_stem(dry, score["seed"])
    mix = stems["foundation"] + stems["filigree"]
    # Common gain preserves compositional stem balance; no limiter/compression.
    # Peak reserve protects lossy reconstruction; quiet source is never boosted
    # solely to win an A/B through loudness.
    peak = float(np.max(np.abs(mix)))
    rms = float(np.sqrt(np.mean(mix.astype(np.float64) ** 2)))
    gain = min(10 ** (-3 / 20) / max(peak, 1e-9), 10 ** (-23 / 20) / max(rms, 1e-9))
    for stem in stems:
        stems[stem] *= gain
    mix *= gain
    write_wav(args.masters / "full-mix.wav", mix)
    manifest = {"schema": 1, "title": score["title"], "composer": "renderer fixture" if args.fixture else "Gemini 4 Argon High original composition; Threadwake contributors arrangement and synthesis",
                "renderRevision": 3, "arrangement": score.get("arrangement"), "dryStereo": "Phase-coherent amplitude panning; stereo width from score positions and decorrelated room, no dry channel microdelay",
                "source": str(args.score.name) if args.score else "built-in fixture (not production)",
                "scoreSHA256": sha(args.score) if args.score else None,
                "rendererSHA256": sha(__file__), "license": "CC-BY-4.0 to the extent rights are held; original score and synthesized audio, no recordings or samples",
                "sampleRate": RATE, "channels": 2, "seconds": n / RATE, "bpm": 80, "beats": score["beats"],
                "encoding": {"ogg": "Ogg Opus, libopus 128 kb/s VBR; Opus coded rate 48 kHz", "mp3": "libmp3lame 96 kb/s; gapless delay/padding metadata"},
                "combinedDecodedFloat32BytesAt44100": n * 2 * 4 * 2,
                "combinedDecodedFloat32BytesAt48000": round(n / RATE * 48000) * 2 * 4 * 2,
                "gain": gain, "limiting": "None; one common linear gain with sample peak and RMS reserve",
                "fullMix": metrics(mix), "stems": {}, "files": {}}
    manifest["criticalMonoProbes"] = {}
    for instrument in sorted(INSTRUMENTS):
        probe = voice({"instrument": instrument, "midi": 61, "duration": 4, "velocity": .4, "pan": 0}, beat_seconds, np.random.default_rng(2718))
        probe_metrics = metrics(probe)
        manifest["criticalMonoProbes"][instrument] = {"midi": 61, "frequencyHz": 440 * 2 ** ((61 - 69) / 12), "dryMonoFoldDownDB": probe_metrics["monoFoldDownDB"]}
        assert probe_metrics["monoFoldDownDB"] >= -.25, f"Center C#4 near-null: {instrument}"
    for name, samples in stems.items():
        wav = args.masters / f"{name}.wav"
        write_wav(wav, samples)
        manifest["stems"][name] = metrics(samples)
        assert manifest["stems"][name]["monoFoldDownDB"] >= -2, f"Excessive mono loss: {name}"
        for extension in ("ogg", "mp3"):
            target = args.out / f"{name}.{extension}"
            encode(wav, target)
            decoded = decode(target)
            info = metrics(decoded)
            info.update({"bytes": target.stat().st_size, "sha256": sha(target)})
            probe = subprocess.run(["ffprobe", "-v", "error", "-show_entries", "stream=codec_name,sample_rate,channels,duration,duration_ts,time_base:format=duration,size", "-of", "json", str(target)], check=True, text=True, capture_output=True)
            info["containerProbe"] = json.loads(probe.stdout)
            assert len(decoded) == n, f"Decoded length mismatch for {target.name}: {len(decoded)} != {n}"
            assert not info["nonfinite"] and not info["hardClipSamples"]
            manifest["files"][target.name] = info
    for ext in ("ogg", "mp3"):
        a = decode(args.out / f"foundation.{ext}")
        b = decode(args.out / f"filigree.{ext}")
        mixed = a + b
        wav = args.masters / f"decoded-{ext}-mix.wav"
        write_wav(wav, mixed)
        manifest[f"decoded{ext.upper()}Mix"] = metrics(mixed)
        loud = subprocess.run(["ffmpeg", "-hide_banner", "-i", str(wav), "-af", "loudnorm=I=-23:TP=-1:LRA=11:print_format=json", "-f", "null", "-"], text=True, capture_output=True, check=True)
        raw = loud.stderr[loud.stderr.rfind("{\n"):]
        measured = json.JSONDecoder().raw_decode(raw)[0]
        (args.masters / f"decoded-{ext}-loudnorm.json").write_text(json.dumps(measured, indent=2) + "\n")
        stats = subprocess.run(["ffmpeg", "-hide_banner", "-i", str(wav), "-af", "astats=metadata=1:reset=0", "-f", "null", "-"], text=True, capture_output=True, check=True)
        (args.masters / f"decoded-{ext}-astats.txt").write_text(stats.stderr)
        manifest[f"decoded{ext.upper()}Mix"]["integratedLUFS"] = float(measured["input_i"])
        manifest[f"decoded{ext.upper()}Mix"]["truePeakDBTP"] = float(measured["input_tp"])
        manifest[f"decoded{ext.upper()}Mix"]["loudnessRangeLU"] = float(measured["input_lra"])
        assert float(measured["input_tp"]) <= -1, f"True peak reserve exceeded: {ext}"
    manifest["compressedBytes"] = sum(v["bytes"] for v in manifest["files"].values())
    (args.out / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")
    (args.masters / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")
    print(json.dumps({"seconds": n / RATE, "compressedBytes": manifest["compressedBytes"], "mix": manifest["fullMix"], "fixture": args.fixture}, indent=2), flush=True)


if __name__ == "__main__":
    main()
