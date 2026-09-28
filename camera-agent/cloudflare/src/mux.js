export const MUX_LIVE_STREAM_SOURCES = Object.freeze({
  "00Nu1mGYW4jeeXm005wFmkJyXynB2Cy9mosBN9nsoVc7o": "CAM01",
  "XzxwcMGALCyNkIjkMDnaygt5fxw47YXgXYS1k8p01lQM": "CAM02",
  "fKyUVWj7aVfmomwLXd9bk00CQuO01EDXSmH5ceY1zYDnw": "CAM03",
  "MQQ0198OLmJMuDMbERzBvrnWr2xy01qjy2wGVVbiCC49M": "CAM04",
  "XAR01YPtJgAGSD6KM6v9IdH702sPFBSKrUJfcQAueYeIs": "CAM05",
  "4ts7kMWp67cyRb0100TBDuw83VUBDkXalrPamCyJvCUbc": "CAM06",
  "f6Qq01tSw4u5OFFDAkp7RYLEjExemQS22B8rs02ELrGr00": "CAM07",
  "1I4A0002fQsemxubgQKxgN1TJTpJ8AbDeFW00ft7fxgbsk": "CAM08",
  "C3v2MTWJ6chNc5ovrb9sjlVS1iTfo4UQWqT6nvuLctM": "CAM09",
  "fuWnnDnGuIZwHD8vHA9TZNmQGlZfggN4006YaNc1ShNI": "CAM10",
  "S6sVf01G9FUMu00JB7ThnToqG200LxaQWq6skKHWRybBdc": "CAM11",
  "XJ8YHVVQ7FDJnpwiol01vwSX4OfCsizHYRjR9fZXOJhk": "DRONE01"
});

export const MUX_SOURCE_IDS = Object.freeze(Object.values(MUX_LIVE_STREAM_SOURCES));

const encoder = new TextEncoder();

function parseSignature(header) {
  return Object.fromEntries(String(header || "").split(",").map((part) => part.trim().split("=", 2)));
}

function hexToBytes(hex) {
  if (!/^[0-9a-f]{64}$/i.test(hex || "")) return null;
  return new Uint8Array(hex.match(/.{2}/g).map((pair) => Number.parseInt(pair, 16)));
}

function equalBytes(left, right) {
  if (!left || !right || left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) difference |= left[index] ^ right[index];
  return difference === 0;
}

export async function verifyMuxSignature({ body, header, secret, now = Date.now(), toleranceSeconds = 300 }) {
  if (!secret) return false;
  const values = parseSignature(header);
  const timestamp = Number(values.t);
  const received = hexToBytes(values.v1);
  if (!Number.isFinite(timestamp) || Math.abs(now / 1000 - timestamp) > toleranceSeconds || !received) return false;
  const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const expected = new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(`${values.t}.${body}`)));
  return equalBytes(expected, received);
}

export function muxSourceEvent(payload) {
  const sourceId = MUX_LIVE_STREAM_SOURCES[payload?.data?.id];
  if (!sourceId) return null;
  const types = {
    "video.live_stream.active": "mux_stream_active",
    "video.live_stream.idle": "mux_stream_idle",
    "video.live_stream.disabled": "mux_stream_idle"
  };
  const kind = types[payload?.type];
  if (!kind) return null;
  const createdAt = typeof payload.created_at === "number" ? payload.created_at * 1000 : Date.parse(payload.created_at);
  return {
    kind,
    sourceId,
    muxEventId: String(payload.id || "").slice(0, 128),
    occurredAt: Number.isFinite(createdAt) && createdAt > 0 ? createdAt : Date.now()
  };
}
