import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { observeModeChoices } from "./helpers/render_mode_choice_harness.mjs";

// Exact retained production methods and actual button callbacks execute under
// two explicit adapters. This does not claim native React event scheduling.
const result = observeModeChoices(readFileSync(new URL("../index.js", import.meta.url), "utf8"));
for (const scenario of result.cases) {
  test(`render mode choice: ${scenario.id}`, () => {
    // Match the oracle's value comparison across the VM realm. Lyric array
    // identity is checked inside the fixture before results are recorded.
    for (const check of scenario.checks) {
      assert.equal(JSON.stringify(check.actual), JSON.stringify(check.expected), check.id);
    }
  });
}
