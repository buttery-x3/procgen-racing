# First-pass workbench implementation plan

Prepared 27 October 2026. **Implemented on `codex/ui-workbench-first-pass`.**
See [delivery and validation](ui-workbench-first-pass.md) for the actual result,
measurements and qualification scope. This document retains the original plan.
Based on `caa584bcd9f10036411853d2ff1a1237893b9dbc` on `development` and the
[UI/codebase audit](research/ui-workbench-analysis.md). Planning branch:
`codex/ui-workbench-first-pass-plan`. Follow the [repository workflow](workflow.md)
for implementation on a fresh `codex/ui-workbench-first-pass` branch from updated
`development`.

The owner's follow-up expands the audit's first pass to include **category buttons
and random category/car/track selection**. This supersedes the audit's earlier
deferral of category generation. Looping demonstrations and explanatory lessons
remain future work. The approved direction is an exploratory vehicle-dynamics
workbench: choose, drive/test, observe, tune, compare and keep the result.

## 1. Scope and decisions

- Preserve the current visual language, typography, diagrams, numerical detail,
  muted palette and panel backgrounds. Work with actual components at their
  existing desktop scale; no replacement image mockup or visual rebrand.
- Keep the global header. Replace the three local bars with **one working toolbar**
  targeting 48–56 CSS px, with lap time and delta centered in the main workspace.
- Preserve the expanded live-telemetry panel; add independent collapse/reopen.
  Make the setup inspector's existing collapse discoverable locally. Keep the
  narrow left tool rail and fix its width changing when the inspector collapses.
- Make Club, Touring, Endurance, Prototype, Formula and Stock first-class choices.
  They replace the always-visible test-surface buttons. Fresh normal startup
  randomly chooses a category and independently seeded car/track recipes.
- Move **all seven existing environments** into Tests: **3D circuit — proving
  ground**, Level pad, Single-wheel bump, Incline, Bank, Drive pad and Split grip.
  The authored 3D circuit stays available as a repeatable vehicle-testing baseline.
- Include the audit's naming/navigation treatments and reliability consolidations,
  including shared commands, layout state, track advisories, display definitions,
  measurement references, archive preparation, camera cycling and input help.
- Retain every manual generation control, reference car, tuning field, saved
  circuit, recording, import/export and comparison capability. Categories are
  convenient presets over the existing generators, not new vehicle regulations.

Excluded: new physics, new car/track families, automatic teaching demonstrations,
AI opponents, career systems, telemetry overlays, a combined recorder/instruments
dock, wholesale framework migration and promotion to `main`.

## 2. Working arrangement

### Header, toolbar and panels

| Area | First-pass contents | Secondary detail |
| --- | --- | --- |
| Existing global header | Brand; compact active car/track context and modified/pending state; pause, mute and explicit save action | Car and track context menus expose workshops, library, full names, seeds and recipe details. General preferences have one home. |
| Working toolbar, left | Six category buttons, New pairing action and Tests chooser | At constrained workspace widths, a labelled category chooser exposes the same six options. Tests contains environments, starts and physical test actions. |
| Working toolbar, center | Circuit lap/sector, time, delta and compact validity indicator | Focus/click reveals splits, reference details and the full invalidity reason. Pads show the active test/measurement context instead of a misleading lap timer. |
| Working toolbar, right | Reset vehicle; practice/time-trial action; Session & records | Contextual availability and consequences come from shared commands. |
| Left rail | Setup toggle, Recordings, Garage / Compare, Settings and Help | One persistent home per destination; icon labels/tooltips remain available. Brand is not a hidden vehicle-reset command. |
| Viewport HUD | Existing speed/gear/RPM, assists/contact, corner type and road data | Preserve the map and current technical treatment. Gather Overview with the existing camera choices. Remove permanent keyboard hints. |
| Right inspector | Existing tuning tabs and controls, plus local collapse | Collapsed handle identifies Setup and pending/modified state. Expanded view retains tab, scroll and draft. |
| Bottom instruments | Existing diagrams and road/world datum, plus local collapse | Compact labelled reopening strip. Recorder visibility remains independent. |
| Footer | Compact runtime/input diagnostics as useful | Remove repeated pause status and persistent shortcut legend. Detailed bindings live in Help/Controls. |

