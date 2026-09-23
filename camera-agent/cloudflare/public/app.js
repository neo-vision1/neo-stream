import { effectiveGridLimit, isAtLiveEdge, liveDelay, normalizeGridLimit, selectWithinLimit } from "/ui-policy.js";

const elements = {
  site: document.querySelector("#site"), connect: document.querySelector("#connect"),
  message: document.querySelector("#message"), cameraList: document.querySelector("#cameraList"),
  cameraName: document.querySelector("#cameraName"), cameraIdBadge: document.querySelector("#cameraIdBadge"),
  muxPlayer: document.querySelector("#muxPlayer"), videoEmpty: document.querySelector("#videoEmpty"),
  agentDot: document.querySelector("#agentDot"), cameraDot: document.querySelector("#cameraDot"),
  agentStatus: document.querySelector("#agentStatus"), cameraStatus: document.querySelector("#cameraStatus"),
  listenToggle: document.querySelector("#listenToggle"),
  volumeControl: document.querySelector("#volumeControl"),
  volumeValue: document.querySelector("#volumeValue"), talkButton: document.querySelector("#talkButton"),
  playerWrap: document.querySelector("#playerWrap"), liveBadge: document.querySelector("#liveBadge"),
  liveTimeline: document.querySelector("#liveTimeline"), delayLabel: document.querySelector("#delayLabel"),
  goLive: document.querySelector("#goLive"), fullscreen: document.querySelector("#fullscreen"),
  singleView: document.querySelector("#singleView"), gridView: document.querySelector("#gridView"),
  singleViewer: document.querySelector("#singleViewer"), gridViewer: document.querySelector("#gridViewer"),
  gridCount: document.querySelector("#gridCount"), renameCamera: document.querySelector("#renameCamera"),
  adminToggle: document.querySelector("#adminToggle"), adminPanel: document.querySelector("#adminPanel"),
  closeAdmin: document.querySelector("#closeAdmin"), adminSettings: document.querySelector("#adminSettings"),
  adminMulticamera: document.querySelector("#adminMulticamera"), adminGridLimit: document.querySelector("#adminGridLimit"),
  adminAutoPause: document.querySelector("#adminAutoPause"), adminIdleMinutes: document.querySelector("#adminIdleMinutes"),
  adminMessage: document.querySelector("#adminMessage"), estimatedUsage: document.querySelector("#estimatedUsage"),
  quotaBar: document.querySelector("#quotaBar"), quotaLabel: document.querySelector("#quotaLabel")
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
let talkPreviousMuted = null;
let settings = window.NeoVisionSettings.value;
let viewMode = "single";
let gridCameraIds = [];
let sessionDeliveredSeconds = 0;
let lastUsageTick = performance.now();
let lastInteraction = Date.now();

function cameraLabel(camera) { return settings.cameraNames[camera.id] || camera.name || `${t("cameraName")} ${camera.id.replace("CAM", "")}`; }
function gridLimit() { return effectiveGridLimit(settings.profileGridLimit, settings.systemGridLimit); }

function selectedCamera() { return cameras.find((camera) => camera.id === selectedCameraId); }
function setControls(enabled) { controls.forEach((button) => { button.disabled = !enabled; }); }
function setDot(dot, online) { dot.className = `dot ${online ? "online" : "offline"}`; }
function message(text) { elements.message.textContent = text; }

function selectCamera(cameraId) {
  if (selectedCameraId !== cameraId) window.NeoVisionTalk.stop();
  if (activeDirection && selectedCameraId !== cameraId) {
    send({ type: "ptz", cameraId: selectedCameraId, command: "stop" });
    document.querySelectorAll(".move.active").forEach((button) => button.classList.remove("active"));
    activeDirection = null;
  }
  selectedCameraId = cameraId;
  const camera = selectedCamera();
  elements.cameraName.textContent = camera ? cameraLabel(camera) : cameraId;
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
    const number = document.createElement("span"); number.className = "camera-number"; number.textContent = camera.id.replace("CAM", "");
    const text = document.createElement("span"); const strong = document.createElement("strong"); const small = document.createElement("small");
    strong.textContent = cameraLabel(camera); small.textContent = camera.id; text.append(strong, small);
    const dot = document.createElement("i"); dot.className = "mini-dot";
    const check = document.createElement("span"); check.className = `grid-check ${gridCameraIds.includes(camera.id) ? "checked" : ""}`; check.textContent = gridCameraIds.includes(camera.id) ? "✓" : "+";
    button.append(number, text, dot, check);
    button.addEventListener("click", () => {
      if (viewMode === "grid") toggleGridCamera(camera.id);
      else selectCamera(camera.id);
    });
    return button;
  }));
}

