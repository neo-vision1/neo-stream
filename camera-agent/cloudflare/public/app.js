const elements = {
  site: document.querySelector("#site"), camera: document.querySelector("#camera"), key: document.querySelector("#key"),
  connect: document.querySelector("#connect"), message: document.querySelector("#message"),
  agentDot: document.querySelector("#agentDot"), cameraDot: document.querySelector("#cameraDot"),
  agentStatus: document.querySelector("#agentStatus"), cameraStatus: document.querySelector("#cameraStatus")
};
const controls = [...document.querySelectorAll(".pad button")];
let socket = null;
let authenticated = false;
let reconnectTimer = null;
let shouldReconnect = false;
let activeDirection = null;
let connectionGeneration = 0;

function setControls(enabled) { controls.forEach((button) => { button.disabled = !enabled; }); }
function setDot(dot, online) { dot.className = `dot ${online ? "online" : "offline"}`; }
function message(text) { elements.message.textContent = text; }

function showStatus(status) {
  setDot(elements.agentDot, status.agentOnline);
  setDot(elements.cameraDot, status.cameraOnline);
  elements.agentStatus.textContent = status.agentOnline ? "ONLINE" : "OFFLINE";
  elements.cameraStatus.textContent = status.cameraOnline ? "ONLINE" : "OFFLINE";
  setControls(Boolean(status.agentOnline && status.cameraOnline && authenticated));
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
  send({ type: "ptz", cameraId: elements.camera.value.trim(), command: "stop" });
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

  socket.addEventListener("open", () => {
    socket.send(JSON.stringify({ type: "auth", role: "operator", siteId, token }));
  });
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
      message(data.ok ? "Comando executado." : `Falha na câmera: ${data.error}`);
    } else if (data.type === "error") {
      const errors = { unauthorized: "Chave incorreta.", agent_offline: "Agent do notebook está offline.", invalid_ptz_command: "Comando PTZ inválido." };
      message(errors[data.error] || `Erro: ${data.error}`);
    }
  });
  socket.addEventListener("close", () => {
    if (generation !== connectionGeneration) return;
    authenticated = false;
    showStatus({ agentOnline: false, cameraOnline: false });
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
    send({ type: "ptz", cameraId: elements.camera.value.trim(), command: "move", direction: activeDirection, speed: 4 });
  });
  ["pointerup", "pointercancel", "lostpointercapture"].forEach((name) => button.addEventListener(name, () => {
    if (activeDirection === button.dataset.direction) stop();
  }));
});
document.querySelector("#stop").addEventListener("click", stop);
window.addEventListener("blur", () => { if (activeDirection) stop(); });
setControls(false);