The header takes compact car/track identity so category choices do not compete with
long names beside the centered timer. Car context owns Car workshop and reference
selection; track context owns Circuit library and Circuit workshop. Remove their
duplicate permanent header/rail/row buttons. Contextual shortcuts use the same
command, with the same availability and draft guard.

Use balanced space around the timing group so asymmetric controls cannot displace
it. Choose the compact-category breakpoint from **available main-workspace width**,
including inspector visibility, rather than only the window width. Before controls
collide, replace the six-button group with its labelled chooser and move secondary
actions into menus. Do not wrap into another permanent row or shrink the fonts.
Show all six buttons when they fit. Preserve keyboard access and visible selection.

Warnings such as wrong way, pit overspeed and invalid lap remain visible without
opening a menu. Show the highest-priority warning and expose all reasons on demand;
do not derive their priority or state independently in each widget. Static track
instructions and test-start prose move into their chooser/details.

Audit reference: at 1841 × 1260 CSS px, the three local bars occupied 233 px and
the scene was 705 px high. A 52 px replacement would recover 181 px with the other
regions unchanged. These are **baseline measurements and a design target**, not
new measured results. Record actual before/after dimensions during implementation.

### Tests and baseline circuit behavior

Tests groups **Environment**, **Circuit start** and **Actions** rather than keeping
seven environment buttons visible. Drop, Roll pulse and Pitch pulse have one
canonical action group. A suspension-tab shortcut is optional only if it serves
the immediate experiment and uses that same command.

Selecting a pad retains the car and tune. Selecting **3D circuit — proving ground**
explicitly loads `getTestCircuit()` while retaining the car/tune; it must not merely
set `experiment = circuit` and leave an arbitrary generated track active. Retain
the previous generated/saved track descriptor and provide **Return to selected
track** in Tests. Returning from a pad or the proving circuit never rerolls seeds.
The retained descriptor is bounded state, not another generated geometry cache.

Show the active test environment while testing, and distinguish the retained
exploration category from the active proving-ground/pad context. Reset vehicle
returns to the selected start; Reset setup restores the appropriate factory tune.
Selecting a category/New pairing exits the test environment only after the new
pair succeeds. Repeated test selection and reset must remain deterministic.

### Names and navigation

| Existing label/behavior | Planned treatment |
| --- | --- |
| Save setup | **Save baseline**; persist the current quick-save baseline, with destination stated. Named library saving remains **Save to garage…**. |
| Compare saved | **Try saved baseline** / **Return to working setup**; show compatibility and retain its live-swap semantics. |
| Garage / Compare | One destination with explicit **Saved setups** and **Compare test runs** sections; preserve isolated A/B simulation. |
| Base setup | **Suspension preset**, because it changes six suspension values rather than the whole car. |
| Reset setup | **Reset to factory setup**, distinct from Reset vehicle and trying the saved baseline. |
| Telemetry chart icon | **Recordings** or **Response recorder**; live instruments have their own toggle. |
| Chassis Track width | **Wheel track**, distinct from road width on the map. |
| Home / Suspension rig navigation | Remove implicit reset behavior from navigation; expose the reset command explicitly. |
| Presentation preferences within records | Move quality/effects/camera preferences to Settings; keep session/ghost-specific controls with records. One owner retains existing persisted values. |
| Sound settings duplicated | Settings opens the existing audio controls; quick mute remains directly available. |
| Generation milestone/version wording | Keep technical versions, diagnostics and legacy restoration in advanced/reproduction groups, with descriptive user-facing labels. |

## 3. Category selection and randomness

### User flow

1. Normal startup selects one of the six categories uniformly, draws a fresh root
   seed and prepares a random compatible car/track pair. Show progress immediately.
2. Selecting a different category prepares a fresh pair in that category with one
   action. Clicking the already-selected category does nothing; **New pairing**
   rerolls both within it. Its menu includes **Random category + pairing**.
3. The active selection updates only when the complete pair is ready. A pending
   category is visibly pending, not falsely shown as the active one.
4. Open either workshop from the active context to inspect/edit the actual selected
   recipes and all existing controls. Opening a workshop alone must not generate,
   apply or replace the current pair.
