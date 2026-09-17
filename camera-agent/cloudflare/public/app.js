const elements = {
  site: document.querySelector("#site"), connect: document.querySelector("#connect"),
  message: document.querySelector("#message"), cameraList: document.querySelector("#cameraList"),
  cameraName: document.querySelector("#cameraName"), cameraIdBadge: document.querySelector("#cameraIdBadge"),
  muxPlayer: document.querySelector("#muxPlayer"), videoEmpty: document.querySelector("#videoEmpty"),
  agentDot: document.querySelector("#agentDot"), cameraDot: document.querySelector("#cameraDot"),
  agentStatus: document.querySelector("#agentStatus"), cameraStatus: document.querySelector("#cameraStatus"),
  listenToggle: document.querySelector("#listenToggle"),
  volumeControl: document.querySelector("#volumeControl"),
  volumeValue: document.querySelector("#volumeValue")
};
const t = (key) => window.NeoVisionUI.t(key);
const cameras = Array.isArray(window.NEO_VISION_CAMERAS) ? window.NEO_VISION_CAMERAS : [];
const controls = [...document.querySelectorAll(".pad button")];
let selectedCameraId = cameras[0]?.id || "CAM01";
let cameraStatuses = {};
let agentOnline = false;
let socket = null;
let authenticated = false;
let reconnectTimer = null;
let shouldReconnect = false;
let activeDirection = null;
let connectionGeneration = 0;

function selectedCamera() { return cameras.find((camera) => camera.id === selectedCameraId); }
function setControls(enabled) { controls.forEach((button) => { button.disabled = !enabled; }); }
function setDot(dot, online) { dot.className = `dot ${online ? "online" : "offline"}`; }
function message(text) { elements.message.textContent = text; }

function selectCamera(cameraId) {
  if (activeDirection && selectedCameraId !== cameraId) {
    send({ type: "ptz", cameraId: selectedCameraId, command: "stop" });
    document.querySelectorAll(".move.active").forEach((button) => button.classList.remove("active"));
    activeDirection = null;
  }
  selectedCameraId = cameraId;
  const camera = selectedCamera();
  elements.cameraName.textContent = camera ? `${t("cameraName")} ${camera.id.replace("CAM", "")}` : cameraId;
  elements.cameraIdBadge.textContent = cameraId;
  document.querySelectorAll(".camera-item").forEach((button) => button.classList.toggle("selected", button.dataset.cameraId === cameraId));

  if (camera?.playbackId) {
    elements.muxPlayer.setAttribute("playback-id", camera.playbackId);
    elements.muxPlayer.setAttribute("metadata-video-title", camera.name || camera.id);
    elements.muxPlayer.hidden = false;
    elements.videoEmpty.hidden = true;
  } else {
    elements.muxPlayer.removeAttribute("playback-id");
    elements.muxPlayer.hidden = true;
    elements.videoEmpty.hidden = false;
  }
  showStatus();
}

function renderCameraList() {
  elements.cameraList.replaceChildren(...cameras.map((camera) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "camera-item";
    button.dataset.cameraId = camera.id;
    button.innerHTML = `<span class="camera-number">${camera.id.replace("CAM", "")}</span><span><strong>${t("cameraName")} ${camera.id.replace("CAM", "")}</strong><small>${camera.id}</small></span><i class="mini-dot"></i>`;
    button.addEventListener("click", () => selectCamera(camera.id));
    return button;
  }));
}

function showStatus(status = null) {
  if (status) {
    agentOnline = Boolean(status.agentOnline);
    cameraStatuses = Object.fromEntries((status.cameras || []).map((camera) => [camera.cameraId, Boolean(camera.cameraOnline)]));
    if (!status.cameras && status.cameraId) cameraStatuses[status.cameraId] = Boolean(status.cameraOnline);
  }
  const cameraOnline = Boolean(cameraStatuses[selectedCameraId]);
  setDot(elements.agentDot, agentOnline);
  setDot(elements.cameraDot, cameraOnline);
  elements.agentStatus.textContent = agentOnline ? "ONLINE" : "OFFLINE";
  elements.cameraStatus.textContent = cameraOnline ? "ONLINE" : "OFFLINE";
  document.querySelectorAll(".camera-item").forEach((button) => {
    button.querySelector(".mini-dot").className = `mini-dot ${cameraStatuses[button.dataset.cameraId] ? "online" : "offline"}`;
  });
  setControls(Boolean(agentOnline && cameraOnline && authenticated));
}

function send(payload) {
  if (!authenticated || socket?.readyState !== WebSocket.OPEN) {
    message(t("connectionUnavailable"));
    return false;
  }
  socket.send(JSON.stringify(payload));
  return true;
}

function stop() {
  document.querySelectorAll(".move.active").forEach((button) => button.classList.remove("active"));
  activeDirection = null;
  send({ type: "ptz", cameraId: selectedCameraId, command: "stop" });
}

