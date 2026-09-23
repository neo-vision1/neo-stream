import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const css = await readFile(new URL("../public/style.css", import.meta.url), "utf8");
const app = await readFile(new URL("../public/app.js", import.meta.url), "utf8");

test("mobile landscape grid separates videos from the camera rail", () => {
  assert.match(css, /orientation:landscape/);
  assert.match(css, /html\[data-view-mode=grid\] \.control-card\{display:none\}/);
  assert.match(css, /html\[data-view-mode=grid\] \.viewer-card\{position:fixed/);
  assert.match(css, /html\[data-view-mode=grid\] \.camera-panel\{position:fixed;z-index:40/);
  assert.match(css, /safe-area-inset-bottom/);
});

test("mobile landscape columns do not depend on the CSS has selector", () => {
  assert.match(app, /gridViewer\.dataset\.count = String\(gridCameraIds\.length\)/);
  assert.match(css, /grid-viewer\[data-count="5"\].*repeat\(3/);
  assert.match(css, /grid-viewer\[data-count="10"\].*repeat\(4/);
  assert.match(css, /touch-action:pan-x/);
});
