export const DIRECTIONS = new Set(["up", "down", "left", "right"]);
export const ZOOM_DIRECTIONS = new Set(["in", "out"]);

export function parseMessage(raw) {
  try {
    const value = JSON.parse(typeof raw === "string" ? raw : new TextDecoder().decode(raw));
    return value && typeof value === "object" && !Array.isArray(value) ? value : null;
  } catch {
    return null;
  }
}

export function validIdentifier(value) {
  return typeof value === "string" && /^[A-Za-z0-9_-]{1,64}$/.test(value);
}

export function validatePtz(message) {
  if (message?.type !== "ptz" || !validIdentifier(message.cameraId)) return null;
  if (message.command === "stop") {
    return { type: "ptz", cameraId: message.cameraId, command: "stop" };
  }
  const validMove = message.command === "move" && DIRECTIONS.has(message.direction);
  const validZoom = message.command === "zoom" && ZOOM_DIRECTIONS.has(message.direction);
  if (!validMove && !validZoom) return null;
  const speed = Number.isInteger(message.speed) ? message.speed : 4;
  if (speed < 1 || speed > 8) return null;
  return {
    type: "ptz",
    cameraId: message.cameraId,
    command: message.command,
    direction: message.direction,
    speed
  };
}

export function validateTalk(message) {
  if (!message || !validIdentifier(message.cameraId) || !validIdentifier(message.talkId)) return null;
  if (message.type === "talk_start" || message.type === "talk_stop") {
    return { type: message.type, cameraId: message.cameraId, talkId: message.talkId };
  }
  if (message.type !== "talk_audio" || typeof message.audio !== "string") return null;
  if (message.audio.length < 4 || message.audio.length > 24_000 || !/^[A-Za-z0-9+/]+={0,2}$/.test(message.audio)) return null;
  return { type: "talk_audio", cameraId: message.cameraId, talkId: message.talkId, audio: message.audio };
}

export function heartbeatCameras(message) {
  const cameras = {};
  if (Array.isArray(message?.cameras)) {
    for (const camera of message.cameras) {
      if (validIdentifier(camera?.cameraId)) cameras[camera.cameraId] = Boolean(camera.cameraOnline);
    }
  } else if (validIdentifier(message?.cameraId)) {
    cameras[message.cameraId] = Boolean(message.cameraOnline);
  }
  return cameras;
}

export function heartbeatCapabilities(message) {
  const capabilities = {};
  if (!Array.isArray(message?.cameras)) return capabilities;
  for (const camera of message.cameras) {
    if (validIdentifier(camera?.cameraId)) capabilities[camera.cameraId] = { supportsZoom: camera.supportsZoom === true };
  }
  return capabilities;
}
