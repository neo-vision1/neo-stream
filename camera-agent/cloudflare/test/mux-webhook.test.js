import test from "node:test";
import assert from "node:assert/strict";
import { MUX_LIVE_STREAM_SOURCES, muxSourceEvent, verifyMuxSignature } from "../src/mux.js";

test("maps all cameras and the drone to their Mux Live Stream IDs", () => {
  assert.equal(Object.keys(MUX_LIVE_STREAM_SOURCES).length, 12);
  assert.equal(MUX_LIVE_STREAM_SOURCES["00Nu1mGYW4jeeXm005wFmkJyXynB2Cy9mosBN9nsoVc7o"], "CAM01");
  assert.equal(MUX_LIVE_STREAM_SOURCES["XJ8YHVVQ7FDJnpwiol01vwSX4OfCsizHYRjR9fZXOJhk"], "DRONE01");
});

test("turns Mux active and idle webhooks into Neo Vision events", () => {
  const data = { id: "00Nu1mGYW4jeeXm005wFmkJyXynB2Cy9mosBN9nsoVc7o" };
  assert.equal(muxSourceEvent({ id: "evt-1", type: "video.live_stream.active", created_at: 10, data }).kind, "mux_stream_active");
  assert.equal(muxSourceEvent({ id: "evt-2", type: "video.live_stream.idle", created_at: 20, data }).kind, "mux_stream_idle");
  assert.equal(muxSourceEvent({ id: "evt-iso", type: "video.live_stream.active", created_at: "2026-09-28T14:00:00Z", data }).occurredAt, Date.parse("2026-09-28T14:00:00Z"));
  assert.equal(muxSourceEvent({ id: "evt-3", type: "video.asset.ready", data }), null);
});

test("verifies the Mux HMAC signature and timestamp", async () => {
  const secret = "mux-signing-secret";
  const body = JSON.stringify({ type: "video.live_stream.active" });
  const timestamp = 1_700_000_000;
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const bytes = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${timestamp}.${body}`)));
  const signature = [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  assert.equal(await verifyMuxSignature({ body, header: `t=${timestamp},v1=${signature}`, secret, now: timestamp * 1000 }), true);
  assert.equal(await verifyMuxSignature({ body: `${body}x`, header: `t=${timestamp},v1=${signature}`, secret, now: timestamp * 1000 }), false);
  assert.equal(await verifyMuxSignature({ body, header: `t=${timestamp},v1=${signature}`, secret, now: (timestamp + 301) * 1000 }), false);
});
