import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

const source = readFileSync(new URL("../Utils.js", import.meta.url), "utf8");
const start = source.indexOf("  _officialVideoNormalize(value) {");
const end = source.indexOf("  /**\n   * YouTube 영상 제목 가져오기 (oEmbed API 사용)");
assert.ok(start > 0 && end > start, "official video helpers must stay in Utils.js");

const context = vm.createContext({ window: {}, fetch: async () => { throw new Error("no network in tests"); } });
vm.runInContext(
  "globalThis.__officialVideo = {\n" +
    source.slice(start, end).trimEnd().replace(/,$/, "") +
    ",\n  extractYouTubeVideoId(url) { const m = String(url || '').match(/[?&]v=([a-zA-Z0-9_-]{11})/); return m ? m[1] : null; }\n};",
  context
);
const U = context.__officialVideo;

const candidate = (title, channel, extra = {}) => ({
  videoId: "aaaaaaaaaaa",
  title,
  channel,
  verified: extra.verified ?? true,
  duration: extra.duration ?? 200,
});
const meta = { trackName: "Bloody Mary", artists: ["Lady Gaga"], durationSec: 200 };

test("matches an artist's own channel, VEVO and Topic uploads", () => {
  assert.equal(U.isOfficialArtistChannel("Lady Gaga", ["Lady Gaga"]), true);
  assert.equal(U.isOfficialArtistChannel("LadyGagaVEVO", ["Lady Gaga"]), true);
  assert.equal(U.isOfficialArtistChannel("Lady Gaga - Topic", ["Lady Gaga"]), true);
  assert.equal(U.isOfficialArtistChannel("IU Official", ["IU"]), true);
});

test("rejects fan channels and names that merely contain the artist's letters", () => {
  assert.equal(U.isOfficialArtistChannel("Joanne ♪", ["Lady Gaga"]), false);
  assert.equal(U.isOfficialArtistChannel("Ruben Samuel Cortez", ["Lady Gaga"]), false);
  // "genius official" contains the letters of "IU" but not the word.
  assert.equal(U.isOfficialArtistChannel("Genius Official", ["IU"]), false);
  assert.equal(U.isArtistNamedChannel("Genius Official", ["IU"]), false);
  assert.equal(U.isArtistNamedChannel("ROSÉ and Bruno Mars", ["ROSÉ"]), true);
});

test("requires the track title as whole words, not as a substring", () => {
  assert.equal(U.containsNormalizedPhrase("no matter what", "TT"), false);
  assert.equal(U.containsNormalizedPhrase("TWICE - TT (Official MV)", "TT"), true);
  assert.equal(
    U.scoreYouTubeCandidate(candidate("Some Other Song (Official Music Video)", "Lady Gaga"), meta),
    -Infinity
  );
});

test("recognises official video titles including the K-pop M/V spelling", () => {
  assert.equal(U.hasOfficialVideoTitle("Lady Gaga - Bloody Mary (Official Music Video)"), true);
  assert.equal(U.hasOfficialVideoTitle("BTS (방탄소년단) 'Dynamite' Official MV"), true);
  assert.equal(U.hasOfficialVideoTitle("Lady Gaga - Bloody Mary (Official Audio)"), false);
  assert.equal(U.hasMusicVideoTitle("아이유(IU) _ 밤편지 M/V"), true);
  assert.equal(U.hasMusicVideoTitle("Bloody Mary live at the Grammys"), false);
});

test("treats audio-only and Topic uploads as unusable backgrounds", () => {
  assert.equal(U.isAudioOnlyUpload(candidate("Lady Gaga - Bloody Mary (Official Audio)", "Lady Gaga")), true);
  assert.equal(U.isAudioOnlyUpload(candidate("Bloody Mary", "Lady Gaga - Topic")), true);
  assert.equal(U.isAudioOnlyUpload(candidate("Lady Gaga - Bloody Mary (Official Music Video)", "Lady Gaga")), false);
});

test("scores the artist's official music video above derivatives and fan uploads", () => {
  const official = U.scoreYouTubeCandidate(candidate("Lady Gaga - Bloody Mary (Official Music Video)", "Lady Gaga"), meta);
  const choreography = U.scoreYouTubeCandidate(candidate("Lady Gaga - Bloody Mary (Official Music Video) (Choreography ver.)", "Lady Gaga"), meta);
  const stageCam = U.scoreYouTubeCandidate(candidate("Lady Gaga - Bloody Mary Stage Cam @ Awards", "Lady Gaga"), meta);
  const fan = U.scoreYouTubeCandidate(candidate("Lady Gaga - Bloody Mary (Official Music Video)", "Joanne ♪", { verified: false }), meta);
  assert.ok(official > choreography, "main cut must beat the choreography version");
  assert.ok(official > stageCam, "main cut must beat a stage cam");
  assert.ok(official > fan, "official channel must beat a fan upload");
});

test("penalises a duration far from the track length", () => {
  const close = U.scoreYouTubeCandidate(candidate("Lady Gaga - Bloody Mary (Official Music Video)", "Lady Gaga", { duration: 205 }), meta);
  const far = U.scoreYouTubeCandidate(candidate("Lady Gaga - Bloody Mary (Official Music Video)", "Lady Gaga", { duration: 900 }), meta);
  assert.ok(close > far);
});

test("keeps the original pick when nothing can be searched", async () => {
  const info = { youtubeVideoId: "bbbbbbbbbbb", youtubeTitle: "server pick" };
  const result = await U.preferOfficialYouTubeVideo(info, meta);
  assert.equal(result.youtubeVideoId, "bbbbbbbbbbb");
  assert.equal(result.officialChecked, true);
});

test("returns the input untouched without a video id or metadata", async () => {
  assert.deepEqual(await U.preferOfficialYouTubeVideo({}, meta), {});
  const info = { youtubeVideoId: "ccccccccccc" };
  assert.deepEqual(await U.preferOfficialYouTubeVideo(info, { trackName: "", artists: [] }), info);
});