async function connect() {
  const generation = ++connectionGeneration;
  const siteId = elements.site.value.trim();
  const accessToken = await window.NeoVisionAuth.getAccessToken();
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(siteId) || !accessToken) {
    message(t("sessionExpired"));
    return;
  }
  shouldReconnect = true;
  authenticated = false;
  clearTimeout(reconnectTimer);
  socket?.close();
  const scheme = location.protocol === "https:" ? "wss" : "ws";
  socket = new WebSocket(`${scheme}://${location.host}/ws/${siteId}`);
  message(t("connecting"));
  setControls(false);

  socket.addEventListener("open", () => socket.send(JSON.stringify({ type: "auth", role: "operator", siteId, accessToken })));
  socket.addEventListener("message", (event) => {
    let data;
    try { data = JSON.parse(event.data); } catch { return; }
    if (data.type === "auth_ok") {
      authenticated = true;
      message(t("connected"));
    } else if (data.type === "status") {
      showStatus(data);
    } else if (data.type === "command_result") {
      message(data.ok ? `${data.cameraId || selectedCameraId}: ${t("commandDone")}` : `${t("failed")} ${data.cameraId || selectedCameraId}: ${data.error}`);
    } else if (data.type === "error") {
      const errors = { unauthorized: t("unauthorized"), agent_offline: t("agentOffline"), invalid_ptz_command: t("invalidPtz") };
      message(errors[data.error] || `${t("error")}: ${data.error}`);
    }
  });
  socket.addEventListener("close", () => {
    if (generation !== connectionGeneration) return;
    authenticated = false;
    agentOnline = false;
    cameraStatuses = {};
    showStatus();
    if (shouldReconnect) {
      message(t("connectionLost"));
      reconnectTimer = setTimeout(connect, 3000);
    }
  });
  socket.addEventListener("error", () => message(t("cannotConnect")));
}

elements.listenToggle.addEventListener("click", async () => {
  const muted = !elements.muxPlayer.muted;
  elements.muxPlayer.muted = muted;
  elements.listenToggle.querySelector("[aria-hidden]").textContent = muted ? "🔇" : "🔊";
  elements.listenToggle.querySelector("[data-i18n]").dataset.i18n = muted ? "listen" : "mute";
  elements.listenToggle.querySelector("[data-i18n]").textContent = t(muted ? "listen" : "mute");
  if (!muted) try { await elements.muxPlayer.play(); } catch { message(t("audioUnavailable")); }
});

const savedVolume = Math.min(100, Math.max(0, Number(localStorage.getItem("neoVisionVolume") ?? 100)));
elements.volumeControl.value = String(savedVolume);
elements.volumeValue.textContent = `${savedVolume}%`;
elements.muxPlayer.volume = savedVolume / 100;
elements.volumeControl.addEventListener("input", async () => {
  const volume = Number(elements.volumeControl.value);
  elements.volumeValue.textContent = `${volume}%`;
  elements.muxPlayer.volume = volume / 100;
  elements.muxPlayer.muted = volume === 0;
  localStorage.setItem("neoVisionVolume", String(volume));
  const muted = elements.muxPlayer.muted;
  elements.listenToggle.querySelector("[aria-hidden]").textContent = muted ? "🔇" : "🔊";
  elements.listenToggle.querySelector("[data-i18n]").dataset.i18n = muted ? "listen" : "mute";
  elements.listenToggle.querySelector("[data-i18n]").textContent = t(muted ? "listen" : "mute");
  if (!muted) try { await elements.muxPlayer.play(); } catch { message(t("audioUnavailable")); }
});

elements.connect.addEventListener("click", connect);
document.querySelectorAll(".move").forEach((button) => {
  button.addEventListener("pointerdown", (event) => {
    event.preventDefault();
    button.setPointerCapture(event.pointerId);
    activeDirection = button.dataset.direction;
    button.classList.add("active");
    send({ type: "ptz", cameraId: selectedCameraId, command: "move", direction: activeDirection, speed: 4 });
  });
  ["pointerup", "pointercancel", "lostpointercapture"].forEach((name) => button.addEventListener(name, () => {
    if (activeDirection === button.dataset.direction) stop();
  }));
});
document.querySelector("#stop").addEventListener("click", stop);
window.addEventListener("blur", () => { if (activeDirection) stop(); });

function resetConnection() {
  shouldReconnect = false;
  clearTimeout(reconnectTimer);
  socket?.close();
  authenticated = false;
  agentOnline = false;
  cameraStatuses = {};
  showStatus();
}

window.NeoVisionAuth.onChange((session) => {
  if (!session) resetConnection();
});

renderCameraList();
selectCamera(selectedCameraId);
setControls(false);
window.addEventListener("neo-language-change", () => { renderCameraList(); selectCamera(selectedCameraId); });
