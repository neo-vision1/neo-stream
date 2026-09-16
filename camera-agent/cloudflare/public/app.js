const elements = {
  site: document.querySelector("#site"), key: document.querySelector("#key"), connect: document.querySelector("#connect"),
  message: document.querySelector("#message"), cameraList: document.querySelector("#cameraList"),
  cameraName: document.querySelector("#cameraName"), cameraIdBadge: document.querySelector("#cameraIdBadge"),
  muxPlayer: document.querySelector("#muxPlayer"), videoEmpty: document.querySelector("#videoEmpty"),
  agentDot: document.querySelector("#agentDot"), cameraDot: document.querySelector("#cameraDot"),
  agentStatus: document.querySelector("#agentStatus"), cameraStatus: document.querySelector("#cameraStatus")
};
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
  elements.cameraName.textContent = camera?.name || cameraId;
  elements.cameraIdBadge.textContent = cameraId;
  document.querySelectorAll(".camera-item").forEach((button) => button.classList.toggle("selected", button.dataset.cameraId === cameraId));

  if (camera?.playbackId) {
    const title = encodeURIComponent(camera.name || camera.id);
    elements.muxPlayer.src = `https://player.mux.com/${encodeURIComponent(camera.playbackId)}?stream-type=live&metadata-video-title=${title}`;
    elements.muxPlayer.hidden = false;
    elements.videoEmpty.hidden = true;
  } else {
    elements.muxPlayer.removeAttribute("src");
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
    button.innerHTML = `<span class="camera-number">${camera.id.replace("CAM", "")}</span><span><strong>${camera.name}</strong><small>${camera.id}</small></span><i class="mini-dot"></i>`;
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
    message("Conexão indisponível.");
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

function connect() {
  const generation = ++connectionGeneration;
  const siteId = elements.site.value.trim();
  const token = elements.key.value;
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(siteId) || !token) {
    message("Informe um local válido e a chave do operador.");
    return;
  }
  shouldReconnect = true;
  authenticated = false;
  clearTimeout(reconnectTimer);
  socket?.close();
  const scheme = location.protocol === "https:" ? "wss" : "ws";
  socket = new WebSocket(`${scheme}://${location.host}/ws/${siteId}`);
  message("Conectando ao Cloudflare…");
  setControls(false);

  socket.addEventListener("open", () => socket.send(JSON.stringify({ type: "auth", role: "operator", siteId, token })));
  socket.addEventListener("message", (event) => {
    let data;
    try { data = JSON.parse(event.data); } catch { return; }
    if (data.type === "auth_ok") {
      authenticated = true;
      sessionStorage.setItem("neoVisionOperatorKey", token);
      message("Painel conectado.");
    } else if (data.type === "status") {
      showStatus(data);
    } else if (data.type === "command_result") {
      message(data.ok ? `${data.cameraId || selectedCameraId}: comando executado.` : `Falha em ${data.cameraId || selectedCameraId}: ${data.error}`);
    } else if (data.type === "error") {
      const errors = { unauthorized: "Chave incorreta.", agent_offline: "Agent do notebook está offline.", invalid_ptz_command: "Comando PTZ inválido." };
      message(errors[data.error] || `Erro: ${data.error}`);
    }
  });
  socket.addEventListener("close", () => {
    if (generation !== connectionGeneration) return;
    authenticated = false;
    agentOnline = false;
    cameraStatuses = {};
    showStatus();
    if (shouldReconnect) {
      message("Conexão perdida. Tentando novamente…");
      reconnectTimer = setTimeout(connect, 3000);
    }
  });
  socket.addEventListener("error", () => message("Não foi possível conectar."));
}

elements.key.value = sessionStorage.getItem("neoVisionOperatorKey") || "";
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

renderCameraList();
selectCamera(selectedCameraId);
setControls(false);
