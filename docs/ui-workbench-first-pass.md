# First-pass workbench delivery

Implemented 27 October 2026 on `codex/ui-workbench-first-pass`, following the
[implementation plan](ui-workbench-first-pass-plan.md) and
[UI/codebase analysis](research/ui-workbench-analysis.md). This pass retains the
existing technical visual system and expands the exploration workflow.

## Working layout

The global header now contains car and track context menus, working-state context,
pause, mute and **Save baseline**. Workshops and the circuit library remain fully
available from those context menus. The left rail contains Setup, Recordings,
Garage / Compare, Settings and Help, with one persistent navigation entry each.
General rendering/camera preferences moved out of Session & records into Settings;
session-specific ghost controls remain with records. Existing stored preferences
are retained by a shared presentation-settings owner.

One 52 px working toolbar replaces the former surface, circuit-context and timing
rows. It contains the category group, New pairing and Tests, centered lap/delta,
reset, time trial and records. The category group becomes a labelled select when
the main workspace is narrower than 1080 px; it does not wrap into extra rows.
Warnings remain visible and expose full details, sectors and the reference on
focus/click. Timing has one view and consumes the existing session snapshot.

Setup and live instruments have independent local collapse/reopen controls, with
optional persisted UI preferences. Collapsing preserves the selected tab, scroll,
pending draft, datum and saved/frozen recordings. It does not change physical or
session state. Hidden instrument/recorder painters stop drawing while fixed-step
capture continues. The narrow navigation rail retains its width when Setup closes.
Recordings remains its separate overlay; closing it updates the same layout state.

Permanent keyboard legends were removed from the viewport/footer. Help derives
bindings from actual input settings, and Controls remains available through Settings.
Camera descriptors are shared, ordinary cycling reaches Orbit, and Overview has a
selected state and is hidden on pads. Existing telemetry diagrams are preserved.

## Categories and reproducible exploration

Fresh normal startup randomly chooses Club, Touring, Endurance, Prototype, Formula
or Stock and prepares an independently seeded car and track. Diagnostic pages
explicitly use deterministic startup. Changing category requests a fresh pair;
**New pairing** rerolls within the category, while **Random category + pairing**
also chooses a new category. Clicking the selected category leaves it active and
cancels any pending switch to another category.

| Category | Cars / bands | Track choices |
| --- | --- | --- |
| Club | Hatch/coupe, road or sport | Touring 2.0–3.2 km |
| Touring | Hatch/sedan/coupe, sport or race | Touring, street or airfield 2.8–4.5 km |
| Endurance | GT/prototype, race | Rural 6–10 km or endurance 8–12 km |
| Prototype | Prototype, race | GP 4–6 km or endurance 8–12 km |
| Formula | Open-wheel, race | GP 4–6 km or airfield 3.5–5.5 km; gentle relief, low kerbs |
| Stock | Stock, race | Oval 1.6–3.2 km or hybrid 3.2–5.2 km; mild banking |

These are catalog-v1 presets, not championship regulations. Supported layouts come
from each car archetype, and all recipes pass existing normalizers and construction
checks. Manual workshops retain every family, version, numeric setting, seed stream,
lock, route variant, venue option, diagnostic and import/export control.

The track context exposes the root and independent car/mechanics/proportions/
appearance/track/scenery seeds, accepted attempt, Repeat this pairing, explicit
restoration and pairing JSON exchange. The descriptor carries resolved recipes,
catalog version, factory setup, fingerprints and the accepted circuit archive.
Reproduction reuses accepted geometry and validates it under the current code.
Imported descriptors must match their catalog/seed and fingerprints; unsupported
or altered descriptors report errors. Ordinary modified tunes still use setup
save/export. One most-recent descriptor is kept in optional bounded browser storage;
it never overrides fresh random startup or populates the named circuit library.

