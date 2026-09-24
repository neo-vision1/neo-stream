import { effectiveGridLimit, isAtLiveEdge, liveDelay, normalizeGridLimit, selectWithinLimit } from "/ui-policy.js";

const elements = {
  site: document.querySelector("#site"), connect: document.querySelector("#connect"),
  message: document.querySelector("#message"), cameraList: document.querySelector("#cameraList"),
  sourceTabs: [...document.querySelectorAll("[data-source-filter]")],
  sourcePanelTitle: document.querySelector("#sourcePanelTitle"), sourcePanelCount: document.querySelector("#sourcePanelCount"),
  cameraName: document.querySelector("#cameraName"), cameraIdBadge: document.querySelector("#cameraIdBadge"),
  muxPlayer: document.querySelector("#muxPlayer"), videoEmpty: document.querySelector("#videoEmpty"),
  agentDot: document.querySelector("#agentDot"), cameraDot: document.querySelector("#cameraDot"),
  agentStatus: document.querySelector("#agentStatus"), cameraStatus: document.querySelector("#cameraStatus"),
  selectedSourceType: document.querySelector("#selectedSourceType"),
  listenToggle: document.querySelector("#listenToggle"),
  volumeControl: document.querySelector("#volumeControl"),
  volumeValue: document.querySelector("#volumeValue"), talkButton: document.querySelector("#talkButton"),
  playerWrap: document.querySelector("#playerWrap"), liveBadge: document.querySelector("#liveBadge"),
  liveTimeline: document.querySelector("#liveTimeline"), delayLabel: document.querySelector("#delayLabel"),
  goLive: document.querySelector("#goLive"), fullscreen: document.querySelector("#fullscreen"),
  singleView: document.querySelector("#singleView"), gridView: document.querySelector("#gridView"),
  viewerCard: document.querySelector(".viewer-card"), singleViewer: document.querySelector("#singleViewer"), gridViewer: document.querySelector("#gridViewer"),
  gridCount: document.querySelector("#gridCount"), selectAllGrid: document.querySelector("#selectAllGrid"),
  clearGrid: document.querySelector("#clearGrid"), renameCamera: document.querySelector("#renameCamera"),
  adminToggle: document.querySelector("#adminToggle"), adminPanel: document.querySelector("#adminPanel"),
  closeAdmin: document.querySelector("#closeAdmin"), adminSettings: document.querySelector("#adminSettings"),
  adminMulticamera: document.querySelector("#adminMulticamera"), adminGridLimit: document.querySelector("#adminGridLimit"),
  adminAutoPause: document.querySelector("#adminAutoPause"), adminIdleMinutes: document.querySelector("#adminIdleMinutes"),
  adminMessage: document.querySelector("#adminMessage"), estimatedUsage: document.querySelector("#estimatedUsage"),
  quotaBar: document.querySelector("#quotaBar"), quotaLabel: document.querySelector("#quotaLabel"),
  refreshProfiles: document.querySelector("#refreshProfiles"), profilesMessage: document.querySelector("#profilesMessage"),
  profilesList: document.querySelector("#profilesList"), cameraNamesForm: document.querySelector("#cameraNamesForm"),
  adminCameraNames: document.querySelector("#adminCameraNames"), cameraNamesMessage: document.querySelector("#cameraNamesMessage")
};
const t = (key) => window.NeoVisionUI.t(key);
const cameras = (Array.isArray(window.NEO_VISION_CAMERAS) ? window.NEO_VISION_CAMERAS : []).map((camera) => ({ ...camera, type: "camera" }));
const drones = (Array.isArray(window.NEO_VISION_DRONES) ? window.NEO_VISION_DRONES : []).map((drone) => ({ ...drone, type: "drone" }));
const streamSources = [...cameras, ...drones];
const controls = [...document.querySelectorAll(".pad button")];
const zoomControls = [...document.querySelectorAll(".zoom-control")];
let selectedCameraId = streamSources[0]?.id || "CAM01";
let cameraStatuses = {};
let cameraCapabilities = {};
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
let pseudoFullscreen = false;
let sourceFilter = "camera";
let muxPlaybackReady = false;