5. Tune normally, record/compare, and explicitly save results. A new category uses
   its generated factory tune; it does not transplant tuning from an unrelated car.

One-click replacement is the explicit action; do not add a confirmation to every
category selection. **Pending unapplied structural edits** block replacement with
Apply/Discard guidance. Already-applied working edits are recorded once in existing
setup history before successful replacement. Undo remains **car/setup undo**, not
track undo; make that scope explicit. A failed/cancelled request changes neither
history nor the current working setup. Saved baselines and named garage entries
are never overwritten by randomization.

Initial random startup intentionally changes the old behavior of automatically
loading the single saved baseline on the authored circuit. Preserve that baseline
and offer an explicit **Load saved baseline** action, clearly identifying its car.
Do not apply it automatically to the new generated car. Existing **Try saved
baseline** retains its compatible-car comparison rule. Diagnostic/test launch
paths must explicitly request deterministic startup and bypass random exploration.
Document this change in README and delivery notes when implemented.

### Initial category recipes

Use a versioned declarative catalog over existing types. The following are proposed
initial bounds, to be qualified before enabling each category. They are not claims
of championship authenticity or proof that every combination already drives well.
Choose among listed families/bands equally initially; choose only layouts supported
by the selected `ARCHETYPES[family].layouts`. Do not independently randomize every
raw numeric setting.

| Category | Vehicle recipe choices | Circuit recipe choices and target bounds |
| --- | --- | --- |
| Club | `hatch` / `coupe`; `road` or `sport` band | v2 touring, 2.0–3.2 km, gentle or rolling, mixed/technical; club venue theme |
| Touring | `hatch` / `sedan` / `coupe`; `sport` or `race` | v2 touring 2.8–4.5 km; v3 street 2.8–4.5 km or airfield 2.8–4.5 km, full route |
| Endurance | `gt` / `prototype`; `race` | v3 rural 6–10 km or endurance 8–12 km, full route and endurance facilities |
| Prototype | `prototype`; `race` | v2 GP 4.0–6.0 km or v3 endurance 8–12 km, full route |
| Formula | `open-wheel`; `race` | v2 GP 4.0–6.0 km or v3 airfield 3.5–5.5 km, gentle relief and low kerbs |
| Stock | `stock`; `race` | v3 oval 1.6–3.2 km or hybrid 3.2–5.2 km, full route, mild banking initially |

Normalize through existing recipe/venue normalizers; use comfortable construction
envelopes initially. Quantize lengths to the supported 100 m steps. Derive scenery
seeds separately; retain existing rendering-quality preferences. Advanced manual
workshops continue to expose omitted families, wider lengths, versions, variants,
banking and all other options. The six categories need not cover every manual
possibility to be useful.

Confirm generated geometry, construction checks and car physical acceptance before
activation. Existing car/track validators alone do not certify their pairing;
the category qualification below also checks representative cars on their selected
tracks, including grid/start clearance and finite stable driving behavior. Refine
the catalog bounds if a family pairing fails; do not bypass checks or change the
physics to force the preset to pass.

### Reproduction and state

Introduce an `ExplorationSelection` descriptor containing schema/catalog version,
category, root seed, resolved car recipe (including mechanics/proportions/appearance
streams), resolved track recipe, venue/scenery settings, chosen variant, accepted
retry indices and resulting fingerprints. Retain the accepted circuit archive
where exact reconstruction requires its definition; a seed alone is not a promise
of identical geometry across generator versions.

Use randomness only to create the initial selection; derive independent named
streams deterministically from the root. Replaying a descriptor must not draw new
random values. A bounded retry policy of at most **three candidate pairs** derives
attempt seeds from that root and records the successful attempt. An unsuccessful
attempt must not silently switch to another category or report a generator fallback
as the requested experience. On exhaustion expose Retry and the failure details.

Show seeds and resolved recipes in context details/workshops, not in another
permanent bar. Provide **Repeat this pairing** from the context action menu using
the accepted descriptor, and allow copying/exporting that descriptor together with
the accepted track archive and generated factory setup for later restoration.
Validate imported descriptors through the same preparation path; unsupported
versions report a readable error. User-modified tunes still use the existing setup
save/export system. Keep the most recent descriptor in bounded, separately versioned
exploration storage; it supports explicit restore and never suppresses random
startup. Storage failure must not prevent driving or alter existing saved data.

