"""Export a LOCAL spectral control model using the accepted reconstruction analysis.

The model contains partial trajectories and residual magnitudes, never PCM or
residual phases. It remains in ignored artifacts/, outside distributed assets.
"""
import argparse
import hashlib
import importlib.util
import json
from pathlib import Path

import numpy as np
from scipy.ndimage import gaussian_filter


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--reference", type=Path, required=True)
    args = parser.parse_args()
    source = Path(__file__).with_name("reconstruct-tyre-reference.py")
    spec = importlib.util.spec_from_file_location("accepted_reconstruction", source)
    analysis = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(analysis)
    x = analysis.read_mono(args.reference)
    f, times, z = analysis.stft(x)
    tracks = analysis.tracks_from_spectrum(f, times, z)
    tonal, _ = analysis.render_tracks(tracks, times, len(x))
    _, _, tonal_z = analysis.stft(tonal)
    power = gaussian_filter(np.maximum(np.abs(z)**2 - np.abs(tonal_z)**2, 0), sigma=(7, 1))
    power[(f < 150) | (f > 10000)] = 0
    # Reuse a slot only after its earlier track has ended. Track IDs preserve
    # births/deaths when the live character position moves in either direction.
    ends, assigned = [], []
    for identity, track in enumerate(sorted(tracks, key=lambda row: row[0][0]), 1):
        start = track[0][0]
        slot = next((i for i, end in enumerate(ends) if end < start), len(ends))
        if slot == len(ends):
            ends.append(-1)
        ends[slot] = track[-1][0]
        assigned.append((identity, slot, np.array(track)))
    slots, frames = len(ends), len(times)
    partials = np.zeros((frames, slots, 3))
    phases = [0.0] * (len(tracks) + 1)
    for identity, slot, track in assigned:
        start, end = int(track[0,0]), int(track[-1,0])
        indices = np.arange(start, end+1)
        partials[indices, slot, 0] = identity
        partials[indices, slot, 1] = np.interp(indices, track[:,0], track[:,1])
        fade = np.minimum(1, np.minimum(indices-start, end-indices)*.005/.01)
        partials[indices, slot, 2] = np.interp(indices, track[:,0], track[:,2])*fade
        phases[identity] = float(track[0,3] % (2*np.pi))
    # A 2048-point synthesis grid preserves the broad residual bands while
    # discarding the original noise phase. Hann ENBW is 1.5 frequency bins.
    step = analysis.RATE/2048
    frequencies = np.arange(int(np.ceil(10000/step))+1)*step
    residual_power = np.array([np.interp(frequencies, f, power[:,i]) for i in range(frames)])
    expected = .5*np.sum(partials[:,:,2]**2, axis=1) + 2/1.5*np.sum(residual_power, axis=1)
    normalize = .07/np.sqrt(np.maximum(expected, 1e-8))
    partials[:,:,2] *= normalize[:,None]
    residual = np.sqrt(residual_power)*normalize[:,None]
    source_hash = hashlib.sha256(args.reference.read_bytes()).hexdigest()
    identity = "local:tyre-spectrum-v1:"+source_hash
    model = {"format":"procgen-racing:tyre-control-model", "version":1, "id":identity,
             "frames":frames, "slots":slots, "noiseBins":len(frequencies),
             "frequencyStepHz":step, "hopSeconds":.005,
             "durationSeconds":float(times[-1]),
             "partials":np.round(partials,7).reshape(-1).tolist(),
             "residual":np.round(residual,8).reshape(-1).tolist(), "initialPhases":phases}
    if slots > 32:
        raise ValueError("The prototype has a 32-slot limit")
    directory = Path("artifacts/tyre-reference")
    directory.mkdir(parents=True,exist_ok=True)
    output = directory/"control-model.json"
    output.write_text(json.dumps(model,separators=(",",":"),allow_nan=False)+"\n",encoding="utf-8")
    report = {"scope":"Local reference-specific control model, for a live playground hearing decision.",
              "model_id":identity,"source_sha256":source_hash,
              "analysis_script_sha256":hashlib.sha256(source.read_bytes()).hexdigest(),
              "export_script_sha256":hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
              "model_sha256":hashlib.sha256(output.read_bytes()).hexdigest(),
              "model_bytes":output.stat().st_size,"frames":frames,"partial_slots":slots,
              "retained_tracks":len(tracks),"residual_bins":len(frequencies),
              "synthesis_fft_frames":2048,"normalization":"Per-frame expected model RMS 0.07; input clip envelope removed",
              "limitations":["Reference-specific model is local and excluded from the production build.",
                              "No realtime sound acceptance or production integration is inferred."]}
    Path("docs/research/tyre-control-model.json").write_text(json.dumps(report,indent=2)+"\n",encoding="utf-8")
    print(json.dumps(report,indent=2))


if __name__ == "__main__":
    main()