function cameraLabel(camera) {
  return settings.cameraNames[camera.id] || camera.name || `${t("cameraName")} ${camera.id.replace("CAM", "")}`;
}
function gridLimit() { return settings.role === "admin" ? 11 : effectiveGridLimit(settings.profileGridLimit, settings.systemGridLimit); }
function accessibleCameras() {
  if (settings.role === "admin") return streamSources;
  const allowed = new Set(settings.allowedCameraIds || []);
  return streamSources.filter((camera) => allowed.has(camera.id));
}
function canAccessCamera(cameraId) { return accessibleCameras().some((camera) => camera.id === cameraId); }

function selectedCamera() { return streamSources.find((camera) => camera.id === selectedCameraId); }
function setControls(enabled) {
  controls.forEach((button) => { button.disabled = !enabled; });
  const zoomEnabled = enabled && cameraCapabilities[selectedCameraId]?.supportsZoom === true;
  zoomControls.forEach((button) => { button.disabled = !zoomEnabled; });
}
function setDot(dot, online) { dot.className = `dot ${online ? "online" : "offline"}`; }
function message(text) { elements.message.textContent = text; }

function selectCamera(cameraId) {
  if (!canAccessCamera(cameraId)) {
    const fallback = accessibleCameras()[0];
    if (!fallback) {
      elements.cameraName.textContent = "Nenhuma câmera liberada";
      elements.cameraIdBadge.textContent = "—";
      elements.muxPlayer.removeAttribute("playback-id");
      elements.muxPlayer.hidden = true;
      elements.videoEmpty.hidden = false;
      setControls(false);
      return;
    }
    cameraId = fallback.id;
  }
  if (selectedCameraId !== cameraId) window.NeoVisionTalk.stop();
  if (activeDirection && selectedCameraId !== cameraId) {
    send({ type: "ptz", cameraId: selectedCameraId, command: "stop" });
    document.querySelectorAll(".move.active, .zoom-control.active").forEach((button) => button.classList.remove("active"));
    activeDirection = null;
  }
  selectedCameraId = cameraId;
  const camera = selectedCamera();
  muxPlaybackReady = false;
  elements.cameraName.textContent = camera ? cameraLabel(camera) : cameraId;
  elements.cameraIdBadge.textContent = cameraId;
  elements.renameCamera.hidden = settings.role !== "admin";
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
  const visibleSources = accessibleCameras().filter((camera) => camera.type === sourceFilter);
  elements.sourcePanelTitle.textContent = sourceFilter === "drone" ? "Drone" : "Câmeras";
  elements.sourcePanelCount.textContent = sourceFilter === "drone" ? `${visibleSources.length} transmissão` : `${visibleSources.length} equipamentos`;
  elements.sourceTabs.forEach((tab) => {
    const active = tab.dataset.sourceFilter === sourceFilter;
    tab.classList.toggle("active", active);
    tab.setAttribute("aria-selected", String(active));
  });
  elements.cameraList.replaceChildren(...visibleSources.map((camera) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "camera-item";
    button.dataset.cameraId = camera.id;
    const number = document.createElement("span"); number.className = "camera-number"; number.textContent = camera.type === "drone" ? "DR" : camera.id.replace("CAM", "");
    const text = document.createElement("span"); const strong = document.createElement("strong"); const small = document.createElement("small");
    strong.textContent = cameraLabel(camera); small.textContent = camera.type === "drone" ? "MUX · AO VIVO" : camera.id; text.append(strong, small);
    const dot = document.createElement("i"); dot.className = `mini-dot${camera.type === "drone" ? " stream" : ""}`;
    const check = document.createElement("span"); check.className = `grid-check ${gridCameraIds.includes(camera.id) ? "checked" : ""}`; check.textContent = gridCameraIds.includes(camera.id) ? "✓" : "+";
    button.append(number, text, dot, check);
    button.addEventListener("click", () => {
      if (viewMode === "grid") toggleGridCamera(camera.id);
      else selectCamera(camera.id);
    });
    return button;
  }));
}

function setSourceFilter(filter) {
  sourceFilter = filter === "drone" ? "drone" : "camera";
  renderCameraList();
  if (viewMode === "single") {
    const first = accessibleCameras().find((source) => source.type === sourceFilter);
    if (first) selectCamera(first.id);
  }
}