Manual replacement of the car/track or recipe-level construction changes marks the
pair **Custom**, retaining provenance where useful. Ordinary tuning shows Modified
within its category. Undo to a different car recomputes this status. Do not pretend
that a manual Formula car on an oval remains a fully selected Club preset. Independent
New car/New track locks are a later extension; existing manual tools already provide
those operations in this pass.

## 4. Reliable ownership and transitions

### Shared commands and layout state

Create a small typed command definition/dispatcher for the actions touched here.
Each command defines its label, availability, draft requirement and effects
(view-only, reset, setup mutation, environment change or session transition).
Buttons, keyboard actions, category actions and modal adapters dispatch through
it; App remains the simulation owner. Remove duplicate string-routing branches
as callers migrate. Do not wrap the existing handlers in an additional divergent
policy layer or undertake an unrelated whole-app framework rewrite.

Centralize the pending-draft rule for loading/replacing cars and tracks, saving,
starting sessions, baseline comparison and test/environment transitions. Block
these actions until Apply/Discard. Pure camera, panel, datum and help operations
retain drafts. Reset vehicle retains the draft and resets only the active car;
applying the draft remains explicit. Availability must match keyboard and pointer
paths. Preview/import preparation alone cannot silently activate a result.

Use one `WorkbenchLayoutState` for inspector/instruments collapse, recorder
visibility and context-menu state. Persist only useful panel visibility preferences
under a separate versioned UI key; menus close on reload. Existing selected tabs,
scroll, datum and draft remain owned by their existing views. Default both panels
to expanded for users without a preference. Guard malformed/unavailable storage.
Layout changes update focus, `aria-expanded`, `aria-controls` and resize together.
Hidden panels must not leave focus on unreachable controls.

Panel collapse and menu opening are view actions: they do not reset, pause, abandon
a lap or clear capture. Nonmodal context menus suppress driving controls while they
have focus, clear held input on entry/exit, and support Escape/focus return; elapsed
simulation continues. Existing modal workflows retain their documented pause and
lap-invalidity behavior. Do not accidentally invoke `dialog[open]` pause semantics
for every toolbar chooser. Extend the input UI-focus policy accordingly, including
gamepad handling; merely moving controls out of dialogs is insufficient.

### Prepare a pair before activation

Existing `App.loadCircuit` and `applySetup` each mutate the active world and
configure the session. Calling them sequentially is **not** an atomic pair swap.
Create a preparation/activation boundary that can commit both once:

1. Validate intent/drafts; assign a request token and capture the active context
   revision. Prepare generated recipes without changing the current workspace.
2. Reuse `generateCar`, its static checks and the **existing physical validation
   worker**, extracted from CarWorkshopPanel into a reusable client. Cache by
   mechanics plus the relevant validation/physics version. Never activate before
   physical validation finishes successfully.
3. Prepare the track through the existing `GenerationClient`, report validation,
   archive/hydration and venue construction. Preserve full accepted definitions.
4. Stage the candidate rig/collision world and required scene resources with the
   new setup/circuit, settle it using the established initialization policy, and
   verify its start state. Retain the old live world until staging succeeds. Refactor
   rendering preparation/disposal enough that a preparation exception cannot leave
   a new car on the old track, or old meshes against new collision.
5. Recheck request token, revision, pending edits and disposal before commit. Commit
   the rig/view/context at a frame boundary; rebuild session identity once from the
   actual final car and circuit, enter practice, select the initial circuit start
   and chase camera, clear held input, and reset the fixed-step accumulator.
6. Update active recipe/workshop/library context and setup history once. Clear a
   stale baseline-comparison return state, select the new factory baseline and
   clear the live trace buffer once so one run cannot contain two physical setups.
   Preserve saved recordings. Rebind audio to the committed setup and dispose old
   resources only after successful replacement.

One coordinator owns generation jobs across category selection, workshop preview
and archive restoration. `GenerationClient` currently allows one job and cancels
the preceding job; separate UI callers cannot assume independent pending requests.
Track the owning destination and route progress/errors only to it. A newer request
supersedes an older one; cancelled/stale responses cannot update previews, activate
a pair or write storage. Mutating the active tune/car/track while a request is
pending cancels it; camera/layout changes need not. Cancel and dispose staged
workers, rigs and meshes on failure, supersession or app teardown. Keep one staged
pair maximum and release unsuccessful candidates between retries.

