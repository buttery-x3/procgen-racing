# Release and milestone workflow

Established by the project owner on **26 October 2026**. This policy applies to
every future milestone and to all project documentation, including archived notes
and generated research reports. [AGENTS.md](../AGENTS.md) carries the same
instructions for coding agents.

## Branch roles

| Branch or tag                                              | Purpose                                                                          |
| ---------------------------------------------------------- | -------------------------------------------------------------------------------- |
| `main`                                                     | Released baseline, updated only on an explicit release/promotion request.        |
| `v0.1.0`                                                   | First baseline release: the implemented M0–M5 browser sandbox.                   |
| `development` / `origin/development`                       | Shared integration branch pushed to the remote for testing completed milestones. |
| `codex/m6-car-generation`, `codex/m7-track-families`, etc. | A separate branch for each future milestone, created from current `development`. |

The first baseline initializes both `main` and `development` at the same commit.
Future milestone work, including its planning, prototypes, fixes, tests and docs,
must take place in its own branch. Do not implement milestones directly on either
shared branch. Follow-up fixes should use the relevant milestone branch or a
dedicated fix branch from `development`, then follow the same testing workflow.

## Starting a milestone

Check for local changes first and preserve them. Fetch remote state and update
`development` before branching. For example:

```sh
git status --short
git fetch origin
git switch development
git pull --ff-only origin development
git switch -c codex/m6-car-generation
git push -u origin codex/m6-car-generation
```

Reuse an existing branch for the same milestone when continuing its work. Each
later milestone receives its own branch; do not continue the next milestone on
the previous milestone's branch.

## Completing a milestone for testing

1. Complete the work and relevant checks, including the production build. Update
   the milestone notes, README, implementation plan and qualification evidence as
   appropriate. Record known limitations and what was actually verified.
2. Commit and push the milestone branch to `origin`.
3. Fetch current remote state, update `development`, and merge the completed
   milestone into it. Resolve any integration issues and rerun affected checks.
4. Push `development` to `origin` so the user can test the completed milestone.
5. Report the milestone branch, development commit and validation results. Keep
   the milestone branch available for comparison.

For a completed, committed M6 branch, the integration commands are:

```sh
git push origin codex/m6-car-generation
git fetch origin
git switch development
git pull --ff-only origin development
git merge --no-ff codex/m6-car-generation -m "Integrate M6 for development testing"
git push origin development
```

The project owner has authorized these completion pushes. Routine completion
does not need another permission request. Do not force-push shared branches or
overwrite unrelated changes. If remote history advances, fetch and reconcile it.
If repository protections require a pull request, use that integration path and
report any concrete block; do not bypass protection.

## Promoting a release

`development` is the testing destination. Completion of a milestone does not
automatically promote it to `main`. On an explicit release request, verify the
tested development state, update release notes/version as needed, promote that
state to `main`, and push the requested release/tag. Preserve the previous
baseline tags.

The **v0.1.0 baseline** is described in [release notes](releases/v0.1.0.md).
M6 procedural cars and the full workbench are delivered through
`codex/m6-car-generation` into `development` for testing. M7 onward remain planned;
the baseline does not claim the complete M8 time-trial release scope. See the
[M6 delivery notes](m6.md).
