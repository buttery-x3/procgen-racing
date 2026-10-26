# Accepted screech direction: live control prototype

27 October 2026. The user accepted the short reconstruction with “yes perfectly,
this is the direction” and approved making it respond to slip/load in the
playground. **The owner has now accepted the controllable version and authorized
driving integration.** The [integration notes](reference-audio-integration.md)
describe its use in the simulation; driving mix/tuning is the next listening step.

## Hear it

The source/comparison recordings and reference playback controls were subsequently
removed at the owner's request. The live playground now loads its parameter model
from the application's static assets. The original hearing procedure below is
retained as a development record; only the live cycle/manual controls remain.

Open **`/audio-playground.html`**. It starts on **B · Live screech**, solo tyre,
dry/centred, with **Build → slide → recover → slide** selected.

1. **Hear accepted reference · 2 seconds** replays the accepted reconstruction.
2. **Play example** plays the 10.5-second live-control cycle. Its second slide
   has lower wheel load. Judge whether entry, holding a slide, recovery and
   re-entry retain the accepted screech character.
3. Optional: select **Manual controls**, which keeps Tyre solo selected. Vary
   slip, sliding speed and wheel load. Sustained sliding continues until Stop;
   it does not reach the end of a recording. Zero wheel load removes contact.

A remains the original production source. It is a historical comparison, not the
accepted target. The two-second reference plays separately and stops the live
graph; starting a live example stops that reference. Reference volume is fixed
near the default steady-slide level, not normalized dynamically to every input.
The existing audition trims remain available. Equal RMS does not guarantee
equal perceived loudness.

## Representation and control

This pass keeps the accepted reconstruction's representation instead of
immediately replacing it with a few generic oscillators. The local preparation
script reuses the unchanged accepted analysis: independently tracked partials
and a spectrally concentrated residual. It exports 376 character frames, 18
reusable partial slots and 428 residual-magnitude bins. The source recording's
overall level envelope is removed with per-frame expected-power normalization;
the live controls supply intensity.

The worklet renders continuous oscillator phases with changing partial frequency
and strength. Track births/deaths cross low amplitude, with short smoothing of
frequency and strength. Fresh seeded noise is shaped by the current residual
spectrum using 2048-point transforms and square-root Hann overlap/add. It does
not play a PCM loop or reuse original residual phases. Residual density is scaled
for the actual sample rate and pitch so changing sample rate does not simply
change its integrated energy. The old engine worklet is unchanged.

The character position selects a region of this local spectral model. It is
controlled by event state and recent excitation, not a one-shot playback clock:

| Information | Live behavior |
| --- | --- |
| Grounded, load and speed/relative sliding | Contact eligibility; loss of contact uses a fast release. |
| Existing normalized slip and warning controls | Bounded excitation, with hysteresis at entry/exit. |
| Load | Square-root intensity contribution, separate from spectral character. |
| Entering a slide | Character moves from the early region toward the sustaining region. |
| Continuing slide | Recent excitation and bounded slow irregular movement select changing character; new texture continues indefinitely. |
| Falling excitation/recovery | Character moves toward the later region while level falls. The same slip value can therefore sound different on entry and recovery. |

Recovery compares current excitation with a smoothed recent value. It does not
depend on the size of a single control message, so continuous block-rate inputs
and 25 ms playground updates both detect a falling ramp. These are authored
audio states; they do not claim to estimate tread temperature or identify the
physical manoeuvre in the supplied recording.

The six tyre controls are lower/higher character, texture balance, pitch
character, character movement, level attack and level release. Their defaults
are the first hearing candidate. The accepted engine controls/settings, routing,
surface output and existing manual-input ranges remain available.

## Presets and local preparation

**Pre-release update:** the accepted parameter model is now committed at
`public/audio/tyre-control-v1.json`. Normal builds need no local preparation. The
[cleanup notes](audio-recording-cleanup.md) supersede the local-only distribution
boundary below; source and comparison WAVs remain excluded and their player was removed.

`pulse-exhaust-reference-v3` presets identify the local model in `assetIds` and
have their own tuning keys. Import rejects an absent or different model ID.
The two earlier backends keep their exact source and tuning meanings, including
their saved version-one preset format. Named buttons load the new starting
point, the second tonal prototype or the first noise prototype. The storage key
and save/duplicate/revert/JSON workflows remain the existing ones.

The model is reference-specific local research data. It contains trajectories
and spectral magnitudes, with no PCM or residual phase. It remains in ignored
`artifacts/tyre-reference/control-model.json`, alongside the separate local
reference-audition files. The development-only fixed-file route serves this
additional JSON filename. Neither the model nor reference-derived WAVs enter
`public/`, commits or production build assets. A later general-purpose/released
voice still needs its own authored or appropriately reusable source profile.

Prepare the local model from the repository root, with the Python numerical
libraries used by the earlier analysis:

```powershell
python scripts/prepare-tyre-control.py --reference "C:/Users/user/Documents/good screech (real recording).wav"
```

For a fresh checkout, prepare the earlier accepted reference audition as described
in [its notes](tyre-reference-audition.md#local-files-and-reproduction) to use the
two-second comparison button. Original source WAVs are read without modification.
The [model record](tyre-control-model.json) retains source, analysis/export script
and model hashes. The local model is about 1.85 MB; no embedded parameter copy is
hidden in a preset or source file.

## Targeted validation

Fifteen focused tests pass across the changed/new worklet, fixtures/presets,
fixed-file service and preserved tonal processor. They cover finite bounded
44.1/48 kHz output beyond the reference phrase, fresh continuing texture, prompt
contact release, deterministic reset, invalid model rejection, history-dependent
character, recovery under two update rates, all three preset versions and model
identity. Strict TypeScript checking and the production build also pass.

The [actual-model host render record](controlled-tyre-renders.json) covers the
7-second slide and 10.5-second cycle at both sample rates, using the exact
worklet and actual playground fixtures. Late slide/re-entry RMS remains around
0.04–0.05, with peaks below 0.24. Recovery begins during the falling ramp, around
4.26 seconds, and repeats after the second slide. The short clips are kept in
ignored `artifacts/controlled-tyre/`. Reproduce with:

```powershell
node --experimental-strip-types scripts/render-controlled-tyre.mjs
```

The record's timing measures host JavaScript calls, not browser rendering,
hardware latency or a four-wheel performance qualification. It is not a sound
quality score. Native browser checks show the model loading, active B output,
the short cycle completing, manual slip/load changes entering recovery, zero
load becoming quiet, reference/live mutual exclusion and Stop. The user's next
listen decides whether this live version retains the accepted character.

At this prototype's delivery, production driving audio, the collector, physics
and existing channel/runtime qualification were unchanged. No full regression
suite, driving campaign, channel-recognition study or endurance run was repeated.
The owner's subsequent acceptance now leads to the separate
[driving integration](reference-audio-integration.md). The render record above
remains evidence for the original prototype source hash.