During preparation the old workspace remains active and its pause state is
unchanged. At successful activation abandon the old session once, enter practice
and preserve the user's explicit paused state; otherwise begin settled and driving.
Respect background/focus-loss pause. Startup has no prior world to preserve: show
progress, and on total failure offer Retry plus the authored proving circuit with
the default reference car, visibly identified as the fallback and initially paused.
Never overwrite saved data to recover startup.

Setup history and working/draft/factory/saved/library/A-B snapshots retain their
distinct lifetimes. Likewise, a workshop preview stays separate from the active
track. A shared preparation service is not permission to auto-apply previews.

### Consolidations from the audit

| Work item | Concrete implementation boundary | Required evidence |
| --- | --- | --- |
| One timing source | Extract a compact timing view from SessionPanel; it consumes the existing SessionSnapshot. Records remain a separate view; general presentation settings move to their own owner without duplicating persistence. | No duplicate IDs, timer/rule calculation or reset from opening details; same session values in compact view and records. |
| One pit/advisory source | Extract track-context evaluation from RaceSession's existing pit geometry/road-edge logic; expose its result to the HUD. Keep duration thresholds and invalidation in RaceSession. Use the venue speed limit and existing fallback once. | Pit entry/exit, merge overlap, missing pit, non-50 km/h limit and overspeed produce consistent HUD/session results; existing rules remain equivalent. |
| Shared display definitions | Reuse/extend carDerived, TRACE_METRICS, map helpers and input descriptors; share units, signs, vehicle names and wheel-state labels, not entire context-specific panels. | Equivalent displayed quantities agree; static mass distribution remains distinct from live axle load. No UI recalculation of physical measurements. |
| Explicit measurement datum | Label live angle values with the selected road/world datum; label recorded roll/pitch as road-relative. Include additive datum metadata in new exports and define legacy v1 traces as road-relative. | Old recordings still load; recorder/A-B axes and exports agree; live datum changes do not reinterpret stored samples. |
| Construction versus tuning | Both workshop and inspector use resolveCar for effective dimensions. Explain recipe dimensions versus applied wheelbase/wheel-track overrides and show the same final values. | Applying, cancelling and undoing structural changes do not desynchronize meshes, contacts, inspector or workshop summaries. |
| Shared circuit archive preparation | One typed service accepts generated recipes or accepted archives, validates/compiles and returns prepared results. Preview and Activate remain explicit callers; legacy restore moves into recovery/import. | Workshop, library and exploration restoration enforce equivalent checks and stale-job protection without activating a preview. |
| Camera selection | Use one camera descriptor list for buttons and cycling; fix `% 3` against four normal modes. Overview has active-state reporting and is available only in circuit context. | Every normal mode, including Orbit, cycles exactly once; Overview is selected accurately and does not leak into pad-only contexts. |
| Remapped input help | Derive controls/help labels from actual InputSettings and shared action descriptors; remove literal default-key claims and permanent HUD/footer key legends. | A remap updates help and behavior together; menu/modal input does not also drive/reset the car. |

The car physical-validation client extraction is an additional consolidation made
necessary by category generation. Reuse its checks rather than implementing a
weaker category-only acceptance path. There is no need to replace the shared fixed
physics/VehicleTelemetry/trace pipeline, or to eliminate useful repeated wheel-load
readouts used for different comparisons.

## 5. Implementation sequence

Implement on `codex/ui-workbench-first-pass`, with reviewable commits and focused
checks at each boundary. All steps below are part of this pass; completing only the
layout does not complete the requested scope.

