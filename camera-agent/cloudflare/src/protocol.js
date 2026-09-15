export const DIRECTIONS = new Set(["up", "down", "left", "right"]);

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
  if (message.command !== "move" || !DIRECTIONS.has(message.direction)) return null;
  const speed = Number.isInteger(message.speed) ? message.speed : 4;
  if (speed < 1 || speed > 8) return null;
  return {
    type: "ptz",
    cameraId: message.cameraId,
    command: "move",
    direction: message.direction,
    speed
  };
}
