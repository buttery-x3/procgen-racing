# Remove recording comparisons before the audio release

27 October 2026. The owner accepted the integrated sounds for a versioned release
and requested a new commit on `codex/reference-audio-integration` removing source
and comparison recordings before promotion.

No WAV or other recorded-audio asset was tracked in Git. The earlier development
comparison used ignored local files. This cleanup removes its page, player,
styles, fixed-file serving middleware and the playground's recorded-reference
button. The local source/reference, reconstructed, frozen and previous-playground
WAV copies and generated comparison renders are removed from the repository's
ignored artifact folders. Historical measurements, plots and analysis code remain
as research records. The supplied originals in Documents are outside the branch.

The continuous tyre synthesizer, accepted tuning and engine DSP remain intact.
The accepted numerical model now lives at `public/audio/tyre-control-v1.json`, so
normal builds and the live playground load it as a static asset without a local
recording or preparation endpoint. Its exact bytes match the accepted model:
`0f640d311e0f7c9297bb30b9784880553ac67275b433705b9629b291d6ec6082`.
The stable model ID and saved preset format are retained.

This is procedural rendering informed by a reference-derived parameter model,
not an independently authored model or a recording loop. The
[provenance record](audio-model-provenance.json) describes that distinction and
does not assert a source licence or a fair-use conclusion. The release contains
synthesis code and these numerical parameters; it contains no source/comparison
recordings. The next release branch carries this cleanup before promotion.

Seven targeted asset/adapter tests and strict TypeScript checking passed. The
asset check loads and synthesizes from the committed model, confirms its accepted
hash, and verifies that public assets contain no recorded-audio files or retired
comparison player. Release regression/build checks follow on the versioned candidate.
