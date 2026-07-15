# Synthesized placeholder SFX for the video editor auto-edit feature (100% generated with numpy/scipy, no external audio).
"""
Generates 6 short sound-effect WAV files (44100 Hz, mono, 16-bit PCM) used by the
editor's auto-edit feature. Every file is peak-normalized to ~-3 dBFS with short
fade-in/out to avoid clicks. Run:

    python3 _generate_sfx.py

Requires numpy + scipy (already available; no new dependencies added).
"""

import os
import numpy as np
from scipy.io import wavfile
from scipy.signal import butter, sosfilt, lfilter

SR = 44100
OUT_DIR = os.path.dirname(os.path.abspath(__file__))
TARGET_PEAK_DBFS = -3.0


# ----------------------------- helpers -----------------------------

def t_axis(dur):
    return np.linspace(0, dur, int(round(SR * dur)), endpoint=False)


def fade(sig, fade_ms=8.0):
    """Apply a short fade-in/out (default 8 ms) to prevent clicks."""
    n = len(sig)
    f = int(SR * fade_ms / 1000.0)
    f = max(1, min(f, n // 2))
    env = np.ones(n)
    ramp = np.linspace(0.0, 1.0, f)
    env[:f] = ramp
    env[-f:] = ramp[::-1]
    return sig * env


def normalize(sig, peak_dbfs=TARGET_PEAK_DBFS):
    peak = np.max(np.abs(sig))
    if peak < 1e-9:
        return sig
    target = 10.0 ** (peak_dbfs / 20.0)
    return sig * (target / peak)


def to_int16(sig):
    sig = np.clip(sig, -1.0, 1.0)
    return (sig * 32767.0).astype(np.int16)


def save(name, sig, fade_ms=8.0):
    sig = fade(sig.astype(np.float64), fade_ms)
    sig = normalize(sig)
    wavfile.write(os.path.join(OUT_DIR, name), SR, to_int16(sig))
    return name, len(sig) / SR


def adsr(n, attack, decay, sustain_level=0.7, release=None):
    """Simple attack/decay/sustain/release envelope over n samples (times in sec)."""
    if release is None:
        release = decay
    a = int(SR * attack)
    d = int(SR * decay)
    r = int(SR * release)
    a = max(1, a)
    env = np.zeros(n)
    # attack
    a = min(a, n)
    env[:a] = np.linspace(0, 1, a)
    # decay
    d = min(d, max(0, n - a))
    if d > 0:
        env[a:a + d] = np.linspace(1, sustain_level, d)
    # sustain
    s_end = max(a + d, n - r)
    env[a + d:s_end] = sustain_level
    # release
    if n - s_end > 0:
        env[s_end:] = np.linspace(sustain_level, 0, n - s_end)
    return env


def brass_note(freq, dur, vibrato_hz=5.0, vibrato_cents=15.0,
               bend_semitones=0.0, attack=0.03, decay=0.08, sustain=0.75):
    """A brass-ish tone: fundamental + odd/even harmonics, gentle vibrato,
    optional downward pitch bend, with an ADSR envelope."""
    t = t_axis(dur)
    n = len(t)
    # vibrato as fractional pitch modulation (cents)
    vib = (vibrato_cents / 1200.0) * np.sin(2 * np.pi * vibrato_hz * t)
    # linear pitch bend across the note (in semitones)
    bend = np.linspace(0.0, bend_semitones, n) / 12.0
    ratio = 2.0 ** (vib + bend)
    inst_freq = freq * ratio
    phase = 2 * np.pi * np.cumsum(inst_freq) / SR
    # harmonic mix (brass-ish): strong fundamental, decaying odd+even harmonics
    harmonics = {1: 1.0, 2: 0.55, 3: 0.40, 4: 0.22, 5: 0.16, 6: 0.10, 7: 0.07}
    sig = np.zeros(n)
    for h, amp in harmonics.items():
        sig += amp * np.sin(h * phase)
    env = adsr(n, attack, decay, sustain_level=sustain, release=max(decay, 0.05))
    return sig * env


# ----------------------------- SFX generators -----------------------------

def make_comedic_stinger():
    """Sad trombone 'wah-wah-waaah': descending 3-4 notes, brass timbre,
    slight vibrato, final lower held note with a downward pitch bend."""
    # Descending sequence (roughly the classic wah-wah-waaah)
    notes = [
        # (freq Hz, dur s, bend semitones, sustain)
        (233.08, 0.32, -0.5, 0.75),   # Bb3
        (207.65, 0.32, -0.5, 0.75),   # Ab3
        (185.00, 0.34, -0.7, 0.78),   # F#3/Gb3
        (155.56, 0.62, -2.0, 0.82),   # Eb3, longer, big downward bend
    ]
    gap = int(SR * 0.02)
    parts = []
    for i, (f, d, bend, sus) in enumerate(notes):
        parts.append(brass_note(f, d, vibrato_hz=5.5, vibrato_cents=18.0,
                                 bend_semitones=bend, attack=0.025,
                                 decay=0.10, sustain=sus))
        if i < len(notes) - 1:
            parts.append(np.zeros(gap))
    sig = np.concatenate(parts)
    return sig  # ~1.5s total


def make_air_horn():
    """Hype air-horn: buzzy saw-ish tone ~200-400Hz, two short blasts."""
    def blast(dur, base=260.0):
        t = t_axis(dur)
        n = len(t)
        # slight upward drift then steady, gives that "weee" push
        f = base + 30.0 * (1 - np.exp(-6 * t))
        phase = 2 * np.pi * np.cumsum(f) / SR
        # sawtooth via harmonic sum -> buzzy
        sig = np.zeros(n)
        for h in range(1, 12):
            sig += (1.0 / h) * np.sin(h * phase)
        # a second detuned layer for thickness
        phase2 = 2 * np.pi * np.cumsum(f * 1.005) / SR
        for h in range(1, 8):
            sig += (0.6 / h) * np.sin(h * phase2)
        env = adsr(n, 0.01, 0.03, sustain_level=0.9, release=0.04)
        return sig * env

    b1 = blast(0.42)
    gap = np.zeros(int(SR * 0.10))
    b2 = blast(0.42)
    total = 1.0
    sig = np.concatenate([b1, gap, b2])
    # pad/trim to ~1.0s
    target = int(SR * total)
    if len(sig) < target:
        sig = np.concatenate([sig, np.zeros(target - len(sig))])
    else:
        sig = sig[:target]
    return sig


def make_tension_riser():
    """Rising suspense riser ~2.0s: frequency sweeping upward with increasing amplitude."""
    dur = 2.0
    t = t_axis(dur)
    n = len(t)
    # exponential frequency sweep upward
    f0, f1 = 120.0, 1800.0
    k = (f1 / f0) ** (t / dur)
    inst_freq = f0 * k
    phase = 2 * np.pi * np.cumsum(inst_freq) / SR
    # rich tone: fundamental + a few harmonics
    tone = (np.sin(phase) + 0.5 * np.sin(2 * phase) + 0.3 * np.sin(3 * phase))
    # add filtered noise "air" that also rises
    noise = np.random.randn(n)
    sos = butter(2, [800 / (SR / 2), 6000 / (SR / 2)], btype='band', output='sos')
    noise = sosfilt(sos, noise)
    amp = np.linspace(0.05, 1.0, n) ** 1.6  # increasing amplitude
    sig = amp * (0.8 * tone + 0.4 * noise)
    return sig


def make_whoosh():
    """Transition whoosh ~0.8s: band-pass white noise with moving center freq
    (low->high->low) and a soft in/out envelope."""
    dur = 0.8
    t = t_axis(dur)
    n = len(t)
    noise = np.random.randn(n)
    # moving center frequency low->high->low (triangle in log space)
    center = 300 + 3000 * np.sin(np.pi * t / dur)  # 300 -> ~3300 -> 300
    out = np.zeros(n)
    block = 512
    for start in range(0, n, block):
        end = min(start + block, n)
        c = float(np.clip(np.mean(center[start:end]), 150, 8000))
        lo = max(80.0, c * 0.5)
        hi = min(SR / 2 * 0.98, c * 1.8)
        if hi <= lo:
            hi = lo + 200
        sos = butter(2, [lo / (SR / 2), hi / (SR / 2)], btype='band', output='sos')
        out[start:end] = sosfilt(sos, noise[start:end])
    # soft bell-ish envelope
    env = np.sin(np.pi * t / dur) ** 1.5
    return out * env


def make_crickets_loop():
    """Awkward-silence crickets ~2.0s: repeated soft high chirps (~4-5kHz) at a
    steady interval over a quiet noise floor. Loops seamlessly-ish."""
    dur = 2.0
    n = int(SR * dur)
    sig = np.zeros(n)
    # quiet noise floor
    floor = 0.02 * np.random.randn(n)
    sos = butter(2, [2000 / (SR / 2), 8000 / (SR / 2)], btype='band', output='sos')
    floor = sosfilt(sos, floor)
    sig += floor

    def chirp(freq=4500.0, dur_c=0.09, trills=3):
        tc = t_axis(dur_c)
        nc = len(tc)
        # a chirp = a few fast amplitude trills of a high tone
        tone = np.sin(2 * np.pi * freq * tc) + 0.4 * np.sin(2 * np.pi * freq * 1.5 * tc)
        trill = 0.5 * (1 + np.sin(2 * np.pi * (trills / dur_c) * tc))
        env = adsr(nc, 0.005, 0.02, sustain_level=0.5, release=0.03)
        return tone * trill * env * 0.5

    interval = 0.5  # steady interval -> 4 chirps across 2.0s
    c = chirp()
    step = int(SR * interval)
    for start in range(int(SR * 0.1), n, step):
        end = min(start + len(c), n)
        sig[start:end] += c[:end - start]
    return sig


def make_record_scratch():
    """Record-scratch 'stop' ~0.5s: short noisy pitch-bent burst."""
    dur = 0.5
    t = t_axis(dur)
    n = len(t)
    # pitch-bent tonal component: quick down-up-down scrub
    scrub = np.concatenate([
        np.linspace(1.0, 0.4, n // 3),
        np.linspace(0.4, 1.1, n // 3),
        np.linspace(1.1, 0.2, n - 2 * (n // 3)),
    ])
    base = 400.0
    inst_freq = base * scrub
    phase = 2 * np.pi * np.cumsum(inst_freq) / SR
    tone = np.sin(phase) + 0.5 * np.sin(2 * phase)
    # gritty noise modulated by the scrub speed
    noise = np.random.randn(n)
    sos = butter(2, [500 / (SR / 2), 5000 / (SR / 2)], btype='band', output='sos')
    noise = sosfilt(sos, noise)
    # amplitude wobble to sound like hand-scrubbing vinyl
    wobble = 0.5 * (1 + np.sin(2 * np.pi * 18 * t))
    sig = wobble * (0.6 * tone + 0.7 * noise)
    # decay toward the "stop"
    sig *= np.linspace(1.0, 0.2, n)
    return sig


# ----------------------------- main -----------------------------

def main():
    np.random.seed(1234)  # reproducible noise-based SFX
    results = []
    results.append(save("comedic_stinger.wav", make_comedic_stinger()))
    results.append(save("air_horn.wav", make_air_horn()))
    results.append(save("tension_riser.wav", make_tension_riser()))
    results.append(save("whoosh.wav", make_whoosh()))
    results.append(save("crickets_loop.wav", make_crickets_loop()))
    results.append(save("record_scratch.wav", make_record_scratch()))
    for name, dur in results:
        print(f"{name}: {dur:.3f}s")


if __name__ == "__main__":
    main()
