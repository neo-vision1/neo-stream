import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const auth = await readFile(new URL("../public/auth.js", import.meta.url), "utf8");
const alerts = await readFile(new URL("../public/alerts.js", import.meta.url), "utf8");
const html = await readFile(new URL("../public/index.html", import.meta.url), "utf8");
const worker = await readFile(new URL("../src/index.js", import.meta.url), "utf8");
const schema = await readFile(new URL("../supabase-test-schema.sql", import.meta.url), "utf8");

test("replays an existing session to show admin controls immediately", () => {
  assert.match(auth, /if \(currentSession\) listener\(currentSession\)/);
});

test("offers date and time filters for alert history", () => {
  assert.match(html, /id="alertFilterDate"/);
  assert.match(html, /id="alertFilterStart"/);
  assert.match(html, /id="alertFilterEnd"/);
  assert.match(alerts, /function filteredHistory\(\)/);
});

test("allows an admin to clear alert history", () => {
  assert.match(html, /id="deleteAlertHistory"/);
  assert.match(alerts, /request\("\/history", \{ method: "DELETE" \}\)/);
  assert.match(worker, /request\.method === "DELETE" && action === "history"/);
  assert.match(worker, /storage\.delete\("alertHistory"\)/);
});

test("migrates drone names and permissions without removing existing access", () => {
  assert.match(schema, /camera_id = 'DRONE01'/);
  assert.match(schema, /select id, 'DRONE01' from auth\.users/);
  assert.match(schema, /values\('OBRA_001', 'DRONE01', 'Drone'\)/);
});
