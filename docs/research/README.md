# Research and qualification records

The [release and milestone workflow](../workflow.md) applies to this directory.
`main` holds the `v0.3.0` driving-audio baseline over M0–M8; `v0.2.0` preserves
M0–M8 and `v0.1.0` preserves M0–M5. Work for each
future milestone belongs on its own branch from `development`, then is merged and
pushed to remote `development` on completion for testing. Later promotion to `main` requires an
explicit release request.

The Markdown research, HTML portfolios/benchmarks, SVG plots and JSON qualification
records document circuit-design decisions and measured results. Historical source
hashes and measurements identify the implementation actually tested; do not rewrite
them merely because a newer milestone or release exists.

- [Circuit research](circuit-design.md)
- [Current UI and workbench analysis](ui-workbench-analysis.md): feature inventory,
  measured vertical layout, duplicate controls/data paths, and a conservative
  organization proposal informed by the owner's teaching and exploration goals;
  analysis only, with no UI implementation
- [First-pass workbench implementation plan](../ui-workbench-first-pass-plan.md):
  compact toolbar, collapsible panels, reliability consolidation and six category
  presets with seeded car/track exploration; see the
  [implemented first-pass delivery](../ui-workbench-first-pass.md) for measurements
  and validation
- [First-pass category qualification](ui-workbench-qualification.json),
  [detailed UI evidence](ui-workbench-browser-qa.json) and
  [short native audio handoff](ui-workbench-audio-driving.json); each retains its
  actual source hash and scope, alongside the updated M8 development reports
- [Synthesized driving audio research and implementation plan](audio-system.md)
  with [native audio qualification](audio-qualification.json) and
  [actual-app driving qualification](audio-driving-qualification.json), plus
  [the loop-fix native regression export](audio-loop-regression.json)
- [Audio sound-quality research and playground proposal](audio-timbre.md):
  engine pulse/exhaust modeling, tyre friction texture, short A/B authoring and
  targeted validation while preserving the existing audio foundation
- [M4 portfolio](m4-v2-portfolio.html) and [qualification](m4-v2-qualification.json)
- [M5 construction qualification](m5-qualification.json) and
  [browser measurements](m5-browser-budget.json)
- [M6 car construction and full-lap qualification](m6-qualification.json)
- [M7 network/oval/endurance qualification](m7-qualification.json),
  [full laps](m7-driving.json), [desktop benchmark](m7-desktop-benchmark.json)
  and [35-seed portfolio](m7-portfolio.html)
- [M8 timed laps and ghosts](m8-qualification.json),
  [desktop renderer/session benchmark](m8-desktop-benchmark.json),
  [browser integration](m8-browser-qa.json) and [three-instance CPU sample](m8-stress.json)

Generate updated evidence on the relevant milestone branch and include it in that
milestone's integration into `development`. The [M8 notes](../m8.md), [M7 notes](../m7.md), [M6 notes](../m6.md), [M5 notes](../m5.md) and
[M4 notes](../m4-v2.md) describe the reproducing commands and measurement limits.
