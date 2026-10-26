# Research and qualification records

The [release and milestone workflow](../workflow.md) applies to this directory.
`main` holds the `v0.1.0` M0–M5 baseline. Work for each future milestone belongs
on its own branch from `development`, then is merged and pushed to remote
`development` on completion for testing. Later promotion to `main` requires an
explicit release request.

The Markdown research, HTML portfolios/benchmarks, SVG plots and JSON qualification
records document circuit-design decisions and measured results. Historical source
hashes and measurements identify the implementation actually tested; do not rewrite
them merely because a newer milestone or release exists.

- [Circuit research](circuit-design.md)
- [M4 portfolio](m4-v2-portfolio.html) and [qualification](m4-v2-qualification.json)
- [M5 construction qualification](m5-qualification.json) and
  [browser measurements](m5-browser-budget.json)
- [M6 car construction and full-lap qualification](m6-qualification.json)

Generate updated evidence on the relevant milestone branch and include it in that
milestone's integration into `development`. The [M6 notes](../m6.md), [M5 notes](../m5.md) and
[M4 notes](../m4-v2.md) describe the reproducing commands and measurement limits.
