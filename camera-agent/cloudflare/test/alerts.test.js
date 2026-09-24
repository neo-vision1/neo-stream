import test from "node:test";
import assert from "node:assert/strict";
import { evaluateAlerts, normalizeAlertConfig } from "../src/alerts.js";

test("normalizes alert configuration safely", () => {
  assert.deepEqual(normalizeAlertConfig({ enabled: true, offlineMinutes: 2, recipient: " admin@example.com " }), {
    enabled: true, offlineMinutes: 2, recoveryEnabled: true, agentAlertsEnabled: true,
    recipient: "admin@example.com", sender: "neovisiondrone@gmail.com"
  });
});

test("sends one camera alert after the configured delay and then recovery", () => {
  const config = { enabled: true, offlineMinutes: 1 };
  const first = evaluateAlerts({ now: 1_000, status: { lastHeartbeat: 1_000, cameras: { CAM01: false } }, config });
  assert.equal(first.events.length, 0);
  const late = evaluateAlerts({ now: 62_000, status: { lastHeartbeat: 62_000, cameras: { CAM01: false } }, config, previous: first.state });
  assert.equal(late.events[0].kind, "camera_offline");
  const repeated = evaluateAlerts({ now: 90_000, status: { lastHeartbeat: 90_000, cameras: { CAM01: false } }, config, previous: late.state });
  assert.equal(repeated.events.length, 0);
  const recovered = evaluateAlerts({ now: 91_000, status: { lastHeartbeat: 91_000, cameras: { CAM01: true } }, config, previous: repeated.state });
  assert.equal(recovered.events[0].kind, "camera_recovered");
});

test("uses one agent alert instead of one alert per camera", () => {
  const result = evaluateAlerts({
    now: 121_000,
    status: { lastHeartbeat: 1_000, cameras: { CAM01: false, CAM02: false } },
    config: { enabled: true, offlineMinutes: 1 },
    previous: { agent: { offlineSince: 1_000 }, cameras: {} }
  });
  assert.deepEqual(result.events.map((event) => event.kind), ["agent_offline"]);
});
