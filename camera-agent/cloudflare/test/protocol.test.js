import test from "node:test";
import assert from "node:assert/strict";
import { heartbeatCameras, parseMessage, validIdentifier, validatePtz } from "../src/protocol.js";

test("parses only JSON objects", () => {
  assert.deepEqual(parseMessage('{"type":"auth"}'), { type: "auth" });
  assert.equal(parseMessage("not-json"), null);
  assert.equal(parseMessage("[]"), null);
});

test("validates identifiers", () => {
  assert.equal(validIdentifier("OBRA_001"), true);
  assert.equal(validIdentifier("../segredo"), false);
  assert.equal(validIdentifier(""), false);
});

test("accepts safe PTZ commands", () => {
  assert.deepEqual(validatePtz({ type: "ptz", cameraId: "CAM01", command: "move", direction: "left", speed: 4 }), {
    type: "ptz", cameraId: "CAM01", command: "move", direction: "left", speed: 4
  });
  assert.deepEqual(validatePtz({ type: "ptz", cameraId: "CAM01", command: "stop" }), {
    type: "ptz", cameraId: "CAM01", command: "stop"
  });
});

test("rejects unsafe PTZ commands", () => {
  assert.equal(validatePtz({ type: "ptz", cameraId: "CAM01", command: "move", direction: "zoom" }), null);
  assert.equal(validatePtz({ type: "ptz", cameraId: "CAM01", command: "move", direction: "up", speed: 99 }), null);
  assert.equal(validatePtz({ type: "ptz", cameraId: "../x", command: "stop" }), null);
});

test("normalizes multi-camera heartbeat", () => {
  assert.deepEqual(heartbeatCameras({ cameras: [
    { cameraId: "CAM01", cameraOnline: true },
    { cameraId: "CAM02", cameraOnline: false },
    { cameraId: "../x", cameraOnline: true }
  ] }), { CAM01: true, CAM02: false });
});

test("keeps legacy one-camera heartbeat compatible", () => {
  assert.deepEqual(heartbeatCameras({ cameraId: "CAM01", cameraOnline: true }), { CAM01: true });
});