function setViewMode(mode) {
  if (mode === "grid" && !settings.multicameraEnabled) {
    message("O modo grade foi desativado pelo administrador.");
    return;
  }
  viewMode = mode;
  document.documentElement.dataset.viewMode = mode;
  elements.singleViewer.hidden = mode !== "single";
  elements.gridViewer.hidden = mode !== "grid";
  elements.singleView.classList.toggle("active", mode === "single");
  elements.gridView.classList.toggle("active", mode === "grid");
  elements.selectAllGrid.hidden = mode !== "grid";
  elements.clearGrid.hidden = mode !== "grid";
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
  if (!canAccessCamera(cameraId)) return;
  const before = gridCameraIds.length;
  gridCameraIds = selectWithinLimit(gridCameraIds, cameraId, gridLimit());
  if (before === gridCameraIds.length && !gridCameraIds.includes(cameraId)) {
    message(`Limite de ${gridLimit()} câmeras simultâneas definido pelo administrador.`);
  }
  renderCameraList();
  renderGrid();
  window.NeoVisionSettings.saveGridSelection(gridCameraIds).catch(() => message("Não foi possível salvar a seleção da grade."));
}

function clearGrid() {
  gridCameraIds = [];
  renderCameraList();
  renderGrid();
  window.NeoVisionSettings.saveGridSelection([]).catch(() => message("Não foi possível salvar a seleção da grade."));
}

function selectAllGrid() {
  const availableIds = accessibleCameras().map((camera) => camera.id);
  const limit = gridLimit();
  gridCameraIds = availableIds.slice(0, limit);
  renderCameraList();
  renderGrid();
  if (availableIds.length > limit) {
    message(`Foram marcadas ${limit} fontes, o limite simultâneo definido pelo administrador.`);
  }
  window.NeoVisionSettings.saveGridSelection(gridCameraIds).catch(() => message("Não foi possível salvar a seleção da grade."));
}

function renderAdminCameraNames() {
  elements.adminCameraNames.replaceChildren(...streamSources.map((camera) => {
    const label = document.createElement("label");
    const code = document.createElement("strong"); code.textContent = camera.id;
    const input = document.createElement("input"); input.type = "text"; input.maxLength = 60; input.dataset.cameraId = camera.id; input.value = cameraLabel(camera);
    label.append(code, input);
    return label;
  }));
}

function profileRow(profile, currentUserId) {
  const form = document.createElement("form");
  form.className = "profile-row";
  form.dataset.profileId = profile.id;
  const identity = document.createElement("div"); identity.className = "profile-identity";
  const email = document.createElement("strong"); email.textContent = profile.email || "Usuário sem e-mail";
  const note = document.createElement("small"); note.textContent = profile.id === currentUserId ? "Conta em uso" : "";
  identity.append(email, note);
  const role = document.createElement("select"); role.ariaLabel = "Função";
  [["viewer", "Visualizador"], ["operator", "Operador"], ["admin", "Administrador"]].forEach(([value, label]) => {
    const option = document.createElement("option"); option.value = value; option.textContent = label; option.selected = profile.role === value; role.append(option);
  });
  const ptzInput = document.createElement("input"); ptzInput.type = "checkbox"; ptzInput.checked = Boolean(profile.can_ptz);
  const ptz = document.createElement("label"); ptz.className = "profile-check"; ptz.append(ptzInput, " PTZ");
  const talkInput = document.createElement("input"); talkInput.type = "checkbox"; talkInput.checked = Boolean(profile.can_talk);
  const talk = document.createElement("label"); talk.className = "profile-check"; talk.append(talkInput, " Áudio");
  const limit = document.createElement("select"); limit.ariaLabel = "Limite multicâmera";
  [1, 2, 4, 6, 9, 11].forEach((value) => { const option = document.createElement("option"); option.value = String(value); option.textContent = `${value} câmera${value > 1 ? "s" : ""}`; option.selected = Number(profile.multicamera_limit) === value; limit.append(option); });
  const save = document.createElement("button"); save.type = "submit"; save.textContent = "Salvar";
  const cameraAccess = document.createElement("fieldset"); cameraAccess.className = "profile-cameras";
  const cameraLegend = document.createElement("legend"); cameraLegend.textContent = "Fontes permitidas"; cameraAccess.append(cameraLegend);
  const allowed = new Set(profile.role === "admin" ? streamSources.map((camera) => camera.id) : (profile.allowed_camera_ids || []));
  const cameraInputs = streamSources.map((camera) => {
    const input = document.createElement("input"); input.type = "checkbox"; input.value = camera.id; input.checked = allowed.has(camera.id);
    const label = document.createElement("label"); label.append(input, camera.type === "drone" ? " Drone" : camera.id.replace("CAM", "")); cameraAccess.append(label);
    return input;
  });
  const syncAdminCameraAccess = () => {
    const adminRole = role.value === "admin";
    cameraInputs.forEach((input) => { if (adminRole) input.checked = true; input.disabled = adminRole || profile.id === currentUserId; });
  };
  role.addEventListener("change", syncAdminCameraAccess);
  if (profile.id === currentUserId) [role, ptzInput, talkInput, limit, save].forEach((item) => { item.disabled = true; });
  syncAdminCameraAccess();
  form.append(identity, role, ptz, talk, limit, save, cameraAccess);
  form.addEventListener("submit", async (event) => {
    event.preventDefault(); save.disabled = true; save.textContent = "Salvando…";
    try {
      const allowedCameraIds = cameraInputs.filter((input) => input.checked).map((input) => input.value);
      if (!allowedCameraIds.length) throw new Error("Selecione pelo menos uma câmera.");
      await window.NeoVisionSettings.updateProfile(profile.id, { role: role.value, canPtz: ptzInput.checked, canTalk: talkInput.checked, multicameraLimit: limit.value, allowedCameraIds });
      save.textContent = "Salvo";
    } catch (error) { save.textContent = "Erro"; elements.profilesMessage.textContent = error.message || "Não foi possível salvar o perfil."; }
    setTimeout(() => { save.disabled = false; save.textContent = "Salvar"; }, 1200);
  });
  return form;
}

