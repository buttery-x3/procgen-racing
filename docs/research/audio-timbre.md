# Driving audio: sound quality and a tuning workflow

26 October 2026. Research and proposal; no new sound engine or playground is
implemented in this pass. Audited foundation: `development` at `c7d31fc`, including
the Vivaldi loop fix. This document supersedes the timbre and iteration plan in
[the original audio proposal](audio-system.md). Its infrastructure remains useful.

## Decision

Keep the current implementation as the working channel, control and lifecycle
foundation and as an A/B reference. The user's listening feedback rejects its
engine and tyre character: the engine is thin and insect-like, while the tyres
resemble whistling. Passing signal tests did not demonstrate the intended sound.
Clear handling cues still matter, but they need a credible engine/tyre texture.

The next implementation should be a small **sound-design playground**, with one
engine and one tyre candidate before expanding the range of cars. Build a
combustion-pulse/exhaust-resonance engine and a rough, multi-component tyre voice.
Judge short examples on the user's headphones before production integration.
Keep a recording-assisted option available if those candidates do not convince.
More sliders around the current oscillator mix alone would be insufficient.

This is a recommendation for the next piece of work, not approval inferred for
building every alternative, training a model, buying assets or importing an audio
middleware. The research and documentation change leaves production audio intact.

## What the existing code explains

| Inspected code | Current behavior | Implication for the listening report |
| --- | --- | --- |
| `src/audio/EngineVoice.ts`, `wave()` | 48 harmonics, amplitudes falling as `1 / harmonic^1.13` under load; a steeper version for the body. Both oscillators run at the firing rate. | The loaded spectrum is close to the `1 / harmonic` series of a sawtooth. The user's description is consistent with the implementation, although it uses `PeriodicWave`, not a literal sawtooth node. |
| Engine filters/modulation | Low-pass cutoffs rise with firing rate/load; seeded phase offsets are fixed; a roughly 6–7 Hz oscillator modulates detune. Noise is mostly a separate continuous layer. | Little independent exhaust character; regular wobble can read as an insect. Seeded harmonic phases do not create fresh cycle-to-cycle combustion variation. |
| `src/audio/TyreVoice.ts` | One strong fundamental plus much quieter harmonics; at default axle cue, front/rear fundamentals are about 1,790/1,030 Hz. Slip changes pitch by at most 2.5%. | A sustained narrow tone remains prominent as activity increases, consistent with whistling. Adding broadband noise does not automatically turn that tone into a screech. |
| Tyre modulation | A fixed triangle oscillator supplies amplitude/detune modulation; each axle shares its main tonal region. | Regular modulation and simultaneous similar notes can sound synthetic or chorused. |
| `AudioControls.ts` | Already uses resolved wheel radius, contact/load, combined-slip demand, relative sliding speed and a force-times-slip proxy. Collector retains brief 120 Hz events. | There is useful control information already. The first timbre experiment need not rebuild physics or the collector. |

These are code-based explanations consistent with the user's listening, not a
new independent listening verdict. The central omission in the earlier workflow
was early acceptance of the sound itself. Automated channel balance, finite
samples and spectral differences cannot supply that acceptance.

## What generates an engine's character