Category activation uses the generated factory tune. It records the old working
setup once in existing car/setup undo history and does not silently transplant an
unrelated tune. Undo changes the car/setup on the current track; it is not track
undo. Manual construction or track replacement is identified as Custom; ordinary
tuning is Modified. Save baseline and named garage saving remain distinct actions.
The saved baseline is now loaded explicitly from the car menu; **Try saved baseline**
is available only for a compatible constructed car, with **Return to working setup**
retaining its live A/B swap behavior. Historical named setups and saved results are
retained. Ghost/result compatibility continues to use the conservative build key;
older records are not relabelled as results from the current build.

## Testing environments

Tests contains all seven original environments: **3D circuit — proving ground**,
Level pad, Single-wheel bump, Incline, Bank, Drive pad and Split grip, together with
circuit starts and Drop/Roll/Pitch actions. The proving-ground choice explicitly
loads the authored circuit and retains the active car/tune. **Return to selected
track** restores the previous generated/saved definition; neither it nor pad/reset
selection rerolls seeds. Category replacement exits the test context only on success.

## Reliability and data ownership

- A shared command policy guards pending structural drafts for replacement,
  saving, baseline comparison, session start and physical test transitions. Pure
  view controls preserve drafts; vehicle reset operates on the active car and
  retains them. Blocked select controls restore their effective selection.
- Layout/menu state is separate from setup/session state. Toolbar menus are
  nonmodal: simulation continues while driving input is suppressed. Space on a
  summary does not trigger Pause. Escape restores focus; held keyboard input is
  cleared, and held gamepad controls must be released before driving resumes.
- Category, workshop and archive preparation share circuit acceptance and a single
  generation owner. Car workshop and categories use the same cancellable physical
  validation client and physics checks. Superseded jobs cannot activate or persist
  a stale result. Up to three deterministic pair candidates are attempted; errors
  retain the current workspace and expose Retry/Cancel/proving-ground recovery.
- Replacement stages an isolated rig/collider world, settled chassis, off-scene
  car/ghost, circuit meshes and timing view. Constructors/validation run before the
  live pair changes. Commit switches the complete context once at a frame boundary,
  updates session identity and audio, clears the live capture context once, and
  disposes old resources. Preparation failure disposes staged resources. Applying
  chassis changes retains the draft if preparation fails.
- Pit geometry/edge classification and the actual venue limit are shared by the
  session and map advisory. RaceSession retains timed wrong-way/overspeed rules.
  Current generated limits remain unchanged; non-50 km/h behavior has focused tests.
- Recorded roll/pitch is explicitly road-relative, including additive metadata
  for new exports. Legacy v1 traces retain that interpretation. Live road/world
  selection does not reinterpret recordings. Effective wheelbase/wheel-track values
  use the existing resolved car; construction recipes and applied tuning retain
  distinct ownership. Static mass distribution remains distinct from live axle load.

No new numerical physics or generation algorithm was introduced. Working setup,
pending draft, generated factory setup, saved baseline, named garage entries,
comparison snapshots and workshop previews retain their different lifetimes.

## Validation and reproduction

Development validation follows the [scope policy](workflow.md). The implementation
uses focused input/workbench, setup/storage/comparison, generation-client/car,
race, rendering, map and audio integration/lifecycle checks, plus production build
and visible-browser workbench/session checks. Full regression and release promotion
remain separate work.

```sh
npm test -- tests/inputFlow.test.ts tests/workbenchFlow.test.ts tests/race.test.ts tests/rendering.test.ts tests/workbench.test.ts tests/generationClient.test.ts tests/setup.test.ts tests/circuitMap.test.ts tests/carGeneration.test.ts tests/audioIntegration.test.ts tests/audioRuntime.test.ts --maxWorkers=2
npm run build
npm run qualify:workbench
npm run qualify:m8
npm run qualify:m8:stress
```

`workbench-test.html` uses the production app with a deterministic reference car,
the authored circuit and isolated session IndexedDB. Its Qualification state
readout supports checks of the actual simulation/setup/session alongside UI geometry.
The normal app still randomizes startup. M8 renderer and physical lap pages retain
their established controlled fixtures. Restart Vite after physics/race edits.

