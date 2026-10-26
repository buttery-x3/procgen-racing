# Repository working instructions

## Release and branch workflow

The user established this workflow on 26 October 2026. It applies to all future
milestones, including planning, prototypes, fixes, tests and documentation.

- `main` holds released baselines. The current baseline is `v0.3.0`, containing
  M0–M8 and the accepted synthesized driving-audio update. Preserve the M0–M8
  baseline at `v0.2.0` and the first M0–M5 baseline at `v0.1.0`.
- `development` is the shared integration and testing branch and must also exist
  on `origin`.
- Before starting a future milestone, fetch `origin`, update local `development`
  with a fast-forward, and create or reuse that milestone's own branch from it.
  Use names such as `codex/m6-car-generation`; use `codex/` for new work branches.
- Do not implement future milestone work directly on `main` or `development`.
  Keep each milestone's changes on its own branch.
- On completion, run the relevant checks, update the documentation, commit and
  push the milestone branch, merge it into `development`, and push `development`
  to `origin` for the user's testing. The user has already authorized this normal
  completion workflow; do not stop merely to request permission to push it.
- A request to implement or complete a milestone does not authorize promotion to
  `main`. Update `main` only when the user explicitly requests a release/promotion.
- Preserve existing user changes and remote history. Do not force-push shared
  branches. If the remote has advanced, fetch and reconcile before pushing.
- Report the completed milestone branch, development commit and validation. Keep
  milestone branches available for comparison unless the user requests cleanup.

The full workflow and command examples are in [docs/workflow.md](docs/workflow.md).
Historical milestone notes and qualification reports do not override this policy.

## Project checks

- Browser app: TypeScript, Three.js, Rapier and Vite.
- For each feature/fix commit, run only targeted checks relevant to the changed
  behavior and its directly affected integrations. Do not run the full regression
  suite for every feature, tuning iteration, documentation change or merge into
  `development`. Documentation-only commits need content/link/diff checks.
- Before merging/promoting a release into `main`, run
  `npm test -- --maxWorkers=2` and `npm run build` on the release candidate.
  During development use type checking/builds when the change affects code,
  assets or build integration and warrants them. In PowerShell use `npm.cmd` if
  the script execution policy blocks `npm`.
- Choose validation scope from the diff. Reuse recorded evidence for unchanged
  subsystems, retaining its original commit/hash and limitations. Rerun affected
  checks after meaningful changes, failures or integration conflicts; do not
  repeat successful checks just to refresh a broad report fingerprint. Publishing
  a new complete qualification report is separate from validating a targeted
  commit; never relabel old results as a fresh run. See [docs/workflow.md](docs/workflow.md).
- Run generation qualification when changing generation/construction behavior;
  preserve the reported source hash and measurement scope. See
  [docs/m5.md](docs/m5.md) for venue campaigns and [docs/m6.md](docs/m6.md) for
  procedural car/workbench qualification. For car construction changes run
  `npm run qualify:m6 -- --count=1000 --driving`; keep its report in
  `docs/research/m6-qualification.json` with the tested source hash.
  M7 track changes use `npm run qualify:m7 -- --count=1000 --construction=32`,
  `npm run qualify:m7:driving` and the visible browser benchmark; publish matching
  evidence with `npm run report:m7`. See [docs/m7.md](docs/m7.md) for scope and
  reproduction, including the distinction between planning and full construction.
  Historical M4/M5/M6 reports remain evidence for those implementations.
- M8 session/presentation changes use `npm run qualify:m8`,
  `npm run qualify:m8:stress` and the visible browser session/renderer checks;
  publish source-matching evidence with `npm run report:m8`. See [docs/m8.md](docs/m8.md).
  Restart the development server after physics/race code edits so its compatibility
  fingerprint matches the current source. Historical generation reports retain
  their original hashes; session-only changes do not require regenerating them.
- Keep installed dependencies, build output and local screenshots/traces out of
  commits according to `.gitignore`.

- For audio changes, select the affected voice/control tests and short native
  renders from `npm run qualify:audio` and `audio-lab.html`. Use lifecycle/channel
  checks only when their behavior changes, and the `audio-driving.html` sequence
  when driving integration changes. Timbre tuning starts with short A/B listening
  comparisons, reusing the established channel/runtime foundation. The 20-minute stress
  run is not a required check; run it only when the user explicitly requests it.
  Publish source-matching evidence with
  `npm run report:audio` only when a new complete audio qualification is needed;
  see [docs/audio.md](docs/audio.md) and the [timbre research](docs/research/audio-timbre.md).
  Audio-only changes retain M8 and historical generation evidence. Changes to
  physics, races or construction require their own relevant scope. The full
  regression suite is required before promotion to `main`, not per audio commit.