Combustion and gas exchange excite pressure pulses; intake/exhaust passages and
mechanical structures shape what reaches the listener. A physically informed
engine model can represent cylinders and connected passages with delay-based
resonators, rather than simulating all engine thermodynamics. Baldan et al.'s
2015 work uses interacting waveguides and cycle-dependent excitation/valves.
This is evidence for a richer procedural approach, not a guarantee of our result.
[Baldan et al., original paper](https://air.iuav.it/retrieve/de164c2a-5461-60ee-e053-3a05fe0a7787/SIVE15_submission_4.pdf)
(indexed paper excerpts consulted; direct retrieval returned 403).

The newer Pulse-Train-Resonator work explicitly separates firing pulses, noise
and exhaust resonators, with RPM/torque conditioning. It also exposes audio
comparisons. Its learned model and reported reconstruction metrics are not
evidence that a hand-tuned browser implementation will meet this user's target;
the preprint's evaluation uses procedural dataset subsets. We should borrow the
source/resonator design principle, not assume a need for neural training.
[Doerfler and Wyse, 2026](https://arxiv.org/html/2603.09391v1),
[author's comparison page](https://rdoerfler.github.io/ptr-model-page/).

For our four-stroke sound model, cycle rate is `RPM / 120`; an evenly firing
N-cylinder engine has average firing rate `RPM * N / 120`. Thus a four-cylinder
at 900 RPM fires at 30 Hz, rising to 200 Hz at 6,000 RPM. Those rates already exist
in the current code. They explain pitch, not the whole sound. Cylinder/bank timing,
pulse shape and the transfer path must also change its character. A periodic
signal can be represented by harmonics: additive synthesis is not intrinsically
incapable of realism. Our generic harmonic coefficients and operating-state
variation are the limitation.

### Proposed engine candidate

Use a small sound model with a continuous crank phase and an explicit firing
pattern. Produce band-limited asymmetric pressure pulses with bounded, seeded
cycle variation in amplitude and shape. Keep nominal firing order and timing
coherent; randomness must not turn a healthy engine into misfires. Model the
720-degree cycle, not just N interchangeable oscillators at the same frequency.

Feed the pulses through a few damped exhaust resonances or short waveguides.
Give manifold/bank and common exhaust paths distinct contributions. Keep the
resonance structure primarily tied to the authored exhaust profile rather than
moving every filter in direct proportion to RPM. Expose body, damping/muffling
and rasp independently. Intake breath and mechanical texture should be separate,
restrained layers; stronger gas flow can excite noise with the pulses. These are
our proposed approximations, not measurements of a real generated car.

Acoustically, a pulse takes time to travel down an exhaust and reflects at changes
in the path; returning waves reinforce some frequencies and weaken others.
Losses damp that ringing. This is why a delay/resonance stage can supply an
exhaust character that a brighter oscillator alone misses. In the proposed
controls, effective path length changes resonance spacing, damping changes how
long it rings, and muffling changes the high-frequency balance. A few authored
paths approximate this behavior; they are not a prediction for an actual exhaust
geometry. The exhaust-resonance model in the
[PTR paper](https://arxiv.org/html/2603.09391v1#S4) illustrates this principle.

At the same RPM, idle/light load, acceleration and overrun need different pulse
strength, noise and spectral balance. Continue to use actual RPM, effective load,
drive load and shift state. Do not invent a pitch drop for every shift or equate
negative net torque with proven fuel cutoff; this game's powertrain does not
expose combustion/fuel-injection state. Leave exhaust pops out of the first
candidate unless a chosen reference calls for them.

Use restrained low/mid-frequency body with audible harmonics, rather than adding
only sub-bass that small headphones may barely reproduce. Compare an inline-four
and a deeper banked-engine preset after one convincing base voice exists. The
profile's cylinders/exhaust are sound-design attributes, not newly simulated
vehicle mechanics. Avoid random per-car sound variations until presets are liked.

Implementation should retain the existing output bus. A compact `AudioWorklet`
is a reasonable option for sample-accurate phase, pulse shaping and fractional
delay feedback; it supplies custom processing on the Web Audio rendering thread.
That capability does not itself improve timbre. Native-node resonators or
precomputed band-limited pulse tables remain valid for the first comparison.
[MDN AudioWorklet](https://developer.mozilla.org/en-US/docs/Web/API/AudioWorklet).

Any custom DSP needs bounded/stable feedback, DC removal, smooth parameter
changes, alias control and a defined reset/dispose path. Test those changed
boundaries once with short renders, including the deployed browser. Preserve
the existing exact-frame noise-loop fix. A new worklet introduces a new loading
and failure boundary; acknowledge that focused check without reopening the
entire audio or vehicle qualification campaign.

## Why tyres squeal, and what slip should control

Senda et al. measured squeal associated with self-excited tread vibration during
sliding. Their particular experiments found onset around 1.1–1.7 m/s and linked
frequency to tread properties. That does not prescribe a universal threshold
or require all four wheels to slide in our game.
[Tire Squeal, 1984](https://www.jstage.jst.go.jp/article/jsme1958/27/231/27_231_2016/_article/-char/en).

Sakai's different experiments reported roughly 0.8–1.0 m/s lateral slip onset
and sensitivity of onset conditions to load, speed, temperature, pressure and
tread state. The differing results are a reason to author and listen to our
mapping rather than import a single number as a law.
[Study on the Squeal Noise of Tires, 1994](https://www.jstage.jst.go.jp/browse/gomu/67/2/_contents/-char/en)
(publisher's English abstract).

Real squeal can contain strong tones. The goal is not to remove tonality or
replace everything with louder white noise. Our proposed perceptual model is
friction excitation plus several interacting/competing tonal components, with
irregular roughness, changing spectral balance and a scraping bed. This is a
sound-design approximation of friction vibration, not a validated microscopic
rubber or contact-patch solver.

### Separate onset from texture

Keep these distinct inputs available to the voice and playground:

| Input | Role |
| --- | --- |
| Grounded state and normal load | Contact eligibility and a bounded intensity contribution; fast silence on contact loss. |
| Combined-slip demand `q` | Where the wheel lies relative to this tyre model's peak; useful for the deliberately early warning. |
| Longitudinal/lateral relative motion | Whether there is meaningful sliding and whether it is wheelspin, locking or lateral scrub. |
| Force-times-slip proxy | An intensity/excitation estimate; not measured acoustic power or rubber heat. |
| Surface mix | Asphalt squeal versus loose-surface scrape/rolling texture. |
| ABS/TC and changing slip | Preserve genuine modulation/transients; do not add a generic alarm whenever an assist flag is true. |

The existing calculations provide a good start:

```text
u_long = resolvedWheelRadius * wheelAngularSpeed - longitudinalContactSpeed
u_lat  = lateralContactSpeed                  # magnitude/sign convention as needed
slidingSpeed = hypot(u_long, u_lat)
kappa = u_long / max(abs(longitudinalContactSpeed), abs(R * omega), 1.5)
q = hypot(kappa / longitudinalPeak, tan(slipAngle) / tan(lateralPeak))
powerProxy = abs(longitudinalForce * u_long) + abs(lateralForce * u_lat)
```

`q = 1` is the peak of our combined-slip force curve, not a universal real-world
squeal boundary. `powerProxy` contains force/load already; avoid multiplying
load into it again. Reported forces include other effects and the low-speed
regularization is a numerical convention. Preserve wheel-relative motion so a
stationary burnout sounds, while a held stationary car stays quiet.

First change the voice while replaying identical current `AudioControlFrame`
inputs. That distinguishes a bad source sound from a bad onset mapping. Then,
only if listening shows a need, expose existing intermediate relative-motion or
power values as optional controls and revise the adapter. Do not repair or change
tyre physics in that audio commit.

For the revised mapping, keep the early warning as a quieter scrub. Bring the
sustained screech in with sliding activity, using a gradual onset and hysteresis
to prevent threshold chatter. Increase roughness/energy and vary mode balance
with sliding severity; do not turn slip ratio into a linear pitch knob. Keep a
bounded sliding-speed contribution after peak grip, where force can fall.

Start with three to five tonal/modal components plus shaped, time-varying friction
noise. Allow uneven excitation and limited mode dominance changes; avoid a set of
equally loud musical notes or periodic vibrato. Try a more friction-like nonlinear
exciter only if the simpler candidate still whistles. These component counts are
prototype choices to compare, not values asserted by the tyre papers.

Keep tyre identity tied mainly to the tyre/profile. Front/rear cue strength should
apply modest differences in brightness, roughness or mode balance after a useful
base texture exists. Avoid making the axle cue two conspicuous musical pitches.
Solo one wheel first, then hear simultaneous wheels and the engine mix for masking.

The 120 Hz physics loop supplies slowly varying contact/slip controls. It cannot
resolve kilohertz tread vibration. Generate the acoustic texture at audio rate
and smoothly interpolate controls; do not trigger one audible click per physics
step or try to extract microscopic stick/slip directly from 120 Hz force changes.
Retain the collector and its latest-contact precedence; changing its peak capture
would be separate work justified by a demonstrated envelope problem.

## Alternatives worth comparing

| Approach | Benefit | Main cost or risk | Recommendation |
| --- | --- | --- | --- |
| Retune existing harmonic/noise voices | Small patch; working baseline | Still little variation in pulse/exhaust or tyre structure | Retain for A/B, not the only candidate. |
| Pulse/resonator engine plus textured procedural tyres | Small assets, continuous controls, editable character | Needs sound design; realism is not guaranteed | First candidate, proving one engine and one tyre. |
| Recorded RPM/load loops | Preserves a real source's texture | Clean loop preparation, pitch/crossfade matching, asset rights | Practical fallback; start with one coherent sound family. |
| Cycle-aware granular engine playback | Uses recorded acceleration/deceleration detail over changing RPM | Cycle analysis, transitions and clean recordings require more authoring | Consider after a listening comparison justifies it. |
| Hybrid | Procedural controls/body with recorded engine or tyre texture | More mix/preset and asset work | Preferred fallback if one procedural source remains unconvincing. |
| Full gas-flow/contact simulation or trained neural model | More modeling freedom | Much larger implementation/data/validation scope | Defer; not needed to answer the current listening problem. |

Recording-based engine synthesis is a substantive alternative, not a failure of
the control architecture. Crankcase's REV describes analysis and granular
processing of recorded accelerations; its authoring simulator is also a useful
workflow reference. This does not establish a drop-in browser integration or
authorize adopting its runtime.
[REV developer description](https://www.crankcaseaudio.com/),
[developer repository](https://github.com/CrankcaseAudio/CrankcaseAudioREVUnity/blob/master/README.md).

The Wreckfest engine-audio guide illustrates auditioning on/off-load layers
separately and correcting pitch alignment between adjacent loops. Those are
useful authoring lessons even if our runtime stays procedural.
[Wreckfest guide](https://www.audiokinetic.com/media/blog/LoopBasedCarEngineDesign/vehicle_audio_modding_guide_for_wreckfest-Wwise2019_2_9.pdf)
(indexed guide excerpts consulted; direct retrieval returned 403).

For a recording-assisted experiment, prefer dry, isolated, reusable material:
engine idle plus several RPM/load regions, or clean tyre scrub/sustained skid
without a dominant engine/pass-by. A moving microphone's Doppler and baked-in
room/camera perspective are poor ingredients for a reusable per-wheel source.
Use source recordings only with appropriate reuse rights; research demonstration
audio is a listening reference, not automatically a distributable game asset.
No recordings, external DSP or pretrained weights were imported in this pass.

## Playground proposal: listening first

Make a proposed `/audio-playground.html` alongside the existing diagnostic pages.
The existing Audio lab serves qualification; the playground's primary actions
should be **Play**, **Compare A/B**, and **Save preset**. Do not make a large
benchmark dashboard or a mandatory listening exam part of tuning.

### First useful version

1. Start with the existing voice as A and one candidate as B. Use the same inputs,
   playback time and seed. Switch with a short click-free fade; replay both from
   the same point when source state makes live switching unfair.
2. Supply short, selectable listening clips: engine idle, steady RPM at light/full
   load, a rev/load sweep and a shift; tyre scrub, onset, sustained slide and
   recovery. Each is about 5–15 seconds and loops only when the user chooses.
3. Offer a few perceptual controls first. Engine: body, exhaust openness/muffling,
   rasp, pulse unevenness and intake/mechanical balance. Tyre: scrape/screech
   balance, roughness, brightness, onset and release. Technical modal frequencies,
   delay lengths and shaping curves belong in an advanced panel.
4. Solo engine, tyre or surface. Start with a dry/mono source audition, then pass
   it through the existing headphone/stereo/mono routing and mix. Source selection
   must not create a second production audio context or rewrite spatialization.
5. Compare at approximately matched perceived loudness. Use measured level plus
   adjustable audition trim and peak headroom; equal RMS alone does not imply
   equal loudness for different spectra. Freeze each candidate's trim while
   auditioning its load/slip dynamics so normalization does not erase them.
6. Save named, versioned preset JSON, duplicate/revert it, and export/import it.
   Include backend/version, parameter curves, seed, asset IDs where applicable,
   audition trim and fixture ID. Keep audition trim separate from production
   master gain. Do not persist live tuning as the user's default game settings
   without an explicit Apply action.

Use manual RPM/load and slip/load controls for exploration, plus replayable
fixtures for fair comparisons. Synthetic fixtures must be labeled as such. Add
short captured control streams from the real collector for final listening in
context; the existing diagnostic summary is not a full audio-control recording.
Record simulation timestamps and car/setup identity. Replay through the same
voice update interface, with audio-clock scheduling rather than dependence on
the monitor's frame rate. Save an optional short WAV for comparison; producing
it is an audition artifact, not a qualification result.

Keep the original voice available until a replacement is selected. Initially
swap only `EngineVoice`/`TyreVoice` behind their current output buses. Reuse the
mixer, spatial routes, activation/mute, pause/watchdog and disposal owners.
Additional source parameters belong to versioned sound presets, separate from
vehicle setup and session compatibility. Avoid introducing unrelated UI/framework
dependencies or a new vehicle configuration schema for this prototype.

### Listening decisions and stop points

| Step | Decision needed before expanding work |
| --- | --- |
| One dry engine, one dry tyre | Do these sound recognizably closer to the requested rumble/screech at matched level? |
| Controls and transitions | Can load/slip change strength and texture without insect buzz, whistle, clicks or abrupt switching? |
| Existing mix and wheel routes | Are tyre cues still usable with the engine present, without making them piercing? |
| Short real driving replay | Do onset, shift, stop and recovery fit what the vehicle is doing? |
| Accepted preset | Integrate that preset/model, then broaden profiles only when wanted. |

Record the preferred candidate/preset and the user's words, not an invented
realism score. If the first procedural candidate still misses after a focused
revision, compare a recording-assisted candidate before adding more synthesis
complexity. Each review should present a small pair of meaningful alternatives;
the user should not have to become the sound designer to rescue a poor default.
No mandatory 15/20-minute run or repeat 32-trial channel study accompanies a
preset choice. Longer comfort studies remain optional, separately requested work.

## Validation and preserved evidence

Follow [the revised repository policy](../workflow.md#validation-scope--revised-26-october-2026):
targeted checks for each commit, full regression and production build before
merging into `main`. Sound quality requires listening; numeric checks constrain
implementation failures, not aesthetic acceptance.

For a new voice, use short renders of the changed DSP at the supported sample
rates to check finite samples, headroom, alias/stability concerns and transitions.
Cover the actual loop boundary when buffered loops change. For parameter-only
edits, use the affected cases and a listening comparison, not every historical
audio case. New worklet/asset lifecycle code merits its own focused loading,
stop/reset and failure checks. Changed slip mapping merits control tests for
rolling, near peak, sliding, held stop, stationary wheelspin and contact loss.

Keep the working baseline `c7d31fc` and its reports:
[original feature qualification](audio-qualification.json),
[loop regression](audio-loop-regression.json), and
[actual-app driving](audio-driving-qualification.json).
Those records retain their original hashes and measured scopes. They support
the infrastructure concept, not a claim of convincing timbre or proven human
front/rear recognition. A new voice does not invalidate unchanged routing code,
but may need a short mix/masking listen at its new spectral balance.

Do not rerun the entire channel/lifecycle campaign to refresh a broad fingerprint
after a preset, page or report edit. Store any new targeted results with their
own source/fixture scope; do not rewrite old hashes or claim unrun stages passed.
The complete report publisher can remain strict and be used when a new complete
qualification is actually wanted. The 20-minute audio endurance test is excluded
from required checks and runs only on explicit request.

This research commit changes documentation only. Validation is document review,
local-link checks and diff hygiene; no audio tests, full suite, build, browser
driving sequence or endurance run is needed or claimed.
