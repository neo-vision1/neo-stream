export const GRID_LIMITS = [1, 2, 4, 6, 9, 11, 12];

export function normalizeGridLimit(value, fallback = 4) {
  const number = Number(value);
  return GRID_LIMITS.includes(number) ? number : fallback;
}

export function effectiveGridLimit(profileLimit, systemLimit) {
  return Math.min(normalizeGridLimit(profileLimit), normalizeGridLimit(systemLimit, 12));
}

export function liveDelay(player) {
  if (!player?.seekable?.length || !Number.isFinite(player.currentTime)) return null;
  return Math.max(0, player.seekable.end(player.seekable.length - 1) - player.currentTime);
}

export function isAtLiveEdge(delay, threshold = 8) {
  return delay !== null && delay <= threshold;
}

export function selectWithinLimit(ids, cameraId, limit) {
  const selected = [...new Set(ids)];
  if (selected.includes(cameraId)) return selected.filter((id) => id !== cameraId);
  if (selected.length >= limit) return selected;
  return [...selected, cameraId];
}
