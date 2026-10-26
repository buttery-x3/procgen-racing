# Repository working instructions

## Release and branch workflow

The user established this workflow on 26 October 2026. It applies to all future
milestones, including planning, prototypes, fixes, tests and documentation.

- `main` holds released baselines. The current baseline is `v0.2.0`, containing
  M0–M8 and the tyre-feedback sensitivity fix. Preserve the first M0–M5 baseline
  at `v0.1.0`.
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
- Run `npm test -- --maxWorkers=2` for the full regression suite and `npm run build`
  for strict TypeScript checking and the production build. In PowerShell use
  `npm.cmd` if the script execution policy blocks `npm`.
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