async function loadProfiles() {
  elements.profilesMessage.textContent = "Carregando perfis…";
  elements.profilesList.replaceChildren();
  try {
    const profiles = await window.NeoVisionSettings.listProfiles();
    const currentUserId = window.NeoVisionAuth.session?.user?.id;
    elements.profilesList.replaceChildren(...profiles.map((profile) => profileRow(profile, currentUserId)));
    elements.profilesMessage.textContent = profiles.length ? `${profiles.length} perfil(is) encontrado(s).` : "Nenhum perfil encontrado.";
  } catch { elements.profilesMessage.textContent = "Não foi possível carregar os perfis. Verifique o esquema e a permissão de administrador."; }
}

function renderGrid() {
  const limit = gridLimit();
  elements.gridCount.textContent = `${gridCameraIds.length}/${limit}`;
  elements.gridViewer.dataset.count = String(gridCameraIds.length);
  elements.gridViewer.replaceChildren();
  if (!gridCameraIds.length) {
    const empty = document.createElement("div"); empty.className = "grid-empty";
    const strong = document.createElement("strong"); strong.textContent = "Selecione câmeras ou o drone na lista";
    const span = document.createElement("span"); span.textContent = "Use as opções Câmeras e Drone para montar a grade.";
    empty.append(strong, span); elements.gridViewer.append(empty); return;
  }
  for (const cameraId of gridCameraIds) {
    if (!canAccessCamera(cameraId)) continue;
    const camera = streamSources.find((item) => item.id === cameraId);
    if (!camera?.playbackId) continue;
    const card = document.createElement("article"); card.className = "grid-camera";
    const header = document.createElement("button"); header.type = "button"; header.textContent = `${cameraLabel(camera)} · ${camera.id}`;
    header.addEventListener("click", () => { setSourceFilter(camera.type); selectCamera(camera.id); setViewMode("single"); });
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
    cameraCapabilities = Object.fromEntries((status.cameras || []).map((camera) => [camera.cameraId, { supportsZoom: camera.supportsZoom === true }]));
    if (!status.cameras && status.cameraId) cameraStatuses[status.cameraId] = Boolean(status.cameraOnline);
  }
  const current = selectedCamera();
  const isDrone = current?.type === "drone";
  const cameraOnline = isDrone ? muxPlaybackReady : Boolean(cameraStatuses[selectedCameraId]);
  setDot(elements.agentDot, agentOnline);
  setDot(elements.cameraDot, cameraOnline);
  elements.agentStatus.textContent = agentOnline ? "ONLINE" : "OFFLINE";
  elements.selectedSourceType.textContent = isDrone ? "DRONE" : "CÂMERA";
  elements.cameraStatus.textContent = isDrone ? (cameraOnline ? "AO VIVO" : "CONECTANDO") : (cameraOnline ? "ONLINE" : "OFFLINE");
  document.querySelectorAll(".camera-item").forEach((button) => {
    const source = streamSources.find((item) => item.id === button.dataset.cameraId);
    const online = source?.type === "drone" ? (source.id === selectedCameraId && muxPlaybackReady) : cameraStatuses[button.dataset.cameraId];
    button.querySelector(".mini-dot").className = `mini-dot ${online ? "online" : (source?.type === "drone" ? "stream" : "offline")}`;
  });
  setControls(Boolean(!isDrone && agentOnline && cameraOnline && authenticated && settings.canPtz));
  window.NeoVisionTalk.setEnabled(Boolean(!isDrone && agentOnline && cameraOnline && authenticated && settings.canTalk));
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
  document.querySelectorAll(".move.active, .zoom-control.active").forEach((button) => button.classList.remove("active"));
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
      const errors = { unauthorized: t("unauthorized"), agent_offline: t("agentOffline"), invalid_ptz_command: t("invalidPtz"), invalid_talk_command: t("invalidTalk"), ptz_forbidden: "Seu perfil não possui permissão para PTZ.", talk_forbidden: "Seu perfil não possui permissão para falar na câmera." };
      message(errors[data.error] || `${t("error")}: ${data.error}`);
    }
  });
  socket.addEventListener("close", () => {
    if (generation !== connectionGeneration) return;
    authenticated = false;
    window.NeoVisionTalk.stop();
    agentOnline = false;
    cameraStatuses = {};
    cameraCapabilities = {};
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
elements.sourceTabs.forEach((tab) => tab.addEventListener("click", () => setSourceFilter(tab.dataset.sourceFilter)));
elements.singleView.addEventListener("click", () => setViewMode("single"));
elements.gridView.addEventListener("click", () => setViewMode("grid"));
elements.selectAllGrid.addEventListener("click", selectAllGrid);
elements.clearGrid.addEventListener("click", clearGrid);
function updateFullscreenButton() {
  const active = Boolean(document.fullscreenElement || document.webkitFullscreenElement || pseudoFullscreen);
  elements.fullscreen.textContent = active ? "✕ Sair da tela cheia" : "⛶ Tela cheia";
}

function setPseudoFullscreen(enabled) {
  pseudoFullscreen = enabled;
  document.documentElement.toggleAttribute("data-pseudo-fullscreen", enabled);
  updateFullscreenButton();
}

elements.fullscreen.addEventListener("click", async () => {
  if (pseudoFullscreen) { setPseudoFullscreen(false); return; }
  if (document.fullscreenElement || document.webkitFullscreenElement) {
    try { await (document.exitFullscreen?.() || document.webkitExitFullscreen?.()); } catch { setPseudoFullscreen(false); }
    return;
  }
  try {
    const request = elements.viewerCard.requestFullscreen || elements.viewerCard.webkitRequestFullscreen;
    if (!request) throw new Error("fullscreen_api_unavailable");
    await request.call(elements.viewerCard);
  } catch {
    setPseudoFullscreen(true);
    message("Tela cheia adaptada ativada para este navegador.");
  }
  updateFullscreenButton();
});
document.addEventListener("fullscreenchange", updateFullscreenButton);
document.addEventListener("webkitfullscreenchange", updateFullscreenButton);
elements.goLive.addEventListener("click", () => goToLive());
elements.liveTimeline.addEventListener("input", () => {
  if (!elements.muxPlayer.seekable?.length) return;
  const end = elements.muxPlayer.seekable.end(elements.muxPlayer.seekable.length - 1);
  elements.muxPlayer.currentTime = end - (30 - Number(elements.liveTimeline.value));
});
elements.muxPlayer.addEventListener("playing", () => { muxPlaybackReady = true; showStatus(); });
elements.muxPlayer.addEventListener("waiting", () => { muxPlaybackReady = false; showStatus(); });
elements.muxPlayer.addEventListener("error", () => { muxPlaybackReady = false; showStatus(); });
elements.renameCamera.addEventListener("click", async () => {
  const camera = selectedCamera();
  if (!camera) return;
  const name = window.prompt("Nome personalizado desta fonte:", cameraLabel(camera));
  if (name === null) return;
  try { await window.NeoVisionSettings.saveCameraName(camera.id, name); message("Nome atualizado para todos os usuários."); }
  catch { message("Não foi possível salvar o nome. O esquema de teste do Supabase precisa ser aplicado."); }
});
elements.adminToggle.addEventListener("click", () => { elements.adminPanel.hidden = false; renderAdminCameraNames(); loadProfiles(); window.NeoVisionAlerts?.load(); elements.adminPanel.scrollIntoView({ behavior: "smooth" }); });
elements.closeAdmin.addEventListener("click", () => { elements.adminPanel.hidden = true; });
elements.refreshProfiles.addEventListener("click", loadProfiles);
elements.cameraNamesForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  elements.cameraNamesMessage.textContent = "Salvando…";
  const names = Object.fromEntries([...elements.adminCameraNames.querySelectorAll("input[data-camera-id]")].map((input) => [input.dataset.cameraId, input.value]));
  try {
    await window.NeoVisionSettings.saveCameraNames(names);
    elements.cameraNamesMessage.textContent = "Nomes atualizados para todos os usuários.";
    renderAdminCameraNames();
  } catch {
    elements.cameraNamesMessage.textContent = "Não foi possível salvar. Aplique a atualização do Supabase de teste.";
  }
});
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
zoomControls.forEach((button) => {
  button.addEventListener("pointerdown", (event) => {
    event.preventDefault();
    button.setPointerCapture(event.pointerId);
    activeDirection = `zoom:${button.dataset.zoom}`;
    button.classList.add("active");
    send({ type: "ptz", cameraId: selectedCameraId, command: "zoom", direction: button.dataset.zoom, speed: 4 });
  });
  ["pointerup", "pointercancel", "lostpointercapture"].forEach((name) => button.addEventListener(name, () => {
    if (activeDirection === `zoom:${button.dataset.zoom}`) stop();
  }));
});
document.querySelector("#stop").addEventListener("click", stop);
window.addEventListener("blur", () => { if (activeDirection) stop(); });
document.addEventListener("visibilitychange", () => {
  if (!document.hidden) {
    window.NeoVisionSettings.refreshAccess().catch(() => {});
    return;
  }
  if (settings.autoPauseHidden) { elements.muxPlayer.pause(); pauseGridPlayers(); }
});
window.addEventListener("focus", () => window.NeoVisionSettings.refreshAccess().catch(() => {}));
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
  cameraCapabilities = {};
  showStatus();
}

