# Source-preserving lyric word ranges

## Confirmed failure

On baseline `b5348457346396776fcdecedd03feeb3133e2503`, the ordinary French
line `Bonjour ! Comment ça va ?` yields manufactured tokens `Bonjour!` and
`va?`. Neither occurs in the source. Searching the complete line for those
tokens silently drops their ranges, leaving only `Comment` and `ça`.

The same source mismatch affects the unchanged consumers:

- Pages leaves the first and last words without derived karaoke word indexes
- SyncDataCreator merges four intended words into two recording/timing units,
  and preserves that incorrect grouping in compact export
- Utils reconstructs `Comment ça va ?` and requests `Comment｜ça va ?`, losing
  the leading word from pronunciation input

ASCII spaces, NBSP, and narrow NBSP reproduce the same defect. Original lyric
data and displayed glyphs are retained; this is not a claim that plain lyrics
are deleted. It affects word-derived timing/alignment and pronunciation input.

## Repair and ownership rules

`LyricsWordSegmenter.js` now retains original UTF-16 start/end positions while
scanning graphemes. It aligns unchanged lexical tokenizer surfaces within each
lexical run before attaching punctuation. Both public APIs derive from those
same spans; every returned text is built with `source.slice(start, end)`.

- Closing punctuation extends the preceding span, including the literal gap:
  `hello ! world` becomes `hello !` and `world`
- An opener and its pending punctuation cluster attach to the next unit:
  `foo ( ! bar` becomes `foo` and `( ! bar`; `hello () world` becomes `hello`
  and `() world`. Punctuation never reaches backward across a pending opener
- A final dangling cluster extends the last span, or forms one span when no
  previous unit exists: `hello ( !` and `( ! )` each remain one exact slice
- Inter-unit whitespace can remain outside spans; whitespace inside attached
  punctuation remains literal, including nonbreaking variants

No consumer, locale selection, Japanese grouping, Chinese splitting, timing
format, or tokenizer interface changed.

### Explicit coverage adjustments

Filtered lexical tokenization can omit material inside a run. Such material
now belongs to the preceding lexical span, with leading material belonging to
the first span. Existing lexical boundaries and word count are retained:

- `sing-along forever`: `sing`, `along`, `forever` becomes `sing-`, `along`,
  `forever` (three units)
- `hi👨‍👩‍👧‍👦world`: `hi`, `world` becomes `hi👨‍👩‍👧‍👦`, `world` (two units)
- Leading or trailing ZWJ emoji similarly remain in the existing neighboring
  lexical span; they do not add a punctuation/emoji-only timing step
- A nonempty lexical run with no returned words is kept intact. In explicit
  Chinese locale, standalone `👨‍👩‍👧‍👦` changes from zero spans to one

These are source-coverage adjustments, separate from the French punctuation
defect. The existing standalone-symbol scan remains unchanged; for example,
`hi😀world` still has three units.

The shipped Japanese tokenizer can cut inside a grapheme. Only those cuts are
coalesced; every existing cut at a real grapheme boundary remains:

- Japanese `𠀀の世界`: baseline surfaces `\ud840`, `\udc00`, `の`, `世界`
  (four) become `𠀀`, `の`, `世界` (three)
- Japanese `👨‍👩‍👧‍👦`: baseline surfaces `\ud83d`, `\udc68`, `‍\ud83d`,
  `\udc69`, `‍\ud83d`, `\udc67`, `‍\ud83d`, `\udc66` (eight) become the
  one complete grapheme

Ordinary Japanese morphology, mixed scripts, Chinese protected words/aspect
splits, Thai, contractions, and adjacent punctuation retain pinned baseline
outputs. This does not introduce a different morphology algorithm.

## Regression evidence

`tests/lyrics_word_source_ranges.test.mjs` executes the actual segmenter and
unchanged source slices from Pages, SyncDataCreator, and Utils in an inert VM.
The same tests can target another checkout with `IVLYRICS_SOURCE_DIR`.

The 58 fixtures each independently test four surfaces: exact ranges and source
coverage at grapheme boundaries; actual Pages word indexes with glyph/timing
retention; actual creator ranges, collapse, compact encode/decode; and actual
Utils reconstruction and request content. Three additional tests cover French
reply alignment, explicit source-word bypass, and a valid Japanese tokenizer
seam. These are 235 assertions/tests across one shared defect and explicit
coverage adjustments, not 235 independent product defects.

- RED, before changing production: 235 tests executed, 94 passed / 141 failed
- GREEN, same 235 tests plus the 8 existing inline-pronunciation tests:
  243 passed / 0 failed
- `node scripts/check.mjs`: bundle/manifest, shell syntax, version checks, and
  all 1,656 tests passed on Node v24.19.0 / ICU 78.3
- `git diff --check`: passed

The new tests do not execute application initialization, provider requests,
storage, or installer entrypoints. Existing full-gate installer regressions
use isolated fixtures and inert application collaborators. No live Spotify UI,
browser, provider integration, real installation, or user IndexedDB was used.
Malformed custom-tokenizer records and invalid locales are outside the defect
claim. An unalignable custom surface defensively preserves its lexical run;
this is not presented as a separately established product defect.
