(() => {
  const elements = {
    form: document.querySelector("#alertSettings"), enabled: document.querySelector("#alertsEnabled"),
    minutes: document.querySelector("#alertOfflineMinutes"), recipient: document.querySelector("#alertRecipient"),
    recovery: document.querySelector("#alertRecovery"), agent: document.querySelector("#alertAgent"),
    test: document.querySelector("#testAlert"), refresh: document.querySelector("#refreshAlerts"),
    message: document.querySelector("#alertMessage"), history: document.querySelector("#alertHistory")
  };
  const labels = {
    camera_offline: "Câmera sem sinal", camera_recovered: "Câmera recuperada",
    agent_offline: "Agent sem comunicação", agent_recovered: "Agent recuperado", test: "Alerta de teste"
  };

  async function request(action = "", options = {}) {
    const token = await window.NeoVisionAuth.getAccessToken();
    if (!token) throw new Error("Sessão expirada.");
    const siteId = document.querySelector("#site").value.trim();
    const response = await fetch(`/api/alerts/${encodeURIComponent(siteId)}${action}`, {
      ...options,
      headers: { "content-type": "application/json", authorization: `Bearer ${token}`, ...(options.headers || {}) }
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || "Não foi possível acessar os alertas.");
    return data;
  }

  function renderHistory(history = []) {
    elements.history.replaceChildren();
    if (!history.length) {
      const empty = document.createElement("p"); empty.className = "muted"; empty.textContent = "Nenhuma ocorrência registrada.";
      elements.history.append(empty); return;
    }
    for (const event of history.slice(0, 20)) {
      const row = document.createElement("div"); row.className = "alert-event";
      const title = document.createElement("strong"); title.textContent = event.cameraId ? `${event.cameraId} · ${labels[event.kind] || event.kind}` : (labels[event.kind] || event.kind);
      const detail = document.createElement("small");
      const delivery = event.delivery === "sent" ? "e-mail enviado" : event.delivery === "failed" ? "falha no e-mail" : "somente registrado";
      detail.textContent = `${new Date(event.occurredAt).toLocaleString("pt-BR")} · ${delivery}`;
      row.append(title, detail); elements.history.append(row);
    }
  }

  async function load() {
    elements.message.textContent = "Carregando alertas…";
    try {
      const data = await request();
      const config = data.config || {};
      elements.enabled.checked = config.enabled === true;
      elements.minutes.value = String(config.offlineMinutes || 5);
      elements.recipient.value = config.recipient || "";
      elements.recovery.checked = config.recoveryEnabled !== false;
      elements.agent.checked = config.agentAlertsEnabled !== false;
      elements.message.textContent = data.emailConfigured ? "Envio por e-mail configurado na Cloudflare." : "Monitoramento disponível; o envio por e-mail ainda não foi configurado na Cloudflare.";
      renderHistory(data.history);
    } catch (error) { elements.message.textContent = error.message; }
  }

  elements.form.addEventListener("submit", async (event) => {
    event.preventDefault();
    elements.message.textContent = "Salvando…";
    try {
      const data = await request("", { method: "PUT", body: JSON.stringify({
        enabled: elements.enabled.checked,
        offlineMinutes: Number(elements.minutes.value),
        recipient: elements.recipient.value,
        recoveryEnabled: elements.recovery.checked,
        agentAlertsEnabled: elements.agent.checked
      }) });
      elements.message.textContent = data.emailConfigured ? "Configurações salvas e envio habilitado." : "Configurações salvas. Falta configurar o envio de e-mail na Cloudflare.";
    } catch (error) { elements.message.textContent = error.message; }
  });

  elements.test.addEventListener("click", async () => {
    elements.test.disabled = true; elements.message.textContent = "Executando teste…";
    try {
      const data = await request("/test", { method: "POST" });
      elements.message.textContent = data.event?.delivery === "sent" ? "Alerta de teste enviado." : "Teste registrado, mas o envio de e-mail ainda não está configurado.";
      await load();
    } catch (error) { elements.message.textContent = error.message; }
    finally { elements.test.disabled = false; }
  });
  elements.refresh.addEventListener("click", load);
  window.NeoVisionAlerts = { load };
})();
