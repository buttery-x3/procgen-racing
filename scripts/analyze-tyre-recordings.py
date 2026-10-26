"""Compare two local PCM WAVs; write derived measurements/figures, never audio.

Requires numpy, scipy and matplotlib. See docs/research/tyre-recording-comparison.md.
The metrics describe these recordings, not a physical tyre or a realism score.
"""

import argparse
import hashlib
import json
import wave
from pathlib import Path

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np
import scipy
from scipy import signal


BANDS = [(500, 1000), (1000, 2000), (2000, 4000), (4000, 8000)]
COLORS = ["#007a87", "#e09025", "#8d56ad", "#d14363"]


def read_clip(path):
    with wave.open(str(path), "rb") as wav:
        rate, channels, width, frames = (wav.getframerate(), wav.getnchannels(),
                                         wav.getsampwidth(), wav.getnframes())
        if width != 2 or wav.getcomptype() != "NONE":
            raise ValueError("This comparison expects uncompressed 16-bit PCM WAV input")
        pcm = np.frombuffer(wav.readframes(frames), dtype="<i2").reshape(-1, channels)
    x = pcm.astype(np.float64) / 32768
    assert np.isfinite(x).all()
    # Average channel POWERS, not samples: stereo cancellation must not erase bands.
    window = round(rate * .04)
    hop = round(rate * .005)
    f, t, psd = signal.spectrogram(x.T, fs=rate, window="hann", nperseg=window,
                                  noverlap=window-hop, nfft=4096,
                                  detrend="constant", scaling="density", axis=-1)
    psd = psd.mean(axis=0)
    n = round(rate * .01)
    rms = np.sqrt(np.mean(x[:len(x)//n*n].reshape(-1, n, channels)**2, axis=(1, 2)))
    trms = (np.arange(len(rms)) + .5) * n / rate
    band = (f >= 500) & (f <= 8000)
    band_power = psd[band].sum(axis=0)
    active = band_power > band_power.max() * 10**(-25/10)
    return {"x": x, "rate": rate, "f": f, "t": t, "psd": psd,
            "rms": rms, "trms": trms, "active": active,
            "meta": {"filename": path.name, "sha256": hashlib.sha256(path.read_bytes()).hexdigest(),
                     "sample_rate_hz": rate, "channels": channels, "frames": frames,
                     "pcm_bits": 16, "duration_seconds": frames/rate,
                     "rms_dbfs": float(20*np.log10(np.sqrt(np.mean(x*x)))),
                     "peak_dbfs": float(20*np.log10(np.max(np.abs(x)))),
                     "full_scale_sample_count": int(np.sum((pcm == -32768) | (pcm == 32767))),
                     "stereo_correlation": float(np.corrcoef(x.T)[0, 1]) if channels == 2 else None}}


def summarize(c, start, end):
    f, t, p = c["f"], c["t"], c["psd"]
    selected = (t >= start) & (t < end) & c["active"]
    if selected.sum() < 2:
        raise ValueError("Analysis window needs at least two active spectral frames")
    p = p[:, selected]
    spec = p.mean(axis=1)
    region = (f >= 500) & (f <= 8000)
    frequencies = f[region]
    normal = p[region] / p[region].sum(axis=0)
    dominant_region = (f >= 500) & (f <= 4000)
    dominant = f[dominant_region][np.argmax(p[dominant_region], axis=0)]
    shares = [float(spec[(f >= lo) & (f < hi)].sum()/spec[region].sum()) for lo, hi in BANDS]
    # Find five separated peaks in the average spectrum. A fixed +/-40 Hz aperture
    # captures stationary lines and their Hann main lobes; it also counts any noise
    # inside the aperture. Its complement is NOT a measured noise fraction.
    peaks, _ = signal.find_peaks(spec, distance=max(1, round(100/(f[1]-f[0]))))
    peaks = sorted((i for i in peaks if 500 <= f[i] <= 8000), key=lambda i: spec[i], reverse=True)[:5]
    covered = np.zeros(len(f), dtype=bool)
    for i in peaks:
        covered |= np.abs(f-f[i]) <= 40
    concentration = float(spec[covered & region].sum()/spec[region].sum())
    # Distribution movement excludes overall level: adjacent normalized spectra,
    # total variation distance (0 unchanged; 1 disjoint), at roughly 5 ms spacing.
    flux = .5*np.abs(np.diff(normal, axis=1)).sum(axis=0)
    return {"range_seconds": [start, end], "active_frames": int(selected.sum()),
            "band_energy_fraction_500_8000": dict(zip([f"{a}-{b}" for a,b in BANDS], shares)),
            "dominant_500_4000_hz_p10_median_p90": np.percentile(dominant, [10, 50, 90]).tolist(),
            "centroid_500_8000_hz_median": float(np.median((normal*frequencies[:, None]).sum(axis=0))),
            "five_fixed_peak_apertures_energy_fraction": concentration,
            "peaks_hz": [float(f[i]) for i in peaks],
            "normalized_spectral_change_median": float(np.median(flux)),
            "normalized_spectral_change_p90": float(np.percentile(flux, 90))}


def modulation(c, start, end):
    # Envelope of the shared analysis band, with a 10 ms boxcar RMS. Compare
    # equal-duration interior excerpts to exclude the reference's fades.
    rate = c["rate"]
    sos = signal.butter(4, [500, 8000], btype="bandpass", fs=rate, output="sos")
    filtered = signal.sosfiltfilt(sos, c["x"], axis=0)
    power = np.mean(filtered**2, axis=1)
    n = round(rate*.01)
    envelope = np.sqrt(np.convolve(power, np.ones(n)/n, mode="valid"))[::round(rate*.002)]
    time = (np.arange(len(envelope))*round(rate*.002) + (n-1)/2)/rate
    use = (time>=start)&(time<end)
    e = envelope[use]
    envelope_rate = rate/round(rate*.002)
    # Remove variations slower than 5 Hz. This is an envelope descriptor,
    # not a calibrated psychoacoustic roughness measure or a stick-slip rate.
    fast = signal.sosfiltfilt(signal.butter(2,5,btype="highpass",fs=envelope_rate,output="sos"), e)
    trim = round(envelope_rate*.05)
    return {"range_seconds":[start,end], "envelope_rms_window_ms":10,
            "envelope_cv":float(e.std()/e.mean()),
            "above_5hz_envelope_rms_relative_to_mean":float(np.sqrt(np.mean(fast[trim:-trim]**2))/e.mean())}


def stages(clips, out):
    fig, axes = plt.subplots(2,2,figsize=(13,7),constrained_layout=True)
    fig.suptitle("The real sound changes spectral shape; the playground holds a harmonic pattern", fontsize=15, weight="bold")
    phase_colors = ["#027a91", "#d38c1e", "#b83770"]
    for j,(label,c) in enumerate(clips.items()):
        f,t,p = c["f"],c["t"],c["psd"]
        duration=c["meta"]["duration_seconds"]
        db=10*np.log10(np.maximum(p,1e-20)/p[(f>=500)&(f<=8000)].max())
        mesh=axes[0,j].pcolormesh(t,f/1000,db,shading="auto",cmap="magma",vmin=-45,vmax=0,rasterized=True)
        axes[0,j].set(xlim=(0,duration),ylim=(.5,4),xlabel="Time (seconds)",ylabel="Frequency (kHz)",title=label)
        for k in range(3):
            left,right=duration*k/3,duration*(k+1)/3
            mask=(t>=left)&(t<right)&c["active"]
            spec=p[:,mask].mean(axis=1)
            # Normalize each spectrum by total 0.5–8 kHz energy. All three
            # curves share the same reference, so changes are not merely gain.
            norm=spec/np.sum(spec[(f>=500)&(f<=8000)])
            axes[1,j].plot(f/1000,10*np.log10(np.maximum(norm,1e-12)),color=phase_colors[k],
                           label=f"{'Early Middle Late'.split()[k]}: {left:.2f}–{right:.2f}s",lw=1.4)
            if k:
                axes[0,j].axvline(left,color="white",alpha=.7,lw=.8,ls="--")
        axes[1,j].set(xlim=(.5,4),ylim=(-65,0),xlabel="Frequency (kHz)",ylabel="dB of total 0.5–8 kHz energy per FFT bin")
        axes[1,j].legend(fontsize=8,loc="upper right")
        for ax in axes[:,j]:
            ax.spines[["top","right"]].set_visible(False)
    fig.colorbar(mesh,ax=axes[0,:],fraction=.025,pad=.015,label="dB below each clip's spectral maximum")
    fig.supxlabel("Early/middle/late are equal recording thirds, not measured driving states. Shapes are level-normalized; time scales differ.",fontsize=9)
    fig.savefig(out/"tyre-recordings-stages.png",dpi=150)
    plt.close(fig)


def overview(clips, out):
    fig, axes = plt.subplots(4, 2, figsize=(14, 11), constrained_layout=True,
                             gridspec_kw={"height_ratios": [1, 2, 2, 1.25]})
    fig.suptitle("Real screech vs playground: what changes through time?", fontsize=18, weight="bold")
    for j, (label, c) in enumerate(clips.items()):
        f, t, p = c["f"], c["t"], c["psd"]
        duration = c["meta"]["duration_seconds"]
        axes[0,j].set_title(f"{label}  |  {duration:.2f} seconds", fontsize=13, weight="bold")
        axes[0,j].plot(c["trms"], c["rms"]/c["rms"].max(), color="#344b60")
        axes[0,j].set_ylabel("10 ms RMS\nrelative to clip max")
        axes[0,j].set_ylim(0,1.08)
        db = 10*np.log10(np.maximum(p, 1e-20)/p[(f>=500)&(f<=8000)].max())
        for row, high in [(1,8000),(2,2500)]:
            mesh = axes[row,j].pcolormesh(t, f/1000, db, shading="auto", cmap="magma", vmin=-55, vmax=0, rasterized=True)
            axes[row,j].set_ylim(.5, high/1000)
            axes[row,j].set_ylabel("Frequency (kHz)")
        total = p[(f>=500)&(f<=8000)].sum(axis=0)
        shares = [p[(f>=lo)&(f<hi)].sum(axis=0)/np.maximum(total, 1e-20) for lo,hi in BANDS]
        for k, ((lo,hi), share) in enumerate(zip(BANDS, shares)):
            axes[3,j].plot(t, np.where(c["active"], share, np.nan)*100, color=COLORS[k], label=f"{lo/1000:g}–{hi/1000:g} kHz", lw=1.2)
        axes[3,j].set_ylabel("Share of 0.5–8 kHz\nenergy (%)")
        axes[3,j].set_ylim(0,100)
        axes[3,j].set_xlabel("Time in original recording (seconds)")
        for ax in axes[:,j]:
            ax.set_xlim(0,duration)
            ax.spines[["top","right"]].set_visible(False)
    axes[3,1].legend(ncol=2, fontsize=8, loc="upper right")
    fig.colorbar(mesh, ax=axes[1:3,:], label="dB below each clip's strongest 0.5–8 kHz spectral bin", fraction=.025, pad=.02)
    fig.supxlabel("Native rates; 40 ms Hann windows, ~5 ms steps. Channel powers averaged. Separate clip references compare shape, not loudness.", fontsize=9)
    fig.savefig(out / "tyre-recordings-overview.png", dpi=150)
    plt.close(fig)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--good", type=Path, required=True)
    parser.add_argument("--bad", type=Path, required=True)
    parser.add_argument("--out", type=Path, required=True)
    args = parser.parse_args()
    args.out.mkdir(parents=True, exist_ok=True)
    clips = {"Real recording": read_clip(args.good), "Playground recording": read_clip(args.bad)}
    overview(clips, args.out)
    stages(clips, args.out)
    report = {"scope": "Analysis of two user-supplied recordings; no synthesis, acoustic source separation or listening acceptance.",
              "analysis_script_sha256": hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
              "method": {"window_ms":40, "hop_ms_approx":5, "fft_points":4096, "window":"Hann",
                         "stereo":"mean channel power; no mono cancellation", "active_frame_gate_db_below_clip_max":-25,
                         "analysis_band_hz":[500,8000], "dominant_peak_search_hz":[500,4000],
                         "peak_aperture_half_width_hz":40, "peak_count":5,
                         "normalization":"Per-clip display references; per-frame unit energy for spectral-change metrics. No input audio modified."},
              "versions":{"numpy":np.__version__, "scipy":scipy.__version__, "matplotlib":matplotlib.__version__},
              "clips": {}}
    for label, c in clips.items():
        duration = c["meta"]["duration_seconds"]
        report["clips"][label] = {**c["meta"], "whole": summarize(c,0,duration),
                                 "thirds": [summarize(c,duration*k/3,duration*(k+1)/3) for k in range(3)],
                                 "matched_interior_0_4_to_1_4_seconds": summarize(c,.4,1.4),
                                 "matched_interior_envelope": modulation(c,.4,1.4)}
    (args.out / "tyre-recordings-analysis.json").write_text(json.dumps(report,indent=2,allow_nan=False)+"\n",encoding="utf-8")
    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    main()
