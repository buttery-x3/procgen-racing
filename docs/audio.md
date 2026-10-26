# Synthesized driving audio

This feature follows the completed M8 release as separate work on
`codex/synthesized-driving-audio`. It replaces the initial aggregate driving
sound with an RPM/load engine and four independent tyre voices. It is integrated
through `development`; release promotion remains a separate request.
The [research and approved plan](research/audio-system.md) records the rationale.

**Sound-quality review, 26 October 2026:** the playground's pulse/exhaust engine
is accepted as a promising base for later vehicle tuning. Its new tyre voice is
rejected as rain-like; the user likes its modulation but wants a convincing
high-pitched squeal underneath. The [tonal tyre pass](research/audio-timbre.md#tonal-tyre-pass-ready-for-listening)
adds a coherent squeal with shaped harmonics and optional scrape down to true
zero in the playground. It is ready for a short listening decision. The original
production voices remain the infrastructure/comparison baseline; existing
qualification records are preserved.

## Sound-quality playground

Open `/audio-playground.html` on the running development server for the short
audible A/B prototype. **A** is the existing production engine and tyre voice;
**B** is the accepted-direction combustion-pulse/exhaust-path engine and the new
tonal tyre candidate. Both get the same short synthetic RPM/load or slip
controls. The page starts on B, solo tyre, a dry sustained slide and zero
scrape; switch A/B during playback with a 60 ms fade. The comparison does not
replace the driving game's audio.

Choose an idle, steady-load, sweep or shift engine example, or a scrub, onset,
sustained slide or recovery tyre example. Each ends after 7–9 seconds unless
Loop is selected. Manual mode lets you vary RPM, engine load, tyre slip, sliding
speed and wheel load. Solo engine, tyre or surface, or hear a simple mix. Start
with Dry/Centred, then try the existing `SpatialAudio` headphone, stereo or mono
routing and select a wheel. The per-candidate meters show digital RMS before
audition trim. On a steady example, **Match B level to A** sets an approximate
trim; leave that trim fixed when comparing a sweep or onset. The shared output
has a protective limiter, but no per-example loudness normalization.

B exposes engine body, exhaust openness, rasp, pulse unevenness and mechanical
texture. The new tyre controls are squeal strength, harmonic edge, pitch
character, irregular roughness, optional scrape, onset and release. The previous
noise-driven tyre can still be loaded as a named built-in comparison or through
its saved presets, with its original controls and sound.
Named versioned presets live under a separate local-storage key, with load,
duplicate, revert, JSON export and validated JSON import. They carry the
backend version, seed, fixture, manual controls, route, wheel and audition trims; no sample assets
are used. Saving or importing a preset never applies it to the game. The first
listening review accepted B's engine direction but rejected its first tyre
source; meters only check for an active, finite digital signal. The new tyre
candidate awaits the user's short sound review. Real-control capture/replay and
a mix review follow source selection before production integration.

This playground uses one isolated AudioWorklet module, loaded only after Play.
The existing production `EngineVoice`, `TyreVoice`, collector, buses, preferences,
and qualification reports are unchanged. Focused checks for the tonal pass cover
both preset backends, short processor renders at 44.1/48 kHz, the build and a
brief visible A/B and legacy playback check. No 20-minute endurance test or
channel campaign is required.

## Listening and controls

Sound is **enabled by default**. The first trusted pointer or keyboard interaction
starts playback under the browser's autoplay rules. The header sound button mutes
or resumes it. Explicit mute and zero volume persist in this browser.

**Sound settings** contains master, engine, tyre and road/impact levels;
Headphones, Stereo and Mono modes; stereo width; front/rear tone strength; and a
softer squeal option. Four labeled wheel buttons demonstrate the current mode,
and the channel checks isolate left or right. Checks honor mute and zero levels.
Closing the dialog or pressing Stop check clears the audition before driving
resumes. Restoring defaults enables sound again.

The engine keeps a quiet, uneven idle. Actual RPM controls pitch, while effective
engine/clutch effort controls growl and brightness. A shift reduces the load
layer without fabricating an RPM drop; downshifts and clutch-open rev flares
follow physics. Compact, sport and deep profiles vary by car family and seed.

Each grounded, loaded tyre has a soft warning scrub near the model's grip peak
and a stronger sliding texture beyond it. Wheelspin can sound while the car is
stationary. Unloaded/airborne tyres and a stopped held car stay quiet. Kerb,
gravel, sand and grass textures blend independently at each contact.

Front tyres have brighter, smoother character; rear tyres are lower and rougher.
Headphone HRTF processing supplies four driver-relative quadrants and the axle
timbres provide a second cue. Positions stay attached to the car across camera
changes and reversing. Stereo mode preserves side panning; Mono preserves axle
timbres and intensity but cannot preserve left/right identity.

Generic HRTFs can produce front/back reversals. Use the labeled checks to learn
the timbres or select Stereo if that is clearer. A tyre becoming louder is
evidence of its contact/slip state, not an automatic diagnosis of understeer or
oversteer.

Preferences have their own version and are excluded from session compatibility.
The sound settings dialog pauses driving like other workbench dialogs, so opening
it during a timed lap follows the existing pause-validity rule. Header mute does
not pause driving.

## Implementation

The system uses native Web Audio nodes with generated periodic waves and seeded
noise. It downloads no recordings and adds no audio dependency or worklet.

Noise buffer lengths have an exact frames → seconds → frames round trip.
Chromium 152 has a [loop-boundary regression](https://issues.chromium.org/issues/561828152)
that can turn a fractional residue above the last frame into persistent buzz,
invalid samples or silence. The original rear-left loop had 100,368 frames at
48 kHz, which round-trips to 100368.00000000001. Selecting a nearby exact frame
count avoids that native bug while preserving playback rate, seeded generation
and essentially the same loop duration. This fixes the reported Vivaldi cut-out.

- `AudioControls` derives finite, bounded engine and per-wheel controls. It
  calculates wheel slip with the generated car's resolved radius and normalizes
  combined demand to the existing tyre peaks. Warning onset is authored around
  q = 0.65–0.95; sustained sliding blends in around q = 0.95–1.2.
- `AudioControlCollector` captures each 120 Hz physics step and preserves brief
  shift/slip events until the frame publishes. Latest contact/load limits always
  win over retained peaks. Reset/time gaps clear pending history.
- `EngineVoice` and `TyreVoice` generate the tones/noise, while `SpatialAudio`
  selects HRTF, ordinary stereo or mono paths. Missing spatial APIs fall back
  through stereo to mono.
- `VehicleAudioGraph` mixes tyre and surface levels before each wheel's panner,
  reduces the engine by up to 3 dB during strong tyre feedback, and reserves
  digital headroom with a static symmetric output shaper.
- `VehicleAudio` owns the single browser context, trusted-gesture activation,
  mute/resume recovery and bounded graph replacement. A scheduled fade silences
  stale input after 200 ms even if the main thread stalls.

Pause/reset/audition changes clear tyre/impact envelopes. A 40 ms quiet transition
prevents stale test audio returning with live telemetry. Profile replacement
fades old graphs, bounds retirement and disposes them; repeated teardown is safe.
Mute allows 50 ms for the native fade before suspension; an interrupted context
zeros its output gate before resuming. A new context resets audio-clock history. The timing diagnostic includes all
physics-step captures plus graph publication per animation frame, with browser
audio-thread work explicitly excluded.

Existing vehicle/race code, result compatibility, generation and visual
skid/smoke sensitivity are unchanged. `drivingFeedback` remains the visual
feedback implementation; the new warning signal is audio-only.

## Choosing checks and reproducing full audio qualification

For each development commit select only the checks affected by its diff. Voice
tuning uses short listening comparisons and relevant voice/native-render cases;
control changes use control/collector cases. Recheck lifecycle/channel behavior
when those boundaries change, and actual driving when that integration changes.
Do not rerun the whole lab or full regression suite for each preset or feature.
Documentation-only work needs document/link/diff review.

The full regression suite and production build are required before promotion
into `main`; see [validation policy](workflow.md#validation-scope--revised-26-october-2026).
The following commands reproduce the broader audio qualification when it is
specifically needed, rather than forming a per-commit checklist:

```sh
npm run build
npm run qualify:audio
npm run dev
```

Open `http://127.0.0.1:5173/audio-lab.html` (use the server's actual port).
**Run offline qualification** renders at 44.1/48 kHz. **Check live lifecycle**
exercises actual context activation, mute, profile replacement and disposal.
Also open `/audio-driving.html` and select **Run launch / shift / stop**. It
uses the production App, real physics, the collector and the actual native graph:
idle → launch → observed first automatic upshift → recovery → brake to rest →
three seconds idle → three seconds relaunch throttle → final stop. Keep the app
visible and unpaused; focus loss interrupts the automatic sequence. The live
readout identifies invalid engine, wheel, spatial, mix and output samples.

The 20-minute endurance tool is optional and is excluded from required checks.
Run it only on an explicit user request. Routine fixes select the relevant short
checks above; they do not automatically run every category.

In development the lab saves bounded JSON to
`artifacts/audio-browser.json` through a same-origin local endpoint. The actual
driving page saves its compact stage/node report separately to
`artifacts/audio-driving-browser.json`; its full downloaded report can also
include up to 600 rolling observations. Production builds provide Copy/Download
JSON instead. Publishing a new complete qualification is separate from ordinary
targeted validation. Retain baseline reports with their original hashes and save
new targeted evidence with its actual scope; do not repeat successful tests just
because the broad publisher fingerprint changed. To publish completed reports:

```sh
npm run report:audio
# Or: npm run report:audio -- --browser=path/to/downloaded-report.json
#       --driving=path/to/downloaded-driving-report.json
```

The publisher rejects stale source fingerprints and failed offline/lifecycle
checks. It does not require a stress run.
It also requires a source-matching actual-app report with every driving stage,
an observed upshift, meaningful eligible samples, no interruption/error events,
and finite engine/wheel/output signals without sampled silence or app stalls.
Fingerprint inputs include audio sources, App/workbench integration and the lab
itself. Restart Vite after source edits before measuring. The result is
[the separate audio qualification report](research/audio-qualification.json);
the real App result is [the driving audio report](research/audio-driving-qualification.json).
M8 and historical generation evidence retain their original source hashes.
The loop-fix delivery also saves its actual
[native regression export](research/audio-loop-regression.json) directly. Its
`runtimeSmoke` and `stress` fields remain null: these checks were not rerun for
that export after the user asked to stop repeating validation. The earlier full
feature report remains historical evidence rather than being relabeled.

## Recorded baseline validation scope

The feature passes **307 regression tests**, including **63 audio tests**.
The production build and strict TypeScript check pass; the existing large-chunk
warning remains. Chromium OfflineAudioContext testing passes **131 checks across
58 rendered cases**. Four live lifecycle checks also passed earlier in the
session, before the validation-policy edits; the final export does not claim a
new lifecycle run. Native coverage includes dynamic
launch/shift/stop/relaunch transitions and 7.2-second loop renders in Headphones,
Stereo and Mono at both sample rates. The old 850 ms steady renders could not
exercise a two-second loop boundary. The regression test for the actual failing
rear-left length fails before the fix and passes with the new frame count.

The browser report records both sample rates, per-wheel stereo/HRTF channel
balance, mono fold-down, axle spectra, engine load/shift/rev/overrun differences,
near-limit/sliding escalation, bounded samples and pause/watchdog/mute tails.
Overrun is checked by the actual waveform difference from an otherwise identical
coast render, not by assuming additive noise must increase total RMS.

The user's Vivaldi/Chromium 152 live diagnostic reproduced a healthy engine bus
but 165/165 invalid rear-left input and final-output observations, with no app
stall or JavaScript error. After the loop fix, the user confirmed playback and
the same browser recorded finite wheel/mix/output signals through launch, the
first upshift and braking. The production bundle is also checked through the
complete actual-app sequence, including stopped idle and relaunch. Digital
signal measurements remain separate from human spatial-recognition testing.

The original feature's long Chromium 155 run is historical evidence in Git. It
did not establish Chromium 152 compatibility. The current report uses the short
loop regressions and actual-app sequence; no new endurance result is claimed.

The reference hardware is AMD Ryzen 5 5600X (12 logical processors), 32 GiB RAM
and NVIDIA GeForce RTX 3060, using Chromium 155 on Windows. Production-bundle
driving checks cover the full launch/shift/stop/relaunch sequence. The physics
compatibility fingerprint remains
`3915c9277118cf78`. Browser device latency estimates are not measured action-to-ear
delay.

**Human wheel recognition, fatigue/comfort, acoustic end-to-end latency,
hardware-underrun detection, Firefox and Safari remain unmeasured.** Digital
channel balance and spectral differences do not establish human recognition.
The lab includes a real randomized 32-trial identification test with engine
masking and mode selection. It records only submitted responses and a confusion
matrix; no listening score is fabricated by automated qualification.