| Step | Deliverable and likely files | Completion condition |
| --- | --- | --- |
| 1. Establish state and command boundaries | Workbench/App/Input; new small command and layout-state modules; focused behavior tests | One effect/guard definition for touched actions; panel and nonmodal-menu behavior demonstrably separate from simulation transitions. |
| 2. Recover space and clarify navigation | Workbench.ts, SessionPanel.ts, style.css, m6.css; compact timing/settings views | One local toolbar, centered timing, two independently collapsible panels, stable rail width and all relocated actions reachable. |
| 3. Consolidate measurement and utility paths | RaceSession, Workbench, Diagrams, TelemetryTrace, InputPanel and camera descriptors | Shared pit context, explicit datum and dimensions, correct cycling/help, clear save/reset/compare semantics. |
| 4. Share preparation services | App, GenerationClient callers, CarWorkshopPanel validation, archive and rendering preparation | Existing manual preview/load paths pass their regressions using shared services; staged candidate failure leaves active world intact. |
| 5. Add exploration catalog and transition | New catalog/selection/controller/storage modules; App startup; category/context controls; workshop recipe synchronization | All six categories, seeded replay, randomized normal startup, explicit deterministic diagnostics, bounded retries/cancel and successful pair activation work end to end. |
| 6. Qualify and document the complete pass | Targeted tests, visible browser evidence, M8 and affected generation qualification, README and delivery notes | Acceptance checklist passes; actual dimensions and limitations recorded; completed branch integrated into development for user testing. |

Steps 1–3 can use the eventual category group as a layout fixture without shipping
nonfunctional controls. Stage 4 precedes category activation. Use source inspection
and failure-injection tests to settle staging ownership before wiring the visible
buttons; do not retrofit rollback after adding a sequential car-then-track swap.

Relevant existing foundations:

- [App startup, preview and activation](../src/app/App.ts),
  [Workbench shell/state](../src/workbench/Workbench.ts),
  [SessionPanel](../src/workbench/SessionPanel.ts),
  [layout CSS](../src/style.css), [secondary workbench CSS](../src/workbench/m6.css).
- [GenerationClient](../src/track/GenerationClient.ts),
  [recipe types](../src/track/generationTypes.ts),
  [expanded families](../src/track/families/types.ts),
  [venue settings](../src/track/venue/types.ts),
  [car recipes](../src/vehicle/CarDefinition.ts),
  [generateCar](../src/vehicle/generateCar.ts),
  [car physical validation worker](../src/vehicle/carValidation.worker.ts).
- [Car workshop](../src/workbench/CarWorkshopPanel.ts),
  [Circuit workshop](../src/workbench/CircuitGeneratorPanel.ts),
  [Circuit library](../src/workbench/CircuitLibraryPanel.ts),
  [Circuit archives](../src/storage/CircuitStorage.ts),
  [rig lifecycle](../src/physics/SuspensionRig.ts),
  [scene lifecycle](../src/rendering/SceneView.ts).
- [RaceSession](../src/race/RaceSession.ts),
  [session identity](../src/race/identity.ts),
  [diagrams](../src/workbench/Diagrams.ts),
  [trace model](../src/workbench/TelemetryTrace.ts),
  [input routing](../src/input/Input.ts), [input settings](../src/input/settings.ts).

## 6. Acceptance and validation

### Layout and interaction

- Measure at the audit's 1841 × 1260 CSS viewport plus 1920 × 1080, 1600 × 900
  and 1366 × 768, with both panels open, each closed and both closed. Check long
  generated names, pending drafts, no PB, warnings and browser zoom. Category
  overflow must not recreate extra persistent bars. Do not report arithmetic as
  an observed viewport gain.
- Expanded diagrams preserve geometry, label scale, datum and content. Inspector
  collapse preserves tab, draft, scroll and undo. Independent toggles return real
  space to the renderer; the rail width stays fixed at each responsive breakpoint.
- Collapse/reopen and all context menus work by keyboard with correct focus and
  ARIA state; gamepad UI navigation remains usable. Opening a menu does not cause
  a hidden drive/reset action, and closing it cannot leave held throttle/steering.
- Live capture continues at 120 Hz with instruments/recorder hidden; skip only
  hidden DOM painting. Reopen shows current telemetry. View changes preserve lap,
  pause, setup and recording state; physical transitions follow their command rules.
- Verify all seven environments, return-to-track, selected test starts, impulses,
  every camera, reference cars, all tuning tabs, manual generator options, library,
  saves/imports/exports, input/audio preferences and both comparison workflows.

### Category and transition correctness