function setViewMode(mode) {
  if (mode === "grid" && !settings.multicameraEnabled) {
    message("O modo grade foi desativado pelo administrador.");
    return;
  }
  viewMode = mode;
  elements.singleViewer.hidden = mode !== "single";
  elements.gridViewer.hidden = mode !== "grid";
  elements.singleView.classList.toggle("active", mode === "single");
  elements.gridView.classList.toggle("active", mode === "grid");
  if (mode === "grid") {
    elements.muxPlayer.pause();
    renderGrid();
  } else {
    pauseGridPlayers();
    elements.muxPlayer.play().catch(() => {});
  }
  renderCameraList();
}

function pauseGridPlayers() {
  elements.gridViewer.querySelectorAll("mux-player").forEach((player) => player.pause());
}

function toggleGridCamera(cameraId) {
  const before = gridCameraIds.length;
  gridCameraIds = selectWithinLimit(gridCameraIds, cameraId, gridLimit());
  if (before === gridCameraIds.length && !gridCameraIds.includes(cameraId)) {
    message(`Limite de ${gridLimit()} câmeras simultâneas definido pelo administrador.`);
  }
  renderCameraList();
  renderGrid();
}

function renderGrid() {
  const limit = gridLimit();
  elements.gridCount.textContent = `${gridCameraIds.length}/${limit}`;
  elements.gridViewer.replaceChildren();
  if (!gridCameraIds.length) {
    const empty = document.createElement("div"); empty.className = "grid-empty";
    const strong = document.createElement("strong"); strong.textContent = "Selecione as câmeras na lista";
    const span = document.createElement("span"); span.textContent = "Somente as câmeras marcadas serão reproduzidas.";
    empty.append(strong, span); elements.gridViewer.append(empty); return;
  }
  for (const cameraId of gridCameraIds) {
    const camera = cameras.find((item) => item.id === cameraId);
    if (!camera?.playbackId) continue;
    const card = document.createElement("article"); card.className = "grid-camera";
    const header = document.createElement("button"); header.type = "button"; header.textContent = `${cameraLabel(camera)} · ${camera.id}`;
    header.addEventListener("click", () => { selectCamera(camera.id); setViewMode("single"); });
    const player = document.createElement("mux-player");
    player.setAttribute("playback-id", camera.playbackId); player.setAttribute("stream-type", "live");
    player.setAttribute("autoplay", ""); player.setAttribute("muted", ""); player.setAttribute("title", cameraLabel(camera));
    card.append(header, player); elements.gridViewer.append(card);
  }
}

function goToLive(player = elements.muxPlayer) {
  if (!player.seekable?.length) return;
  player.currentTime = player.seekable.end(player.seekable.length - 1);
  player.play().catch(() => {});
}

function refreshLiveState() {
  const delay = liveDelay(elements.muxPlayer);
  if (delay === null) {
    elements.liveBadge.textContent = "CARREGANDO"; elements.liveBadge.className = "live-badge waiting";
    elements.delayLabel.textContent = "Calculando atraso…"; return;
  }
  const live = isAtLiveEdge(delay);
  elements.liveBadge.textContent = live ? "● AO VIVO" : "ATRASADO";
  elements.liveBadge.className = `live-badge ${live ? "live" : "delayed"}`;
  elements.delayLabel.textContent = live ? `Ao vivo · ${Math.round(delay)} s` : `${Math.round(delay)} s atrás`;
  elements.liveTimeline.value = String(Math.max(0, 30 - Math.min(30, Math.round(delay))));
  elements.goLive.disabled = live;
}

