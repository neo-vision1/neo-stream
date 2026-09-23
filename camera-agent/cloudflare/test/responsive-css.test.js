import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const css = await readFile(new URL("../public/style.css", import.meta.url), "utf8");

test("mobile landscape grid uses the full workspace without PTZ", () => {
  assert.match(css, /orientation:landscape/);
  assert.match(css, /html\[data-view-mode=grid\] \.control-card\{display:none\}/);
  assert.match(css, /html\[data-view-mode=grid\] \.workspace\{display:grid;grid-template-columns:1fr/);
});

test("mobile landscape grid expands from two to four columns", () => {
  assert.match(css, /grid-camera:nth-child\(5\).*repeat\(3/);
  assert.match(css, /grid-camera:nth-child\(10\).*repeat\(4/);
});
