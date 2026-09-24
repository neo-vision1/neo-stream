import test from "node:test";
import assert from "node:assert/strict";
import { effectiveGridLimit, isAtLiveEdge, normalizeGridLimit, selectWithinLimit } from "../public/ui-policy.js";

test("normalizes only supported camera limits", () => {
  assert.equal(normalizeGridLimit(6), 6);
  assert.equal(normalizeGridLimit(7), 4);
});

test("uses the strictest system and profile limit", () => {
  assert.equal(effectiveGridLimit(9, 4), 4);
  assert.equal(effectiveGridLimit(2, 11), 2);
  assert.equal(effectiveGridLimit(12, 12), 12);
});

test("does not select cameras beyond the administrative limit", () => {
  assert.deepEqual(selectWithinLimit(["CAM01", "CAM02"], "CAM03", 2), ["CAM01", "CAM02"]);
  assert.deepEqual(selectWithinLimit(["CAM01"], "CAM01", 2), []);
});

test("classifies the live edge using the configured tolerance", () => {
  assert.equal(isAtLiveEdge(5), true);
  assert.equal(isAtLiveEdge(12), false);
  assert.equal(isAtLiveEdge(null), false);
});
