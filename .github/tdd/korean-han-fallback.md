# Korean Han-script lyric fallback

The user requested that Chinese-script lyrics for a Korean song remain the last
available choice. The journey came from the current LRCLIB incident, without a
separate plan file.

## Behavior

- For a Hangul-titled track, lyrics dominated by Han letters with no Hangul or
  Japanese kana are deferred behind ordinary lyrics and Korean romanization.
- Both provider-first and type-first selection apply this rule after loading a
  provider, including cached results. Character timing does not bypass it.
- When every ordinary result is unavailable, the best deferred result remains
  usable. Equal ranks retain the existing provider/type order.
- Explicit provider selection stays restricted to that provider.
- Artist nationality is not inferred. An English-only title does not establish
  Korean language, and a translated Korean title may still be a false positive.
  This is a conservative script heuristic, not audio-language detection.

## Evidence

- RED: `node --test tests/korean_han_fallback.test.mjs` executed 13 tests;
  7 failed because Han lyrics won or later providers were not tried.
- GREEN: `node --test tests/korean_han_fallback.test.mjs tests/romanized_korean_fallback.test.mjs`
  passed all 18 tests using the actual manager and cache/provider fixtures.
- `node scripts/check.mjs` passed bundle/manifest/release checks and all 304 tests.
- V8 coverage from the focused tests executed all recorded ranges for the new
  `getLyricsFallbackPriority` (11/11) and `deferFallback` (6/6) functions.
  This is scoped changed-function coverage, not repository-wide coverage.
- `git diff --check` passed before committing.

The currently running Spotify application has not been updated or verified with
this change. No cache data was deleted and no provider-side entry was modified.
