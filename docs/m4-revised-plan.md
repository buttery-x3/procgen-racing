# M4 revised — designing circuits instead of perimeter loops

> **Branch policy:** `main` holds the M0–M5 `v0.1.0` baseline. Each future
> milestone uses its own branch from `development`, then is merged and pushed
> to remote `development` on completion for testing. Later releases to `main`
> require an explicit request. See the [release workflow](workflow.md).

**Implementation update, 26 October 2026:** the approved revision is now implemented
as the driveable v2 generator in the main Circuit workshop. See [M4 v2](m4-v2.md)
for delivered algorithms, controls, bounds and qualification. The research results
below describe the earlier `m4-study-1` experiment and remain historical evidence.
R1–R4 qualification is complete: 4,000 fully compiled native results from 1,000
attempted seeds per preset, zero fallbacks/failures, six extreme-case full laps,
117 automated tests and a production build. The production portfolio uses 32
distinct seeds in fixed disjoint ranges; the browser worker benchmark measured
0.75–2.88 seconds across twelve recipes on the reference development desktop.
Physical gamepad and broader GPU/hardware checks remain separate from this delivery.

25 October 2026. This plan supersedes M4's design-quality completion claim and the
track-generation details where they conflict with the original implementation plan.
M1–M3 and the v1 driving/worker/workbench infrastructure remain useful and working.
The delivered v1 generator is a limited baseline, not the completed circuit-design
system. M5 should not build detailed dressing around that limitation.

