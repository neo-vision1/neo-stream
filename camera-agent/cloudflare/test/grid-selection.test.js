import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const html = await readFile(new URL("../public/index.html", import.meta.url), "utf8");
const app = await readFile(new URL("../public/app.js", import.meta.url), "utf8");

test("offers bulk and individual grid selection", () => {
  assert.match(html, /id="selectAllGrid"[^>]*>Marcar todos</);
  assert.match(html, /id="clearGrid"[^>]*>Desmarcar todos</);
  assert.match(app, /function selectAllGrid\(\)/);
  assert.match(app, /availableIds\.slice\(0, limit\)/);
  assert.match(app, /toggleGridCamera\(camera\.id\)/);
});

test("shows bulk controls only while building a grid", () => {
  assert.match(app, /elements\.selectAllGrid\.hidden = mode !== "grid"/);
  assert.match(app, /elements\.clearGrid\.hidden = mode !== "grid"/);
});
