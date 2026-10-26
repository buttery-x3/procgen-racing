# procgen-racing

**Baseline release: [v0.2.0](docs/releases/v0.2.0.md), M0–M8.** `main` is the
released baseline; `development` is the remote testing branch. Every future
milestone must be implemented on its own branch from `development`, then merged
and pushed to `development` on completion for testing. Promote to `main` only
when a release is explicitly requested. See the [branch workflow](docs/workflow.md)
and [agent instructions](AGENTS.md).

A browser racing sandbox built with TypeScript, Three.js and Rapier. The current
**v0.2.0 release** completes solo practice/time trials, lap rules, compatible
ghosts and a circuit library around the procedural cars, circuits and tuning lab.
The earlier [v0.1.0 baseline](docs/releases/v0.1.0.md) remains tagged separately.

**M8** adds directional 3D timing gates, three sectors, track limits, keyed personal
bests, non-colliding pose ghosts and durable session import/export. The circuit
library keeps named/favourite accepted routes and variants. Engine/tyre/impact
audio, bounded skid/dust/smoke effects, a bonnet camera and quality controls complete
the solo presentation. The release includes the reduced tyre-squeal and rubber-mark
sensitivity, preserving full-slip intensity. See the [M8 guide](docs/m8.md) and
[release/upgrade notes](docs/releases/v0.2.0.md).

**M7** adds fixed road networks with route alternatives/provenance, dedicated
progressive oval banking and aprons, full/club/speedway variants, family-specific
facilities and locally streamed collision/rendering. The circuit workshop includes
lane cross-sections, stock-car high/low reference lines and accepted-definition
JSON import/restore. A named desktop benchmark and uncurated 35-seed portfolio
accompany the generation and full-lap checks. See the [M7 guide](docs/m7.md).

**M6** supplies 11 seeded car families, FF/FR/MR/RR/AWD packaging, component-derived
COM/inertia and matching sectioned body geometry. Car workshop previews validate
construction and actual physical response. Garage / Compare saves complete setups
and runs repeatable A/B tests; the 120 Hz recorder freezes/scrubs recorded responses.
Linked axle/per-wheel controls, undo/redo, JSON import/export and remappable inputs
complete the workbench. See the [M6 guide and qualification](docs/m6.md).

**M5** supplies semantic kerbs, fitted run-offs and escape guides, continuous
barriers, pit/service lanes, garage blocks, stands and independent seeded scenery.
The driving map's left/right orientation is corrected and it now shows heading.
See the [M5 implementation and qualification](docs/m5.md).

**M4 v2** replaces radial generation with signed section sequences and independently
placed straights, terrain-guided route selection, fitted elevation and arbitrary
folded terrain corridors. It is available in **Circuit workshop**, with same-land
route alternatives, reference lines and design diagnostics. See the
[v2 implementation notes](docs/m4-v2.md), [approved M4/M7 plan](docs/m4-revised-plan.md)
and [circuit research](docs/research/circuit-design.md). V1 recipes and the original
research experiment remain available separately.

## Run locally

Requires Node.js 22.12 or newer (verified with Node 24).

```sh
npm install
npm run dev
```

Open the local address printed by Vite, normally <http://127.0.0.1:5173>.

