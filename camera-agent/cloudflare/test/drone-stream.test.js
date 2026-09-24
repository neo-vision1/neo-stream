import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const cameras = await readFile(new URL("../public/cameras.js", import.meta.url), "utf8");
const html = await readFile(new URL("../public/index.html", import.meta.url), "utf8");
const app = await readFile(new URL("../public/app.js", import.meta.url), "utf8");
const settings = await readFile(new URL("../public/settings.js", import.meta.url), "utf8");
const css = await readFile(new URL("../public/style.css", import.meta.url), "utf8");

test("registers the drone Mux playback as a public viewing source", () => {
  assert.match(cameras, /NEO_VISION_DRONES/);
  assert.match(cameras, /id: "DRONE01"/);
  assert.match(cameras, /6yyL2zXWiFUszbR2VJ9KlhGo73CBvm00fohNSz00blGCc/);
});

test("offers camera and drone source tabs", () => {
  assert.match(html, /data-source-filter="camera"/);
  assert.match(html, /data-source-filter="drone"/);
  assert.match(app, /const streamSources = \[\.\.\.cameras, \.\.\.drones\]/);
});

test("allows the drone and cameras in the same persisted grid", () => {
  assert.match(app, /streamSources\.find\(\(item\) => item\.id === cameraId\)/);
  assert.match(settings, /ALL_SOURCE_IDS = \[\.\.\.ALL_CAMERA_IDS, "DRONE01"\]/);
  assert.match(settings, /ALL_SOURCE_IDS\.includes\(id\)/);
});

test("controls drone access and name with the same administration model", () => {
  assert.match(app, /streamSources\.filter\(\(camera\) => allowed\.has\(camera\.id\)\)/);
  assert.match(app, /streamSources\.map\(\(camera\) =>/);
  assert.match(settings, /ALL_SOURCE_IDS\.filter\(\(cameraId\)/);
});

test("keeps the mobile source selector outside the video area", () => {
  assert.match(css, /inset:0 0 calc\(92px \+ env\(safe-area-inset-bottom,0px\)\)/);
  assert.match(css, /source-tabs/);
});
