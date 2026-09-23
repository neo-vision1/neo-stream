export const DEFAULT_ALERT_CONFIG = Object.freeze({
  enabled: false,
  offlineMinutes: 5,
  recoveryEnabled: true,
  agentAlertsEnabled: true,
  recipient: "",
  sender: "alerts@neovision-es.com.br"
});

export function normalizeAlertConfig(value = {}) {
  const minutes = [1, 2, 5, 10, 15].includes(Number(value.offlineMinutes)) ? Number(value.offlineMinutes) : 5;
  const email = typeof value.recipient === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.recipient.trim()) ? value.recipient.trim().slice(0, 254) : "";
  const sender = typeof value.sender === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.sender.trim()) ? value.sender.trim().slice(0, 254) : DEFAULT_ALERT_CONFIG.sender;
  return {
    enabled: value.enabled === true,
    offlineMinutes: minutes,
    recoveryEnabled: value.recoveryEnabled !== false,
    agentAlertsEnabled: value.agentAlertsEnabled !== false,
    recipient: email,
    sender
  };
}

export function evaluateAlerts({ now, status = {}, config, previous = {} }) {
  const settings = normalizeAlertConfig(config);
  const threshold = settings.offlineMinutes * 60_000;
  const state = { agent: { ...(previous.agent || {}) }, cameras: { ...(previous.cameras || {}) } };
  const events = [];
  if (!settings.enabled) return { state: { agent: {}, cameras: {} }, events };

  const heartbeatAge = now - Number(status.lastHeartbeat || 0);
  const agentOnline = Boolean(status.lastHeartbeat) && heartbeatAge <= threshold;
  if (!agentOnline) {
    state.agent.offlineSince ||= Number(status.lastHeartbeat || now);
    if (settings.agentAlertsEnabled && !state.agent.notified && now - state.agent.offlineSince >= threshold) {
      state.agent.notified = true;
      events.push({ kind: "agent_offline", occurredAt: now, offlineSince: state.agent.offlineSince });
    }
    return { state, events };
  }

  if (state.agent.notified && settings.recoveryEnabled) {
    events.push({ kind: "agent_recovered", occurredAt: now, offlineSince: state.agent.offlineSince || null });
  }
  state.agent = {};

  const cameras = status.cameras || {};
  for (const [cameraId, cameraOnline] of Object.entries(cameras)) {
    const cameraState = { ...(state.cameras[cameraId] || {}) };
    if (!cameraOnline) {
      cameraState.offlineSince ||= now;
      if (!cameraState.notified && now - cameraState.offlineSince >= threshold) {
        cameraState.notified = true;
        events.push({ kind: "camera_offline", cameraId, occurredAt: now, offlineSince: cameraState.offlineSince });
      }
      state.cameras[cameraId] = cameraState;
    } else {
      if (cameraState.notified && settings.recoveryEnabled) {
        events.push({ kind: "camera_recovered", cameraId, occurredAt: now, offlineSince: cameraState.offlineSince || null });
      }
      delete state.cameras[cameraId];
    }
  }
  return { state, events };
}

export function alertText(event, siteId) {
  const labels = {
    agent_offline: "Agent sem comunicação",
    agent_recovered: "Agent voltou a comunicar",
    camera_offline: `${event.cameraId || "Câmera"} sem sinal`,
    camera_recovered: `${event.cameraId || "Câmera"} voltou a transmitir`,
    test: "Alerta de teste"
  };
  const title = labels[event.kind] || "Alerta Neo Vision";
  const lines = [title, `Local: ${siteId}`, `Horário: ${new Date(event.occurredAt).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })}`];
  if (event.offlineSince) lines.push(`Início da indisponibilidade: ${new Date(event.offlineSince).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })}`);
  return { subject: `[Neo Vision] ${title} — ${siteId}`, text: lines.join("\n") };
}