window.NeoVisionAuth.onChange((session) => {
  if (!session) { resetConnection(); return; }
  window.NeoVisionSettings.load(session);
});

window.NeoVisionSettings.onChange((value) => {
  const firstLoad = !gridCameraIds.length;
  settings = value;
  if (firstLoad && Array.isArray(settings.gridCameraIds)) gridCameraIds = settings.gridCameraIds.slice(0, gridLimit());
  elements.adminToggle.hidden = settings.role !== "admin";
  if (settings.role !== "admin") elements.adminPanel.hidden = true;
  elements.adminMulticamera.checked = settings.multicameraEnabled;
  elements.adminGridLimit.value = String(normalizeGridLimit(settings.systemGridLimit));
  elements.adminAutoPause.checked = settings.autoPauseHidden;
  elements.adminIdleMinutes.value = String(settings.idleMinutes);
  elements.renameCamera.hidden = settings.role !== "admin";
  if (!settings.multicameraEnabled && viewMode === "grid") setViewMode("single");
  gridCameraIds = gridCameraIds.filter(canAccessCamera).slice(0, gridLimit());
  if (!canAccessCamera(selectedCameraId)) selectedCameraId = accessibleCameras()[0]?.id || "";
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
setInterval(() => {
  if (!document.hidden && window.NeoVisionAuth.session) window.NeoVisionSettings.refreshAccess().catch(() => {});
}, 30_000);