The category campaign records at least ten accepted pairs per category, every
offered family/band and track branch/length endpoint, physical vehicle checks,
constructed starts, archive replay, attempts/rejections and representative full
laps. Its actual report and source hash are preserved separately from later UI-only
validation. Unchanged generation/car physics evidence is reused with its original
scope rather than being relabelled after presentation changes.

### Delivered measurements

Implementation commit: `0adf9a538722d83bcfd06f97f384c2b452facaa5`.
Frozen runtime source: `8565dd5b29ffc0a7`; physics/rules build:
`d259fe4e79fa30d7`. Subsequent integration documentation does not change that tree
of executable sources. Build passed; **133/133 focused tests** passed in 11 files.

| CSS viewport | Scene, panels open | Scene, instruments collapsed | Local toolbar |
| --- | ---: | ---: | ---: |
| 1841 × 1260 | 886 px | 1074 px | 52 px |
| 1920 × 1080 | 706 px | 894 px | 52 px |
| 1600 × 900 | 526 px | 714 px | 52 px |
| 1366 × 768 | 458 px | 582 px | 52 px |

All 16 viewport/panel combinations were measured on the committed build. The rail
stays 72 px at the wider breakpoints and 64 px at 1366 px, independently of Setup
collapse. The timer group remains centered in the available working area and no
duplicate IDs were present. At the original audit viewport the scene gains **181 px**
with instruments open and **369 px** with them collapsed, relative to the previous
705 px scene. Diagram sizes retain their existing responsive breakpoints.

The category campaign accepted **60/60 pairs**, ten per category, with **zero
rejected attempts** and **10/10 representative physical laps** passing. Every
offered car family/band, track branch and requested length endpoint was covered.
Its original runtime source hash is `b25d6a4bfd52e732`; retain that provenance.
Later changes affected input/command/UI handling and source LF canonicalization;
the catalog, generation algorithms and numerical validation/vehicle behavior are
unchanged. The final M8/browser/flow checks cover the later integration rather than
relabelling that category campaign as a fresh run.

On the frozen committed runtime, M8 passed **25/25 physical laps** with keyed
personal bests and ghost round trips. The actual toolbar/browser fixture completed
a valid **61.198 s** lap and validated its **1,225-pose** ghost, then restored both
best and reference after reload. Three visible 1920 × 1080 renderer samples on the
Ryzen 5 5600X / 32 GiB / RTX 3060 measured about **100 fps** and **10.1 ms p95**
frame intervals; scheduling was capped near 100 Hz, not a worst-case performance
claim. The three-world CPU sample remained finite; other desktop work was not
controlled. Full details and source hashes are in the reports.

The frozen-runtime browser report contains **16 passing checks**, including normal
random startup, exact pairing replay, proving-ground/archive return, pending-draft
protection, matched A/B responses and manual-workshop recipe synchronization. The
short native audio/driving sequence completed with **216 samples**, an observed
upshift, no failure events and no uncaught errors. Its single `first-upshift` event
is informational; its audio feature fingerprint and runtime source hash are both
preserved. This is digital integration evidence, not a new timbre/listening study.

- [Category/physical-pair campaign](research/ui-workbench-qualification.json)
- [Detailed workbench UI checks before LF canonicalization](research/ui-workbench-browser-qa.json)
- [Frozen-runtime timed laps and ghost exchange](research/m8-qualification.json)
- [Frozen-runtime visible renderer measurements](research/m8-desktop-benchmark.json)
- [Frozen-runtime browser checks](research/m8-browser-qa.json)
- [Frozen-runtime three-world CPU sample](research/m8-stress.json)
- [Short native audio/driving integration](research/ui-workbench-audio-driving.json)

Physical gamepad hardware, broad browser/GPU coverage and arbitrary manual tuning
combinations remain outside this desktop sample. The automated input tests cover
gamepad release gating; they do not claim a hardware usability study. The audio
20-minute stress run was not requested and is not part of this pass.