function updateUsageEstimate() {
  const now = performance.now();
  const active = viewMode === "grid" ? elements.gridViewer.querySelectorAll("mux-player").length : (elements.muxPlayer.paused ? 0 : 1);
  sessionDeliveredSeconds += ((now - lastUsageTick) / 1000) * active;
  lastUsageTick = now;
  const minutes = sessionDeliveredSeconds / 60;
  const percentage = Math.min(100, minutes / 1000);
  elements.estimatedUsage.textContent = `${minutes.toFixed(1)} min`;
  elements.quotaBar.style.width = `${percentage}%`;
  elements.quotaLabel.textContent = `${percentage.toFixed(2)}% de 100.000 minutos gratuitos (sessão atual)`;
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
  setControls(Boolean(agentOnline && cameraOnline && authenticated && settings.canPtz));
  window.NeoVisionTalk.setEnabled(Boolean(agentOnline && cameraOnline && authenticated && settings.canTalk));
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
    } else if (window.NeoVisionTalk.handleMessage(data)) {
      return;
    } else if (data.type === "error") {
      const errors = { unauthorized: t("unauthorized"), agent_offline: t("agentOffline"), invalid_ptz_command: t("invalidPtz"), invalid_talk_command: t("invalidTalk") };
      message(errors[data.error] || `${t("error")}: ${data.error}`);
    }
  });
  socket.addEventListener("close", () => {
    if (generation !== connectionGeneration) return;
    authenticated = false;
    window.NeoVisionTalk.stop();
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

elements.volumeControl.addEventListener("input", async () => {
  const volume = Number(elements.volumeControl.value);
  elements.volumeValue.textContent = `${volume}%`;
  try {
    elements.muxPlayer.volume = volume / 100;
    elements.muxPlayer.muted = volume === 0;
    localStorage.setItem("neoVisionVolume", String(volume));
  } catch { return; }
  const muted = elements.muxPlayer.muted;
  elements.listenToggle.querySelector("[aria-hidden]").textContent = muted ? "🔇" : "🔊";
  elements.listenToggle.querySelector("[data-i18n]").dataset.i18n = muted ? "listen" : "mute";
  elements.listenToggle.querySelector("[data-i18n]").textContent = t(muted ? "listen" : "mute");
  if (!muted) try { await elements.muxPlayer.play(); } catch { message(t("audioUnavailable")); }
});

elements.connect.addEventListener("click", connect);
elements.singleView.addEventListener("click", () => setViewMode("single"));
elements.gridView.addEventListener("click", () => setViewMode("grid"));
elements.fullscreen.addEventListener("click", async () => {
  const target = viewMode === "grid" ? elements.gridViewer : elements.playerWrap;
  try { await target.requestFullscreen(); } catch { message("O navegador não permitiu abrir a tela cheia."); }
});
elements.goLive.addEventListener("click", () => goToLive());
elements.liveTimeline.addEventListener("input", () => {
  if (!elements.muxPlayer.seekable?.length) return;
  const end = elements.muxPlayer.seekable.end(elements.muxPlayer.seekable.length - 1);
  elements.muxPlayer.currentTime = end - (30 - Number(elements.liveTimeline.value));
});
elements.renameCamera.addEventListener("click", async () => {
  const camera = selectedCamera();
  const name = window.prompt("Nome personalizado desta câmera:", cameraLabel(camera));
  if (name === null) return;
  try { await window.NeoVisionSettings.saveCameraName(camera.id, name); message("Nome personalizado salvo para este perfil."); }
  catch { message("Não foi possível salvar o nome. O esquema de teste do Supabase precisa ser aplicado."); }
});
elements.adminToggle.addEventListener("click", () => { elements.adminPanel.hidden = false; elements.adminPanel.scrollIntoView({ behavior: "smooth" }); });
elements.closeAdmin.addEventListener("click", () => { elements.adminPanel.hidden = true; });
elements.adminSettings.addEventListener("submit", async (event) => {
  event.preventDefault(); elements.adminMessage.textContent = "Salvando…";
  const values = {
    multicameraEnabled: elements.adminMulticamera.checked,
    systemGridLimit: normalizeGridLimit(elements.adminGridLimit.value),
    autoPauseHidden: elements.adminAutoPause.checked,
    idleMinutes: Math.min(120, Math.max(1, Number(elements.adminIdleMinutes.value) || 10))
  };
  try { await window.NeoVisionSettings.saveAdminSettings(values); elements.adminMessage.textContent = "Configurações salvas."; }
  catch { elements.adminMessage.textContent = "Não foi possível salvar. Verifique a permissão de administrador."; }
});
window.NeoVisionTalk.init({ button: elements.talkButton, send, getCameraId: () => selectedCameraId });
window.addEventListener("neo-talk-started", () => {
  talkPreviousMuted = elements.muxPlayer.muted;
  elements.muxPlayer.muted = true;
  message(t("talking"));
});
window.addEventListener("neo-talk-stopped", () => {
  if (talkPreviousMuted !== null) elements.muxPlayer.muted = talkPreviousMuted;
  talkPreviousMuted = null;
  message(t("connected"));
});
window.addEventListener("neo-talk-error", (event) => message(t(event.detail === "microphone_denied" ? "microphoneDenied" : "talkError")));
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
document.addEventListener("visibilitychange", () => {
  if (!document.hidden || !settings.autoPauseHidden) return;
  elements.muxPlayer.pause(); pauseGridPlayers();
});
["pointerdown", "keydown", "scroll"].forEach((eventName) => document.addEventListener(eventName, () => { lastInteraction = Date.now(); }, { passive: true }));
setInterval(() => {
  if (Date.now() - lastInteraction < settings.idleMinutes * 60_000) return;
  elements.muxPlayer.pause(); pauseGridPlayers();
}, 30_000);

function resetConnection() {
  shouldReconnect = false;
  clearTimeout(reconnectTimer);
  socket?.close();
  window.NeoVisionTalk.stop();
  authenticated = false;
  agentOnline = false;
  cameraStatuses = {};
  showStatus();
}

window.NeoVisionAuth.onChange((session) => {
  if (!session) { resetConnection(); return; }
  window.NeoVisionSettings.load(session);
});

window.NeoVisionSettings.onChange((value) => {
  settings = value;
  elements.adminToggle.hidden = settings.role !== "admin";
  if (settings.role !== "admin") elements.adminPanel.hidden = true;
  elements.adminMulticamera.checked = settings.multicameraEnabled;
  elements.adminGridLimit.value = String(normalizeGridLimit(settings.systemGridLimit));
  elements.adminAutoPause.checked = settings.autoPauseHidden;
  elements.adminIdleMinutes.value = String(settings.idleMinutes);
  if (!settings.multicameraEnabled && viewMode === "grid") setViewMode("single");
  gridCameraIds = gridCameraIds.slice(0, gridLimit());
  renderCameraList(); renderGrid(); selectCamera(selectedCameraId); showStatus();
});

renderCameraList();
selectCamera(selectedCameraId);
setControls(false);
try {
  const savedVolume = Math.min(100, Math.max(0, Number(localStorage.getItem("neoVisionVolume") ?? 100)));
  elements.volumeControl.value = String(savedVolume);
  elements.volumeValue.textContent = `${savedVolume}%`;
  elements.muxPlayer.volume = savedVolume / 100;
} catch {
  elements.volumeControl.value = "100";
  elements.volumeValue.textContent = "100%";
}
window.addEventListener("neo-language-change", () => { renderCameraList(); selectCamera(selectedCameraId); });
setInterval(refreshLiveState, 1000);
setInterval(updateUsageEstimate, 5000);
