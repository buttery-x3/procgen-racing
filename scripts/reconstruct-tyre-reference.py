"""Local reference reconstruction for a short listening decision.

Requires numpy, scipy, matplotlib. Inputs and generated audio stay outside the
distributed assets. No original waveform phase is used in the residual source.
"""

import argparse
import hashlib
import json
import math
import wave
from pathlib import Path

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np
import scipy
from scipy import signal
from scipy.ndimage import gaussian_filter, gaussian_filter1d
from scipy.optimize import linear_sum_assignment
from scipy.io import wavfile

RATE = 48000
WINDOW = 2048
HOP = 240
FFT = 8192
SEED = 20261026


def read_mono(path):
    with wave.open(str(path), "rb") as wav:
        if wav.getsampwidth() != 2 or wav.getcomptype() != "NONE":
            raise ValueError("Expected 16-bit PCM WAV")
        rate, channels = wav.getframerate(), wav.getnchannels()
        x = np.frombuffer(wav.readframes(wav.getnframes()), dtype="<i2")
    x = x.reshape(-1, channels).astype(np.float64).mean(axis=1) / 32768
    divisor = math.gcd(rate, RATE)
    return signal.resample_poly(x, RATE // divisor, rate // divisor)


def stft(x):
    return signal.stft(x, fs=RATE, window="hann", nperseg=WINDOW,
                       noverlap=WINDOW-HOP, nfft=FFT, boundary="zeros", padded=True)


def tracks_from_spectrum(f, times, z):
    magnitude = np.abs(z)
    floor = magnitude.max() * 10**(-50/20)
    tracks = []
    for frame, time in enumerate(times):
        column = magnitude[:, frame]
        peaks, _ = signal.find_peaks(column, distance=10, prominence=floor)
        peaks = sorted((k for k in peaks if 450 <= f[k] <= 7200 and column[k] > floor),
                       key=lambda k: column[k], reverse=True)[:18]
        observations = []
        for k in peaks:
            values = np.log(np.maximum(column[k-1:k+2], 1e-15))
            denominator = values[0] - 2*values[1] + values[2]
            offset = np.clip(.5*(values[0]-values[2])/denominator, -.5, .5) if denominator else 0
            hz = (k+offset)*RATE/FFT
            amplitude = 2*np.exp(values[1] - .25*(values[0]-values[2])*offset)
            phase = np.angle(z[k, frame]) + 2*np.pi*hz*WINDOW/(2*RATE)
            observations.append((frame, hz, amplitude, phase))
        active = [i for i, track in enumerate(tracks) if frame-track[-1][0] <= 2]
        used = set()
        if active and observations:
            cost = np.array([[abs(tracks[i][-1][1]-obs[1]) for obs in observations] for i in active])
            rows, columns = linear_sum_assignment(cost)
            for row, col in zip(rows, columns):
                # No harmonic grid: a track follows a nearby local ridge.
                if cost[row, col] <= 70:
                    tracks[active[row]].append(observations[col])
                    used.add(col)
        tracks.extend([[obs] for i, obs in enumerate(observations) if i not in used])
    # Suppress very short noise peaks. Retain independent tracks lasting >=40 ms.
    tracks = [track for track in tracks if track[-1][0]-track[0][0] >= 8]
    return tracks


def render_tracks(tracks, times, count, freeze_time=None):
    out = np.zeros(count)
    sample_times = np.arange(count)/RATE
    used = 0
    for track in tracks:
        table = np.array(track)
        t = times[table[:,0].astype(int)]
        if freeze_time is not None:
            if not t[0] <= freeze_time <= t[-1]:
                continue
            hz = np.interp(freeze_time,t,table[:,1])
            amplitude = np.interp(freeze_time,t,table[:,2])
            out += amplitude*np.cos(2*np.pi*hz*sample_times + table[0,3])
        else:
            start, end = max(0,round(t[0]*RATE)), min(count,round(t[-1]*RATE)+1)
            local_times = sample_times[start:end]
            frequency = np.interp(local_times,t,table[:,1])
            amplitude = np.interp(local_times,t,table[:,2])
            # Continuous integrated frequency; original phases are not copied per frame.
            phase = table[0,3] + 2*np.pi*np.r_[0,np.cumsum((frequency[1:]+frequency[:-1])/(2*RATE))]
            fade = min(round(.01*RATE),len(amplitude)//2)
            if fade:
                ramp = np.sin(np.linspace(0,np.pi/2,fade))**2
                amplitude[:fade] *= ramp
                amplitude[-fade:] *= ramp[::-1]
            out[start:end] += amplitude*np.cos(phase)
        used += 1
    return out, used


def noise_from_envelope(power, count, seed):
    rng = np.random.default_rng(seed)
    _, _, noise_z = stft(rng.standard_normal(count))
    window = signal.get_window("hann",WINDOW)
    expected_power = np.sum(window**2)/np.sum(window)**2
    shaped = noise_z*np.sqrt(power/expected_power)
    _, noise = signal.istft(shaped,fs=RATE,window="hann",nperseg=WINDOW,
                            noverlap=WINDOW-HOP,nfft=FFT,boundary=True)
    return noise[:count]


def match_envelope(x, target):
    # Shared 10 ms RMS envelope, sampled every 5 ms. Retain phase and short texture.
    sigma = RATE*.005
    indices = np.r_[np.arange(0,len(x),HOP),len(x)-1]
    desired = np.sqrt(gaussian_filter1d(target**2,sigma))[indices]
    for _ in range(2):
        actual = np.sqrt(gaussian_filter1d(x**2,sigma))[indices]
        ratio = np.clip(desired/np.maximum(actual,1e-7),0,8)
        x = x*np.interp(np.arange(len(x)),indices,ratio)
    return x


def stats(x):
    f,t,z = stft(x)
    p = np.abs(z)**2
    band = (f>=500)&(f<=8000)
    energy = p[band].sum(axis=0)
    active = energy > energy.max()*10**(-25/10)
    normal = p[band][:,active]/energy[active]
    centres = (normal*f[band,None]).sum(axis=0)
    result = {"duration_seconds":len(x)/RATE,"rms_dbfs":float(20*np.log10(np.sqrt(np.mean(x*x)))),
              "peak_dbfs":float(20*np.log10(np.max(np.abs(x)))),
              "normalized_spectral_change_median":float(np.median(.5*np.abs(np.diff(normal,axis=1)).sum(axis=0))),
              "centroid_500_8000_hz_median":float(np.median(centres)),"third_centroids_hz":[]}
    for k in range(3):
        use = active & (t>=len(x)/RATE*k/3) & (t<len(x)/RATE*(k+1)/3)
        norm = p[band][:,use]/energy[use]
        result["third_centroids_hz"].append(float(np.median((norm*f[band,None]).sum(axis=0))))
    return result


def write_wav(path, x):
    if not np.isfinite(x).all() or np.max(np.abs(x)) >= .99:
        raise ValueError("Non-finite or insufficient-headroom render")
    wavfile.write(path,RATE,np.round(x*32767).astype(np.int16))


def plot(clips,path):
    fig, axes = plt.subplots(2,2,figsize=(13,7),constrained_layout=True)
    for ax,(label,x) in zip(axes.flat,clips.items()):
        f,t,z = stft(x)
        p=np.abs(z)**2
        db=10*np.log10(np.maximum(p,1e-20)/p[(f>=500)&(f<=8000)].max())
        mesh=ax.pcolormesh(t,f/1000,db,shading="auto",cmap="magma",vmin=-45,vmax=0,rasterized=True)
        ax.set(title=label,xlim=(0,len(x)/RATE),ylim=(.5,4),xlabel="Time (seconds)",ylabel="Frequency (kHz)")
    fig.suptitle("Prepared reference audition: measured trajectories versus frozen character",fontsize=15,weight="bold")
    fig.colorbar(mesh,ax=axes.ravel().tolist(),fraction=.025,label="dB below each clip's spectral maximum")
    fig.supxlabel("All clips 1.87 s and matched whole-clip RMS. Reconstruction and frozen control share the reference's coarse level envelope.",fontsize=9)
    fig.savefig(path,dpi=130)
    plt.close(fig)


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--good",type=Path,required=True)
    parser.add_argument("--bad",type=Path,required=True)
    parser.add_argument("--out",type=Path,default=Path("artifacts/tyre-reference"))
    parser.add_argument("--report",type=Path,default=Path("docs/research/tyre-reconstruction.json"))
    args=parser.parse_args()
    if not (Path("artifacts").resolve() in args.out.resolve().parents):
        raise ValueError("Generated reference audio must stay in ignored artifacts/")
    args.out.mkdir(parents=True,exist_ok=True)
    reference=read_mono(args.good)
    count=len(reference)
    f,t,z=stft(reference)
    tracks=tracks_from_spectrum(f,t,z)
    tonal,_=render_tracks(tracks,t,count)
    _,_,tonal_z=stft(tonal)
    # Estimate residual POWER after modelling the ridges. Fill/smooth subtraction
    # holes so residual texture has spectral width rather than isolated FFT bins.
    residual=np.maximum(np.abs(z)**2-np.abs(tonal_z)**2,0)
    residual=gaussian_filter(residual,sigma=(7,1))
    residual[(f<150)|(f>10000)]=0
    noise=noise_from_envelope(residual,count,SEED)
    reconstructed=match_envelope(tonal+noise,reference)
    freeze_time=round((count/RATE/2)/(.005))*.005
    frozen_tonal,frozen_count=render_tracks(tracks,t,count,freeze_time)
    middle=np.abs(t-freeze_time)<=.05
    frozen_power=np.repeat(residual[:,middle].mean(axis=1)[:,None],len(t),axis=1)
    frozen_noise=noise_from_envelope(frozen_power,count,SEED)
    frozen=match_envelope(frozen_tonal+frozen_noise,reference)
    old=read_mono(args.bad)
    old=old[round(.4*RATE):round(.4*RATE)+count]
    if len(old)!=count:
        raise ValueError("Previous recording is too short for the comparison excerpt")
    clips={"Real reference":reference,"Reconstruction":reconstructed,
           "Frozen character":frozen,"Previous playground":old}
    target=10**(-23/20)
    clips={label:x*target/np.sqrt(np.mean(x*x)) for label,x in clips.items()}
    common=min(1,.7/max(np.max(np.abs(x)) for x in clips.values()))
    clips={label:x*common for label,x in clips.items()}
    definitions=[("reference","Real reference","reference.wav"),
                 ("reconstruction","Reconstruction","reconstruction.wav"),
                 ("frozen","Frozen character","frozen.wav"),
                 ("previous","Previous playground","previous.wav")]
    outputs=[]
    for identity,label,filename in definitions:
        path=args.out/filename
        write_wav(path,clips[label])
        outputs.append({"id":identity,"label":label,"file":filename,
                        "sha256":hashlib.sha256(path.read_bytes()).hexdigest(),**stats(clips[label])})
    manifest={"format":"procgen-racing:tyre-reference-audition","version":1,
              "durationSeconds":count/RATE,"levelDbfs":float(20*np.log10(target*common)),
              "clips":[{"id":identity,"label":label,"file":filename} for identity,label,filename in definitions]}
    (args.out/"manifest.json").write_text(json.dumps(manifest,indent=2)+"\n",encoding="utf-8")
    report={"scope":"Short offline reference reconstruction for human review; no realtime voice or driving integration.",
            "script_sha256":hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
            "sources":[{"filename":path.name,"sha256":hashlib.sha256(path.read_bytes()).hexdigest()} for path in [args.good,args.bad]],
            "method":{"rate_hz":RATE,"window_frames":WINDOW,"hop_frames":HOP,"fft_points":FFT,
                      "max_peaks_per_frame":18,"minimum_track_seconds":.04,"retained_tracks":len(tracks),
                      "freeze_time_seconds":freeze_time,"frozen_tracks":frozen_count,
                      "residual":"Fresh seeded Gaussian excitation filtered by smoothed residual power; original residual phases discarded",
                      "level_envelope":"10 ms Gaussian RMS, sampled every 5 ms, two smooth gain-fit passes",
                      "previous_excerpt_start_seconds":.4,"noise_seed":SEED},
            "versions":{"numpy":np.__version__,"scipy":scipy.__version__,"matplotlib":matplotlib.__version__},
            "outputs":outputs,"limitations":["Measurement is not listening acceptance.",
              "Reference-specific analysis/resynthesis; not a generative tyre or an isolated physical source model.",
              "Frozen control freezes active mid-phrase partials and local residual colour; it is not mathematically identical except for a single variable.",
              "Matched RMS is not matched perceived loudness.","All audio is local, ignored and excluded from production build assets."]}
    args.report.write_text(json.dumps(report,indent=2,allow_nan=False)+"\n",encoding="utf-8")
    plot(clips,args.report.with_suffix(".png"))
    print(json.dumps(report,indent=2))


if __name__=="__main__":
    main()
