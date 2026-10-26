# Accepted engine and screech in driving

27 October 2026. The owner accepted the controllable screech and authorized
integration of that voice and the previously accepted pulse/exhaust engine into
the simulation. This pass is on `codex/reference-audio-integration`, delivered
through `development` for driving/listening adjustments. It is not a release.

## Try it

Open the normal application (`/` on the running Vite server), select **Drive pad**
or a circuit, and drive normally. The first interaction loads the sounds. The
existing **Sound settings** mixer controls engine, tyres, road/impacts and output
mode. **Softer tyre squeal**, axle difference and wheel auditions use the new
source. No qualification run is required from the user before trying it.

The playground remains available for isolated comparisons and tuning. Its accepted
default and driving now share `reference-tuning.ts`. Saved audition presets do
not automatically overwrite the simulation. Changes to the mix while driving
still use the existing persistent sound preferences. Further timbre/family tuning
can follow the owner's driving feedback.

## Integration

- The exact accepted `PulseExhaust` renderer receives actual RPM, engine/clutch
  load, overrun and shift state. Its synthesis and accepted five tuning defaults
  are retained. All vehicles initially share this base; their existing cosmetic
  seed is retained. Compact/sport/deep family retuning remains later listening work.
- Four independent instances of the accepted `ReferenceTyre` renderer receive
  their own contact, slip, warning and load. Their spectral character moves through
  entry, holding and recovery, with continuous phase and fresh residual texture.
  This is synthesis from the prepared model, not playback of the source WAV.
- The collector already weights slip/warning by load. The new adapter separates
  unweighted character inputs from that once-weighted level. The worklet uses
  that supplied level directly; it does not apply another square-root load factor.
- The established native road/loose-surface/kerb branch is retained as `SurfaceVoice`.
  The prototype's simple rolling-noise output is disconnected. Surface/material
  response, impacts, spatial paths, bus levels, tyre-driven engine ducking,
  symmetric output ceiling and the stale-control fade remain in place.
- Rear pitch difference follows the existing axle-cue preference; softer squeal
  reduces level and high frequencies. Existing headphone/stereo/mono routing
  remains unchanged. Each wheel uses its own seed and contact history.
- Worklet modules and the local spectral model prepare once per audio context.
  Output stays closed until all sources acknowledge readiness. Loading frames
  are discarded, and a fresh control frame opens playback. Mute, pause, setup
  replacement and disposal invalidate old work safely. Retired processors receive
  an explicit stop message and disconnect. Quiet wheels skip spectral transforms.
- Processor/load failures surface through the runtime's unavailable state rather
  than silently selecting an old rejected source. A normal sound toggle retries.

The original `EngineVoice`/`TyreVoice` remain the playground A comparison and the
native/offline foundation in `audio-lab.html`. That lab's native renders are
historical-source checks, not certification of the new worklet sound. Its runtime
smoke and the actual-app driving diagnostic exercise `VehicleAudio`, which now
selects the accepted sources. No physics, slip model, race rules, generation or
result-compatibility code changed.

## Local profile and release boundary

The same already-prepared local profile powers the playground and driving:
`artifacts/tyre-reference/control-model.json`, served by the existing development
route `/__audio-reference/control-model.json`. Its SHA-256 is
`0f640d311e0f7c9297bb30b9784880553ac67275b433705b9629b291d6ec6082`.
The runtime checks the accepted model identity before creating wheel sources.
See [local preparation](controlled-tyre-screech.md#presets-and-local-preparation)
for a new checkout. It is present on the current testing machine.

As in the accepted research plan, reference-derived model/WAV data stays local
and ignored. This development integration is usable in the Vite simulation;
it does not yet package a distributable tyre profile. A standalone release needs
an authored or appropriately reusable profile and its packaging. A missing model
reports unavailable audio. The owner deferred main promotion, full release
verification and broader vehicle voicing while driving adjustments remain open.

## Targeted evidence

The [integration record](reference-audio-integration.json) retains the tested
source fingerprint, model hash, browser, stage summaries and scope.
After the short run, only the Audio lab's explanatory caption changed to identify
its legacy native sources. The record retains the measured fingerprint and records
that caption-only difference; no driving/source check was repeated for a label.

- **38 tests passed** across the driving adapters/graph, asynchronous runtime,
  shared fixtures/presets and reference worklet. They cover readiness/mute races,
  stale setup completion, load mapping, four independent wheel sources,
  preserved native surface lifecycle, contact release, quiet processing and stop.
- **`npm run typecheck` passed.** No full regression suite, production-release
  build, broad audio qualification, generation campaign, channel study or
  endurance run was performed for this commit.
- One **21.55-second actual-app** idle → launch → first upshift → recovery →
  braking → stopped idle → relaunch → final stop run at **48 kHz** recorded
  **216 samples**, all finite, with no recorded silence, context or app-stall
  failures and no uncaught errors. Each wheel input had nonzero activity.
  Control publication p95 was approximately **0.3 ms**, excluding audio-thread work.

This is a bounded digital integration check in the app's Chromium 155 environment,
not a hardware latency/underrun measurement, a Vivaldi retest or an acoustic quality
verdict. The next listening step is ordinary driving by the owner. The accepted
engine/tyre prototype evidence and original channel/runtime reports retain their
own hashes and limitations; none were relabelled as a new complete qualification.