- Deterministic tests cover all six mappings, normalized bounds, supported car
  layouts, independent seed streams and reproduction of exact resolved recipes.
  Test injected randomness rather than flaky assertions about live random output.
- A fixed category campaign uses at least 10 reproducible accepted pairs per
  category, covering every offered car family/band and track recipe branch plus
  length endpoints. Record attempts, failures, fallbacks, generation/validation
  times, source/catalog versions, seeds and fingerprints. Expand beyond 60 if
  needed for branch coverage; report rejection rates as well as successes.
- Run the existing static and physical car validators and circuit construction
  checks for those pairs. Perform conservative driving/full-lap smoke checks on
  representative pairs covering each car family and track branch, including long
  endurance, Formula clearance and oval/hybrid banking. Record actual scope; this
  is not a certification of arbitrary manual tunes or every car/track combination.
- Inject car-check, worker, archive, collision and view-preparation failures; cancel
  during each stage; rapidly choose categories A/B/C and mix requests with manual
  preview/import. Only the latest successful authorized intent may commit.
- After failure/cancel, old world, tune/draft, history, session and saved data are
  unchanged by the failed request; independent driving may of course have continued.
  No orphan workers/worlds/meshes or accumulated listeners remain after repeated swaps.
- At successful commit, car, track, UI, audio, session identity, factory baseline,
  recorder condition and library descriptor all describe the same pair. One new
  session/configuration transition occurs. Saved recordings/PBs/garage remain intact.
- Verify random startup with/without existing baseline, explicit saved-baseline
  loading, corrupted/unavailable exploration storage, descriptor replay/import,
  fallback startup, window blur during generation and deterministic diagnostic pages.

### Check scope and evidence

Run focused Vitest selections for the changed boundaries, extending meaningful
behavior tests rather than asserting markup strings. Existing suites include
`workbench.test.ts`, `setup.test.ts`, `generationClient.test.ts`,
`carGeneration.test.ts`, `race.test.ts`, `rendering.test.ts` and
`circuitMap.test.ts`; select applicable cases and add command/layout-state,
exploration/replay and transition-failure tests. DOM layout/focus requires visible
browser evidence, not only model tests. Run `npm.cmd run build` for code integration.

The complete pass changes session/presentation and startup/activation behavior:
run `npm.cmd run qualify:m8`, `npm.cmd run qualify:m8:stress` and the visible
session/renderer checks, then publish source-matching evidence with
`npm.cmd run report:m8`. Update deterministic diagnostic startup paths first and
restart the development server after physics/race edits. Do not substitute random
normal startup for the controlled qualification fixtures.

Categories add bounded recipe selection and orchestration, whose new combinations
require the targeted campaign above. Reusing unchanged generators does not by
itself require claiming their historical reports are fresh. If implementation
changes car construction or physical validation, run
`npm.cmd run qualify:m6 -- --count=1000 --driving` and retain the tested source hash.
If it changes track generation/construction, run
`npm.cmd run qualify:m7 -- --count=1000 --construction=32`,
`npm.cmd run qualify:m7:driving`, the visible benchmark and `npm.cmd run report:m7`.
Staged rig/collider lifecycle changes need their directly affected construction
checks even when recipe algorithms are unchanged. State the final diff-based
scope before executing checks; see [M6](m6.md), [M7](m7.md) and [M8](m8.md).

Exercise audio handoff during pair changes with the affected lifecycle/integration
checks; do not rerun timbre/channel campaigns for label relocation. The 20-minute
audio stress run remains excluded. Full regression is required before a separately
authorized release to `main`, not for each implementation commit.

Record new focused evidence separately from historical qualification. Include
tested commit/hash, actual viewports, environment, timings, cancellation/resource
observations and any remaining limitations. Repeat checks only after relevant
changes/failures, not merely to refresh a fingerprint.

## 7. Delivery

Update README, the research index and delivery notes with implemented behavior,
startup/save semantics, category mappings and the new homes of existing controls.
Commit and push the implementation branch, merge into updated `development` and
push it for the owner's testing under the standing authorization. Report branch,
development commit, validation and limitations. Keep `main` and baseline tags
unchanged until an explicit release request.

This planning change itself uses content, local-link and diff checks only. No
application tests, build, generation campaign or runtime qualification are claimed
by this document.