For development commits, choose checks relevant to the changed behavior; the
full regression suite is required before merging into `main`. These commands
are available tools, not a checklist to repeat for every feature. See the
[validation policy](docs/workflow.md#validation-scope--revised-26-october-2026).

```sh
npm test -- --maxWorkers=2 # Full regression: required before promotion to main
npm run build    # Type checking and production build
npm run preview  # Serve the production build locally
npm run study:report # Reproduce the 24-case design study and comparison SVG
npm run qualify:m4 -- --count=1000 --workers=6 --compile=all
npm run qualify:m4:driving # Full laps on qualified tight/steep/high-relief cases
npm run report:m4         # Rebuild the 32-distinct-seed portfolio and summary
npm run qualify:m5 -- --count=128 --workers=4
npm run report:m5
npm run qualify:m6 -- --count=1000 --driving
npm run qualify:m7 -- --count=1000 --construction=32
npm run qualify:m7:driving
npm run report:m7 # Publish matching generation, driving and browser evidence
npm run qualify:m8 # Real timed laps and ghost round trips
npm run qualify:m8:stress
npm run report:m8
```

## Available now

- **Solo sessions:** practice and time trials, interpolated directional timing,
  sectors/deltas, explicit tyre-centre track limits, pit/wrong-way warnings and
  setup/version-specific bests. Compatible 20 Hz pose ghosts support visibility,
  opacity and JSON import/export without changing local personal bests.
- **Circuit library:** name, favourite, search, rename, revalidate/load, import and
  export accepted circuits/variants. Removal is recoverable from Trash. The old
  M7 last-saved circuit can be added to the library.
- **Car workshop:** hatch, coupe, sedan, mid-engine sport, road hypercar,
  rear-engine coupe, AWD sport, GT, endurance prototype, formula and stock-car
  archetypes. Seed streams/locks, editable dimensions/body sections, packaging
  overlays and physical acceptance checks precede applying a car. Paint/trim
  edits preserve the working tune and do not reset an unchanged physical rig.
- **Full tuning/comparison workbench:** basic/all-settings modes, linked axle
  edits, per-wheel spring/damper/ride overrides, field resets/change indicators,
  staged chassis drafts and undo/redo. A named garage supports duplicate/rename,
  full car/setup JSON import/export and isolated matched A/B launch/brake,
  steering and drop tests. Live 120 Hz recordings can be frozen, scrubbed,
  saved, overlaid and exported. Input settings include key/gamepad remapping,
  steering response curves and a live gamepad meter.
- **Venue construction:** club, traditional, modern and desert themes; 35/75 mm
  tapered kerbs, variable run-off, escape fans and speed guides, welded barriers,
  paved pit merges/service access and garage colliders. Primitive stands, marshal
  posts, braking boards, fences, trees and bushes use culled instance batches.
  Scenery density/seed is independent of the driving geometry. Optional surface
  sound follows wheel contacts. Pit, apex-kerb and loose-run-off starts aid testing.
- **Circuit workshop:** seed, touring/GP style, gentle/rolling terrain, mixed/flowing/
  technical rhythm, route alternatives and lap length. Compare road/natural elevation,
  reference speed/line, grade, bank, width, curvature, cut/fill and facility/corridor
  overlays before loading. Inspect, download or copy a versioned recipe, final
  definition and report.
- Touring loops from 2.0–4.5 km and GP loops from 4.0–7.5 km, with a level grid and
  reserved paddock footprint, technical complexes, changing-radius bends, gradual
  width changes, beneficial corner banking, kerbs and mixed run-offs. Seeded terrain
  is graded into the road, including deeply folded infields; primitive trees sit
  on its compiled geometry. Conservative and optional terrain-challenge envelopes
  validate tyre-path loading instead of flattening the whole lap.
- Generation runs in a cancellable worker. Unsafe candidates produce reproducible
  reasons; bounded retries use an explicitly reported conservative family fallback.
  Preview changes leave the driving circuit in place. Loading retains vehicle tuning
  and releases the previous circuit's meshes and colliders.
- A shared 3D surface compiler for rendering and collision, with continuous
  elevation/banking/width profiles, raised red/white kerbs and per-contact materials.
- A 662 m closed proving circuit with a 7.4 m elevation range, banked summit,
  compound descent, narrow esses, return crests and variable 9.5–15 m road width.
- Asphalt, kerbs, tarmac run-off, grass, gravel and sand with distinct colours,
  grip and rolling resistance. Seven test starts include one-sided kerb and
  asphalt/gravel contact tests. A circuit map, elevation trace and road metrics
  make the 3D geometry inspectable; Circuit overview shows the whole venue.
- A free chassis supported by four independent ray contacts, with spring/damper
  suspension, bump stops, anti-roll coupling, pitch, roll and wheel unloading.
- Independent wheel angular dynamics, signed longitudinal slip, lateral slip,
  load-sensitive grip and a shared acceleration/braking/cornering force budget.
- A torque-curve engine, launch clutch, six forward gears, reverse and neutral;
  automatic or sequential manual shifting and selectable gear spacing/final drive.
- Open, limited-slip and locked axle differentials; AWD torque split and centre
  coupling; front/rear brake balance, individual-wheel ABS and a rear handbrake.
- Adjustable traction control, yaw stability, countersteer, speed-sensitive steering
  and stationary brake hold. Intervention indicators show when assists are working.
- FF compact, FR coupe, MR sport and AWD sedan reference cars with different
  proportions, mass distribution, suspension, torque and drivetrain settings.
- An open driving apron and split-grip lane, plus M1's level, single-wheel bump,
  incline and bank surfaces; repeatable drop tests and pitch/roll impulses.
- Live front/side/top diagrams with loads, travel and contact/slip state, a per-wheel
  slip/angle/RPM table, engine/gear HUD and expandable response traces.
- Five workbench tabs, assist bundles and versioned browser-local persistence.
  M1/M2 saves migrate to M6; older saved keys are preserved. The garage holds 24
  setups; recent recordings retain up to six runs within 2 MB. Export JSON to archive.
- Simple blocky geometry, primitive scenery, orbit/chase/top cameras, force
  visualization and interpolated 120 Hz physics. Chase follows behind the heading.

Mass, balance and chassis dimension edits use **Apply chassis changes** to rebuild
and reset the rig. Other tuning takes effect live. Selecting a reference car resets
to that car; **Reset setup** restores its baseline. Suspension presets only change
suspension settings, preserving the chosen drivetrain.

## Controls

| Action           | Keyboard / mouse                            | Standard gamepad               |
| ---------------- | ------------------------------------------- | ------------------------------ |
| Throttle / brake | W / S or up / down                          | Right / left trigger           |
| Steer            | A / D or left / right                       | Left stick                     |
| Reverse / drive  | V toggles R/D; HUD buttons include N        | D-pad down / up                |
| Shift down / up  | Q / E                                       | Left / right shoulder          |
| Rear handbrake   | Shift                                       | Bottom face button (A / Cross) |
| Reset vehicle    | R                                           | Top face button (Y / Triangle) |
| Pause / resume   | Space                                       | Start / Menu                   |
| Cycle camera     | C                                           | Left face button (X / Square)  |
| Orbit / zoom     | Drag / scroll in Orbit view                 | Use the camera buttons         |
| Undo / redo tune | Ctrl/Cmd+Z / Shift+Ctrl/Cmd+Z or Ctrl/Cmd+Y | Use inspector buttons          |

These are the defaults. **Input settings** provides rebinding, dead zone and curve
controls. Standard gamepad D-pad/A/B navigation operates dialogs and common controls;
physical gamepad hardware remains to be verified.

Stop before changing driving direction. **W / right trigger accelerates in the
selected direction**, including reverse; S / left trigger always brakes. Automatic
transmission shifts forward gears; reverse and neutral are explicitly selected.

Typing in a tuning field suppresses driving input. Brake hold works near rest,
within the available tyre grip, and can be disabled in Assists. Visibility loss
pauses the simulation; use Resume to continue.

## Fidelity and verification

This is a semi-arcade model with physical contact forces and torques, simplified
combined-slip tyres and a simplified powertrain. It does not replace the chassis
velocity to create traction. Unsprung bodies, tyre temperature/wear, detailed
suspension linkages, authentic manufacturer data and engine stalling are outside
this build. Physical gamepad hardware has not yet been verified. M7 adds a named
1920×1080 desktop browser benchmark with explicit renderer and measurement scope.

The automated suite covers settled suspension, weight transfer, airborne behaviour,
steering direction, centred chase geometry, all four drivetrains, reverse/neutral,
automatic shifts, split grip, differential locking/conservation, braking, assists,
and saved setup validation/migration. Browser checks exercise the actual workbench,
controls, cameras and persistence. Surface checks cover closure, mesh winding,
render/collision agreement, chunk joins, independent materials, bank/grade holds,
all four cars completing a full circuit lap, and kerb traversal at 8 and 20 m/s.
Generation checks add recipe determinism, style/length/terrain bounds, unsafe-seed
rejection/fallbacks, worker cancellation, buffer transfer, collider/resource lifetime
and FF/FR/MR/AWD laps on generated circuits. Nine additional design-study checks
cover analytical closure, crossings, folded layouts, reproducibility and explicit
preview limits. The suite now also checks production v2 terrain seams, reference
lines, profile continuity, technical rhythm and FF/FR/MR/AWD laps. M5 adds map
handedness, construction continuity, barrier impacts, material footprints, soil
drag, pit merges, kerb profiles and resource tests. M6 adds generated geometry,
mass/inertia and all-family physics checks, storage/history, inputs, traces and
repeatable comparisons. M7 adds network/variant provenance, progressive-bank/apron
contact, long-venue localization, bounded collision/GPU residency and durable
circuit archives. M8 adds timing/rules/ghost compatibility, durable circuit-library
schemas, camera clearance and contact feedback: **237 tests** currently pass.

M7's [named desktop benchmark](docs/research/m7-desktop-benchmark.json) measured
about 100 fps at 1920×1080 on street, oval and 24 km endurance samples, with
10.1 ms p95 frame intervals on the Ryzen 5 5600X / RTX 3060 desktop. Those are
short foreground samples capped near 100 Hz; full laps are checked separately.

The [M7 campaign](docs/research/m7-qualification.json) passed **7,000 planning
checks and 224 complete constructions**, with zero failures or seed substitutions.
All **31 full-lap driving checks** passed, including FF/FR/MR/AWD on every family
and three stock-car oval lanes. See the [measurement scope](docs/m7.md).

The [M8 campaign](docs/research/m8-qualification.json) passed **25 timed physical
laps and ghost round trips** across all seven expanded circuit families and all
eleven procedural car archetypes. The [browser checks](docs/research/m8-browser-qa.json)
include a valid 61.198 s production-app lap, saved records, ghost compatibility and
the library. The M8 renderer/session samples delivered about **100 fps at 1080p**
on the named desktop; see the [measurement scope](docs/m8.md).

The [M6 campaign](docs/research/m6-qualification.json) qualifies **11,000/11,000 cars**,
33 physical acceptance cases and 22 complete dressed touring/GP laps, with zero
failures. Lap checks use conservative reference speeds; these are compatibility
tests, not racing-pace certification. See the [M6 measurement scope](docs/m6.md).

The M5 sweep compiled **128/128 venues** across its four themes, with no construction
failures or M4 fallbacks. See the [full M5 report](docs/research/m5-qualification.json).
Twelve serial browser previews, including M5 construction and transfer, took
0.94–3.61 seconds (1.97 s median) on the development desktop; see the
[browser measurements](docs/research/m5-browser-budget.json).

The revised M4 qualification compiled **4,000/4,000 native circuits**, with no
fallbacks or failures (1,000 attempted seeds per preset). Six additional full laps
on the tightest, steepest and highest-relief cases passed. Twelve serial browser
worker previews took 0.75–2.88 seconds on the development Ryzen 5 5600X desktop.
See the [qualification and limits](docs/m4-v2.md#delivered-qualification-26-october-2026)
and [32-seed portfolio](http://127.0.0.1:5173/docs/research/m4-v2-portfolio.html).

The app opens on the circuit. Use **Test start** to jump to a repeatable test;
**R** resets to that selected start. Choose **Tyres** to see each wheel's material,
slip and RPM. The original lab pads remain available in the surface toolbar.

Open **Circuit workshop**, choose a seed/style/landscape/length, then **Preview seed**.
**Drive circuit** loads the validated preview. Editing settings disables loading until
the new recipe is generated. The workshop remembers the last loaded recipe; launch
still opens the authored proving circuit, also available from the workshop.
M7 also saves the accepted definition and active variant in IndexedDB; use
**Restore / import a circuit** to restore it after reload or import its JSON.

M7 supplies street, rural, mountain, airfield, speedway, road/oval hybrid and extended
endurance layouts alongside the M4 touring/GP generator. M8 adds time trials,
ghosts, solo rules and a circuit library. Choose **Start time trial** to reset to
the grid and cross the chequered line ahead. **Session & records** explains validity
and presentation settings. Racing overpasses remain an optional extension; open
rally/hill-climb routes remain out of scope.

See the [implementation plan](docs/implementation-plan.md),
[M1 foundation notes](docs/foundation.md), [M2 model notes](docs/m2.md) and
[M3 surface compiler notes](docs/m3.md), [M4 v2 notes](docs/m4-v2.md),
[M5 venue notes](docs/m5.md), [M6 car/workbench notes](docs/m6.md), [M7 expanded-family notes](docs/m7.md), [M8 solo-session notes](docs/m8.md) and
[archived M4 v1 notes](docs/m4.md).

## Synthesized driving audio on development

The channel/control system is the working foundation. The user likes the new
playground engine; its tyre modulation is useful but the noise-driven source
sounds like rain. The [tonal tyre pass](docs/research/audio-timbre.md#tonal-tyre-pass-ready-for-listening)
is now ready for listening, with a sustained squeal and optional scrape.
Development commits use [targeted validation](docs/workflow.md#validation-scope--revised-26-october-2026);
the full suite is required before merging into `main`.

The [audio playground](audio-playground.html) is the first audible A/B prototype:
short engine and tyre examples, perceptual controls and local JSON presets. It
starts on a dry tonal tyre slide, while the first noise tyre remains available
for comparison. The engine direction is accepted for later tuning; the new tyre
sound awaits user review. Production driving audio remains unchanged.

The separate [audio feature](docs/audio.md) adds RPM/load/shift engine synthesis,
four independent tyre warning/slip voices, headphone spatialization and distinct
front/rear cues. Sound is enabled by default and starts with the first browser
interaction. **Sound settings** provides the mixer, listening modes and labeled
wheel/channel checks. Explicit mute persists. The standalone
[Audio lab](audio-lab.html) supplies auditions, rendered-audio qualification,
a real listening test and the sustained driving benchmark.