Read the [circuit research and source analysis](research/circuit-design.md), open
the [interactive design study](http://127.0.0.1:5173/circuit-lab.html), or inspect
the [uncurated nine-layout comparison](research/circuit-portfolio.svg).

## 1. Diagnosis

The user-visible repetition has two structural causes:

- `generateCircuit.ts` places control points in angular order around one centre,
  with one reserved straight and one local inward complex. Rotating, scaling or
  jittering it cannot produce genuinely folded layouts.
- `SurfaceCompiler.ts` connects generated terrain radially to an outside circle
  and infield centre, rejecting non-star-shaped interiors. A better route generator
  would therefore fail compilation even if its centreline were sound.

Further shortcomings: semantic names are inferred after geometry rather than
driving it; widths are largely station-based random values; six site rotations are
not terrain-aware route design; global relief/bank reduction conceals poor local
fitting; and numerical validity was accepted without the originally planned
diversity report. The original 48-recipe sweep and physics tests establish useful
robustness for v1, not acceptable design variety. A different spline interpolation
alone would not fix these problems.

## 2. What has been developed in this revision

The experimental `m4-study-1` engine is separate from saved v1 recipes and the
driving surface. It implements:

1. Three explicit study briefs: club/touring at about 3.2 km, modern GP at 5.2 km,
   and landscape endurance at 6.8 km. These are starting experiments, not the final
   product's complete family model or circuit replicas.
2. Signed straight/arc chains with two or three acceleration slots, hairpins,
   sweepers, paired esses and tightening pairs. The source project's biarc
   mathematics is adapted and attributed. There is no radial sector order.
3. A maximum 24% closing-section share, bounded candidate search and explicit
   rejection reasons. No substitute seed or fallback is returned by this study.
4. Uniform-distance sampling into a periodic C2 B-spline; crossing, radius and
   corridor separation rechecks after smoothing. This proves a representation path,
   but spline fitting still needs tighter motif/racing-line fidelity controls.
5. Eighteen translations/headings per feasible proposal on a fixed seeded site,
   scored using a centreline earthwork proxy, grade penalty and target relief.
   Local bend neighbourhoods can then move toward better terrain fit; straights
   are protected. Refinements that violate plan-view checks are reverted explicitly.
6. Terrain/elevation traces, a diagnostic acceleration/braking speed envelope,
   comparison with actual v1 output for the same seed, reproducible export and
   a cancellable worker. All nine portfolio slots appear, including failures.

Run `npm run study:report` to reproduce the 24-case sweep and write full records to
`artifacts/design-study/portfolio.json`, a summary beside it, and the nine-layout
SVG in `docs/research/`. The first three seeds per brief are shown without curation.

Measured on this development machine, this sweep found 24/24 screened plan-view
proposals, with 2–4 straights longer than 150 m, 6–16 thresholded direction changes,
49–89% enclosed-area/convex-hull-area occupancy and 24–107 m estimated relief.
Search took approximately 0.26–1.93 seconds per study in Node/Vite SSR; this is not
a browser performance guarantee. Eight retained local terrain edits. Sixteen did
not retain an edit; inspecting rejection reports distinguishes reversion from no
improvement. The figures describe these 24 fixed recipes, not a general success rate.

**None is certified for driving.** All 24 exceed the existing 6% default grade
envelope (estimated peaks 9.5–29.7%). This is evidence that placement and local
contour edits alone are insufficient: vertical-profile optimization must be coupled
to the route and facility plan. The experiment does not globally flatten terrain to
hide this. It also does not implement bank/width fitting, runoff, a road network,
bridge layers or compiled road/collision meshes. The speed trace uses a simple
0.85 g curvature limit plus forward acceleration/backward braking passes; it omits
grade, aero, bank and tyre load sensitivity. It is not a predicted lap time.

“Direction changes” counts significant curvature-sign runs, not official turns.
“Hull occupancy” measures folding, not quality: a fast, comparatively simple venue
can be excellent. Cut/fill RMS samples the centreline only, not construction volume.
Reported prototype separation is sampled plan-view road-edge distance, not a
certification that speed-dependent runoff fits. Local editing can change lap length
slightly; the study shows actual length rather than claiming an exact target.

Verification: 107 automated tests pass across eight files, including nine new
design-study checks. The TypeScript/Vite production build includes the separate
study page and worker. Browser checks cover the nine-card portfolio, selection,
comparison/metrics, cancellation and restart. The existing large driving-bundle
warning remains; this revision is not a performance qualification for long venues.

## 3. Production method

### Separate the brief's dimensions

Replace one all-purpose family switch with independent, constrained choices:

| Dimension               | Examples                                                                                                  |
| ----------------------- | --------------------------------------------------------------------------------------------------------- |
| Site origin             | Purpose-built park, rolling landscape, inherited rural roads, urban roads, former airfield, oval facility |
| Lap character           | Flowing, stop/start, technical, mixed; unequal sector identities allowed                                  |
| Scale                   | Club, full-size GP/GT, extended endurance; never rescale cars or road widths                              |
| Vehicle envelope        | Touring/road, GT/hypercar, prototype/open-wheel, oval stock car                                           |
| Terrain interaction     | Low relief, valley/ridge traversal, summit complex, bowl/infield                                          |
| Operational constraints | Grid/pits, paddock, access, escapes, allowed junctions, route variants                                    |

Preset these into simple user-facing choices; do not expose a wall of solver
parameters. Endurance is also a compatibility/operations overlay on ordinary
circuits. A long road-network circuit is a separate site/layout brief.

### Site and strategic route

Generate broad terrain before choosing an outline. Derive a coarse feature graph:
flat buildable patches, broad ridges/valleys, usable passes and slopes, drainage/
exclusion corridors and property boundaries where relevant. Noise remains a useful
terrain source, but features and land costs give it meaning. Distinguish natural
terrain from designed earthworks and retain both.

Reserve candidate grid/paddock footprints with approach/departure space and access.
Choose a sequence of regions: for example flat facilities → climb → summit complex
→ descending bends → valley acceleration → return. A different seed can instead
choose compact infield → outer fast loop → braking return. These are graph rules
and parameterized relationships, not a small set of complete track silhouettes.

Keep several proposal modes in the same search:

- **Sequence-led:** grow signed motifs using the drift-inspired chain, with occupancy
  pruning and strategic region targets.
- **Anchor-led:** place major straights or fast sweeps in suitable corridors; reserve
  the intervening corner complexes before fitting connectors.
- **Network-led:** select a simple directed cycle through existing/synthetic road
  edges, with purpose-built connectors where the brief permits them. This becomes
  essential in M7; M4 reserves the graph/data interfaces.

Do not greedily choose the cheapest terrain path. Keep a small diverse beam of
partial candidates, pruning impossible remaining length/heading/clearance budgets
early. Return to an earlier sector when closure or earthworks fail, rather than
stretching the last turn to absorb every error.

### Curves, sequence intent and closure

Represent a motif with entry/exit pose, length/radius ranges, a continuous curvature
function, speed role and spatial reservation. Initial library:

- Acceleration straight → braking corner → traction exit.
- Fast sweeper and long loaded bend.
- Tightening/opening-radius corner, including double-apex variants.
- Esses with shared rhythm, and a distinct braking chicane.
- Hairpin with deliberately related approach/departure legs.
- Crest/climb/descent sequence paired with horizontal turns, not added afterward.

Use analytical straights and constant-curvature portions with smooth curvature
transitions. Solve position, tangent and curvature closure using bounded adjustments
across several free motif parameters. A biarc can initialize that solve; it cannot
be accepted with unblended curvature jumps. Keep the existing B-spline as an
alternative fitting backend only when it meets intent/deviation bounds. Exact
straights must stay straight, and fitting cannot turn one designed complex into
many tiny curvature reversals.

Validate signed curvature and width offsets, actual ribbon boundaries, minimum
separation and all intersections. Replace the fixed 100 m neighbour exclusion with
adjacency-aware geometric tests: opposite legs of a short hairpin are not ignorable
merely because they are close in lap distance. A true crossing is always rejected
unless a later explicit bridge layer authorizes it.

### Coupled horizontal/vertical design

Alternate horizontal route edits with a periodic vertical-profile solve. Minimize
weighted cut/fill and excessive curvature while meeting constraints on grade,
vertical curvature, grid/pit levels, approach visibility, tyre-path accelerations
and the chosen terrain event. Use physical distance, not a fixed number of equally
spaced elevation keys. Limit earthwork over the full road/runoff cross-section,
not just at its centreline. Reject routes whose fitting requires flattening a hill
or raising a road on an implausible embankment across a valley.

Provide a gentle default envelope and a separate deliberate terrain-challenge
envelope. Start with the existing conservative default; derive steeper allowances
from representative vehicle/crest tests. Do not make 18% a universal setting simply
because a real circuit contains it. Terrain-challenge presets still exclude cliff
roads, jumps and open hill climbs. Never flatten the entire lap as an automatic fix.

Estimate class-specific racing lines and speed using curvature, grade, banking,
available tyre force, acceleration and braking. Evaluate crest unloading,
compression, bank-change roll demand and suspension travel along both axle tyre
paths and plausible alternative lines. Use the estimate for fast screening, then
drive representative FF/FR/MR/AWD cars. Update route/elevation if it fails.

Widths follow roles: grid, passing/braking entry, narrow historic section, junction
and exit. Bank and drainage are separate profiles. Keep default straights free of
corner-banking oscillation; default corners favour neutral/beneficial camber. Reserve
bank-transition length explicitly. Deliberate adverse camber, if later enabled,
must be rare and labelled, consistent with the user's direction.

### Terrain meshing without a radial assumption

Keep the shared road/kerb surface and per-triangle materials. Replace only the
radial site-fill strategy with a world-space terrain tile/grid and constrained
triangulation around the graded corridor boundaries. Road, verge and runoff form
an explicit footprint removed from terrain triangulation. Their boundary vertices
are shared exactly with the terrain seam. There must be no hidden overlapping
terrain collider underneath the road and no gaps at chunk boundaries.

The grading field uses nearby corridor segments, not a single site centre. Where
opposite legs are close, combine their constraints deterministically; if their
heights/runoff/embankments cannot coexist, reject or reroute. A nearest-road blend
alone can create ridges and discontinuities between two legs. Infield islands,
deep concavities and several terrain regions are normal cases.

Keep chunked render/collision output, material-handle lookup and spatial queries.
Validate triangle winding, manifold boundaries, clearance and render/contact
agreement after Float32 conversion. Test a deeply folded authored route before
connecting procedural output. M3 remains an independent regression fixture.

### Selection and feedback

Separate **hard validity**, **design quality** and **portfolio diversity**. Maintain
a small Pareto set across earthwork, rhythm, site fit and facilities, rather than
letting one weighted score favour the same compromise every time. Diversity uses
rotation/translation/scale-normalized signatures and signed curvature versus lap
distance, plus straight-length distributions, direction sequences, folding,
sector speed contrast and terrain-event placement. Do not maximize any one metric.

Workbench feedback should answer: what was designed, why this land was selected,
what failed, and what changes would fix it. Add toggleable motif, curvature/speed,
elevation/grade, cut/fill, clearance/runoff and facilities overlays. Preview several
alternatives on the **same terrain seed**, with separate site/layout/style streams.
Retain failed candidates and reasons; never describe fallback delivery as native
generation success. Keep advanced controls behind a compact section.

## 4. Revised delivery sequence and acceptance

| Stage                                            | Deliverable                                                                                                        | Gate before proceeding                                                                                                                                                                                                               |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **M4-R0 — research/proposal lab**                | This research, pinned source audit, signed-chain prototype, actual v1 comparisons and reproducible portfolio       | Delivered as a research preview. Plan-view variety demonstrated; vertical failures disclosed. Not the final diversity/physics gate.                                                                                                  |
| **M4-R1 — non-radial compiler**                  | World-space terrain tiles, corridor footprint/holes, constrained seams and local grading                           | Authored folded loop, hairpin with parallel legs, multiple infield bays and hill traversal compile without holes/folds/duplicate contact surfaces. M1–M3 regressions remain green.                                                   |
| **M4-R2 — strategic layout + curve solve**       | Site feature graph, facility reservations, two proposal modes, semantic motifs and distributed closure             | Uncurated 30-seed portfolio spans compact, extended, folded, flowing and stop/start layouts. Stable radii/straight lengths after smoothing; closure cannot dominate the lap. Review maps and curvature traces, not only pass counts. |
| **M4-R3 — joint terrain/road fitting**           | Periodic constrained elevation, local route feedback, functional width/bank and speed estimates                    | Grade/crest/compression and road-edge checks pass for the chosen preset. Site influence survives fitting; cut/fill and retained natural relief are visible. Failures reroute locally rather than flatten globally.                   |
| **M4-R4 — production workbench + qualification** | v2 recipe/worker integration, alternatives, diagnostic overlays, preview/drive, safe cancellation and saved export | 1,000 attempted seeds per supported preset, native success ≥99% within a measured browser budget; fallback and failed seeds counted separately. Diversity gate plus stratified simulated laps and manual keyboard/gamepad checks.    |

The 99% target comes from the original plan and is a future acceptance target, not
a claim about the experiment. Publish seed set, generator version, rejection counts,
success/fallback/failure rates, time/memory distributions and representative/worst
layouts. Use a spatial broad phase to keep clearance testing scalable. Keep a few
known difficult seeds as permanent regression cases; do not repeatedly broaden tests
without a corresponding change or unresolved risk.

Proposed initial production scale: roughly 2–4.5 km club/touring and 4–7.5 km GP/GT
or terrain circuits, subject to the browser budget. Short variants should be designed
as short routes, not uniformly shrunk full-size tracks. Extended 8–24 km venues wait
for M7 chunk/collider/performance qualification. These are game product ranges, not
regulatory limits, and are deliberately broader than v1's current caps.

M5 begins after R3 demonstrates sound routes. Pull **space reservation** for runoff,
barriers, pits and access forward into R1–R3; leave detailed kerb policy, escape
geometry, barriers, stands and scenery rendering in M5. This avoids making an
attractive route that cannot house its own facilities. Existing simple materials
and primitive visuals remain appropriate. M6 car generation remains otherwise
unchanged and uses the same measured vehicle envelopes.

## 5. M7 changes

| Stage                                     | Scope                                                                                                                                                                                                | Specific qualification                                                                                                                                                                             |
| ----------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **M7-A — inherited networks**             | Synthetic rural-road networks, urban blocks/arterials and airfield axes; fixed-road vs new-connector provenance; closed-cycle selection, junction fitting, property exclusions, alternate/pit routes | Distinct Le Mans-like hybrid-road, Bathurst-like closed mountain-road and urban street briefs. Not replicas. Widths, inherited cambers, escapes and barriers follow the site. No open rally route. |
| **M7-B — oval and road/oval hybrids**     | Dedicated oval grammar, oval/tri-oval/asymmetric variants, lane-dependent progressive bank, apron and infield transitions                                                                            | Multi-lane contact/loads, bank-entry/exit rate, usable high/low lines, speed envelope and continuous road/oval transitions. Do not reuse the GP bank formula.                                      |
| **M7-C — endurance scale and operations** | Ordinary-circuit endurance compatibility plus separately extended venues; streamed/chunked scenery, bounded collider/query cost, branch IDs and lap variants                                         | Frame/memory benchmark on a named desktop; long-lap persistence, correct progress at nearby legs, class-specific line/speed evaluation. Timing/ghost features still belong to M8.                  |
| **M7-D — optional layered routes**        | Explicit bridge/tunnel surfaces and structure clearances, if full Suzuka-like figure-eight capability is required                                                                                    | World-space raycasts and progress/localization select the correct layer; no vertical grading merge between crossing roads; bridge entry/exit tyre-load and visibility tests.                       |

M7-D is a proposed extension, not a silent removal of the original “no racing-route
overpasses in the initial release” constraint. Reserve layer IDs now. The first
release can capture Suzuka-like sequence composition without claiming its literal
figure-eight topology. Literal racing overpasses should have their own acceptance
gate rather than delaying the non-crossing M4 redesign.

## 6. Data, compatibility and boundaries

Add explicit `DesignBrief`, `SiteGraph`, `RouteSkeleton`, `MotifInstance`,
`AlignmentSegment`, `VerticalProfile`, `CorridorFootprint`, `RouteVariant` and
`DesignReport` structures. They describe intent and provenance separately from
compiled triangles. Every station reference records whether it is horizontal
alignment distance or true 3D lap distance. Bridge layer IDs are reserved but unused
in M4. Renderers and physics keep consuming the shared compiled circuit contract.

Keep recipe v1 decoding and deterministic v1 output. Add production recipe v2 only
when R4 is ready, with independent site/layout/scenery seeds, brief and solver
version. The experiment uses `m4-study-1` and cannot be loaded by **Drive circuit**.
Export final definitions alongside recipes for durable reproduction across future
solver versions. Do not migrate or overwrite saved car tuning.

No further product clarification is necessary to begin R1. Working decisions are:
closed circuits only; sequence/site hybrid generation; simple procedural visuals;
gentle default plus deliberately qualified terrain presets; network/oval/extended
families in M7; actual racing overpasses a separate optional extension. The open
engineering questions are solver reliability, earthwork budgets and browser cost,
which the staged fixtures and qualification runs are intended to answer.
