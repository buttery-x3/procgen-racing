# Release and milestone workflow

Established by the project owner on **26 October 2026**. This policy applies to
every future milestone and to all project documentation, including archived notes
and generated research reports. [AGENTS.md](../AGENTS.md) carries the same
instructions for coding agents.

## Branch roles

| Branch or tag                                              | Purpose                                                                          |
| ---------------------------------------------------------- | -------------------------------------------------------------------------------- |
| `main`                                                     | Released baseline, updated only on an explicit release/promotion request.        |
| `v0.3.0`                                                   | Current baseline release: accepted synthesized driving-audio update over M0–M8. |
| `v0.2.0`                                                   | Preserved solo baseline: M0–M8, including the tyre-feedback sensitivity fix.    |
| `v0.1.0`                                                   | First baseline release: the implemented M0–M5 browser sandbox.                   |
| `development` / `origin/development`                       | Shared integration branch pushed to the remote for testing completed milestones. |
| `codex/m6-car-generation`, `codex/m7-track-families`, etc. | A separate branch for each future milestone, created from current `development`. |

The first baseline initialized both `main` and `development` at the same commit.
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

1. Complete the work and targeted checks relevant to the commit, using the scope
   policy below. Build when code/assets/build integration warrant it. Update
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

Before merging/promoting into `main`, run the full regression suite
(`npm test -- --maxWorkers=2`) and strict TypeScript/production build
(`npm run build`) on the release candidate, plus qualification relevant to the
changed subsystems. Record the tested commit and results. If integration changes
executable content, validate the affected result before promotion; a merge that
preserves the already tested tree does not require a duplicate run.

`development` is the testing destination. Completion of a milestone does not
automatically promote it to `main`. On an explicit release request, verify the
tested development state, update release notes/version as needed, promote that
state to `main`, and push the requested release/tag. Preserve the previous
baseline tags. Prepare version/docs changes on a dedicated `codex/release-<version>`
branch from current `development`, run the relevant checks, commit and push that
branch, then integrate it into `development`. Fast-forward `main` to the validated
development commit when its history permits; otherwise preserve both histories
with a merge and validate the result. Create an annotated version tag on the exact
released `main` commit and push both refs. Synchronize `development` with that
release commit so future milestone branches include its version and notes. Do not
move an existing release tag.

## Validation scope — revised 26 October 2026

The owner requested targeted validation for each development commit, with the
full regression suite reserved as required work before merging into `main`.
This supersedes older blanket instructions in milestone plans to run all tests
at each feature completion. Existing milestone qualification procedures still
apply when their generation, construction or session behavior changes; unrelated
features do not invalidate those records.

| Change | Relevant development checks |
| --- | --- |
| Research, documentation or policy only | Review content, local links and `git diff --check`; no application tests/build. |
| Audio preset or voice timbre | Short level-matched listening comparisons, affected voice tests and short native renders for changed DSP; no whole-app regression or channel recertification. |
| Audio telemetry/control mapping | Affected control/collector tests and the relevant short replay/driving scenario. |
| Audio context, routing or source lifecycle | Affected lifecycle/channel tests and a short native-browser check of the changed boundary. |
| Other feature or fix | Tests for changed behavior and direct dependants; focused UI/integration checks, type checking/build as applicable. |
| Release candidate for `main` | Full regression suite and production build, plus relevant subsystem qualification. |

State the chosen scope before running checks. Once they pass, proceed to commit
and integration. Repeat only when a subsequent meaningful change, failure or
merge conflict affects the checked behavior. Do not use a broad hash change,
new report formatting or documentation edit as a reason to restart successful
tests. Do not add tests that merely restate a tuning constant.

Keep baseline evidence attached to the source and environment actually measured.
A targeted result may reference that baseline and describe its changed scope;
it must not claim a new full qualification. If a publisher requires a complete
fresh report, preserve targeted evidence separately until that report is needed;
do not fabricate missing stages or bypass its validity checks.

The audio 20-minute endurance run remains excluded from required checks,
including release checks, and runs only on explicit user request. Existing
channel/runtime evidence is the audio foundation; changes to the sound sources
do not by themselves require repeating the spatial-recognition study. Short
listening review of the new timbre and masking remains distinct from routing
correctness. See [audio sound-quality research](research/audio-timbre.md).

## Released baselines

The current **v0.3.0 audio update** promotes the accepted driving sounds and
the owner's requested recording cleanup. The release packages synthesis code
and the accepted numerical tyre model, with no source/comparison recordings.
See [v0.3.0 release notes](releases/v0.3.0.md).

The preserved **v0.2.0 baseline** promotes the user-approved M8 development state
`c885073` plus release metadata/documentation and fresh release checks. It includes
M0–M8, the tyre-feedback sensitivity fix, and the documentation-only audio proposal.
See [v0.2.0 release notes](releases/v0.2.0.md). The first **v0.1.0 M0–M5 baseline**
remains available at its original tag and [release notes](releases/v0.1.0.md).

M6, M7 and M8 were developed on `codex/m6-car-generation`,
`codex/m7-track-families` and `codex/m8-solo-sessions`, then tested on
`development`. These branches and `codex/m8-tyre-feedback-sensitivity` remain
available for comparison. Future work continues to use its own branches and
`development` testing before another explicitly requested release. See the
[M6 delivery notes](m6.md), [M7 delivery notes](m7.md) and [M8 delivery notes](m8.md).

## Separate synthesized-audio feature

The audio implementation follows completed M8 on
`codex/synthesized-driving-audio`, starting from current development and
integrating back into development for testing. M8 remains complete in v0.2.0;
this feature does not amend that older release. The owner explicitly authorized
the separate v0.3.0 audio promotion on 27 October 2026.
Its own [delivery notes](audio.md) and source-matching audio qualification are
separate from M8 and generation reports.
