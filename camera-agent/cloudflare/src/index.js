import { DurableObject } from "cloudflare:workers";
import { heartbeatCameras, heartbeatCapabilities, parseMessage, validIdentifier, validatePtz, validateTalk } from "./protocol.js";
import { getSupabasePermissions, supabaseConfigured, verifySupabaseUser } from "./auth.js";
import { alertText, DEFAULT_ALERT_CONFIG, evaluateAlerts, normalizeAlertConfig } from "./alerts.js";
import { brevoConfigured, sendBrevoEmail } from "./email.js";

const HEARTBEAT_MAX_AGE_MS = 30_000;

function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", ...headers }
  });
}

function send(ws, data) {
  try {
    ws.send(JSON.stringify(data));
    return true;
  } catch {
    return false;
  }
}

async function authEnvironment(env) {
  if (supabaseConfigured(env)) return env;
  if (!env.CONTROL_WORKER) return env;
  try {
    const response = await env.CONTROL_WORKER.fetch(new Request("https://control.internal/auth-config"));
    if (!response.ok) return env;
    const config = await response.json();
    return { ...env, SUPABASE_URL: config.supabaseUrl, SUPABASE_ANON_KEY: config.supabaseAnonKey };
  } catch {
    return env;
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/health") {
      return json({ ok: true, service: "neo-vision-camera", features: { emailAlerts: brevoConfigured(env) } });
    }

    if (url.pathname === "/auth-config") {
      if (env.CONTROL_WORKER) return env.CONTROL_WORKER.fetch(request);
      if (env.CONTROL_ORIGIN) return fetch(new Request(new URL("/auth-config", env.CONTROL_ORIGIN), request));
      if (!supabaseConfigured(env)) return json({ error: "Supabase not configured" }, 503, { "cache-control": "no-store" });
      return json({ supabaseUrl: env.SUPABASE_URL, supabaseAnonKey: env.SUPABASE_ANON_KEY }, 200, { "cache-control": "no-store" });
    }

    const alertMatch = url.pathname.match(/^\/api\/alerts\/([A-Za-z0-9_-]{1,64})(\/(?:test|history))?$/);
    if (alertMatch) {
      const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") || "";
      const authEnv = await authEnvironment(env);
      const user = await verifySupabaseUser(authEnv, token);
      const permissions = user ? await getSupabasePermissions(authEnv, token, user.id) : null;
      if (!user || permissions?.role !== "admin") return json({ error: "Admin access required" }, 403);
      const target = new URL(`/alerts/${alertMatch[1]}${alertMatch[2] || ""}`, "https://durable.internal");
      const init = { method: request.method, headers: { "content-type": "application/json", "x-neo-admin": "1" } };
      if (!["GET", "HEAD"].includes(request.method)) init.body = request.body;
      return env.CAMERA_SITE.getByName(alertMatch[1]).fetch(new Request(target, init));
    }

    const match = url.pathname.match(/^\/ws\/([A-Za-z0-9_-]{1,64})$/);
    if (match) {
      if (request.method !== "GET" || request.headers.get("Upgrade")?.toLowerCase() !== "websocket") {
        return json({ error: "WebSocket upgrade required" }, 426);
      }
      if (env.CONTROL_WORKER) return env.CONTROL_WORKER.fetch(request);
      if (env.CONTROL_ORIGIN) {
        const target = new URL(url.pathname, env.CONTROL_ORIGIN);
        return fetch(new Request(target, request));
      }
      return env.CAMERA_SITE.getByName(match[1]).fetch(request);
    }

    return env.ASSETS.fetch(request);
  }
};

export class CameraSite extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.ctx = ctx;
    this.env = env;
    this.ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair("ping", "pong"));
  }

  async fetch(request) {
    const url = new URL(request.url);
    const parts = url.pathname.split("/").filter(Boolean);
    if (parts[0] === "alerts") return this.alertApi(request, parts[1], parts[2]);
    const siteId = parts.at(-1);
    if (!validIdentifier(siteId)) return json({ error: "Invalid site" }, 400);

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    this.ctx.acceptWebSocket(server);
    server.serializeAttachment({ authenticated: false, role: null, siteId });
    return new Response(null, { status: 101, webSocket: client });
  }

  async alertApi(request, siteId, action) {
    if (request.headers.get("x-neo-admin") !== "1" || !validIdentifier(siteId)) return json({ error: "Forbidden" }, 403);
    const config = normalizeAlertConfig((await this.ctx.storage.get("alertConfig")) || DEFAULT_ALERT_CONFIG);
    const history = (await this.ctx.storage.get("alertHistory")) || [];
    if (request.method === "GET") return json({ config, history, emailConfigured: brevoConfigured(this.env) });
    if (request.method === "PUT" && !action) {
      let body;
      try { body = await request.json(); } catch { return json({ error: "Invalid JSON" }, 400); }
      const next = normalizeAlertConfig(body);
      await this.ctx.storage.put("alertConfig", next);
      if (next.enabled) await this.ctx.storage.setAlarm(Date.now() + 5_000);
      else {
        await this.ctx.storage.deleteAlarm();
        await this.ctx.storage.delete("alertState");
      }
      return json({ ok: true, config: next, emailConfigured: brevoConfigured(this.env) });
    }
    if (request.method === "POST" && action === "test") {
      const event = { kind: "test", occurredAt: Date.now() };
      const saved = await this.deliverAlert(event, siteId, config);
      return json({ ok: true, event: saved, emailConfigured: brevoConfigured(this.env) });
    }
    if (request.method === "DELETE" && action === "history") {
      await this.ctx.storage.delete("alertHistory");
      return json({ ok: true, history: [] });
    }
    return json({ error: "Method not allowed" }, 405);
  }

  async deliverAlert(event, siteId, config) {
    const content = alertText(event, siteId);
    let delivery = "not_configured";
    if (brevoConfigured(this.env) && config.recipient) {
      try {
        await sendBrevoEmail(this.env, {
          to: config.recipient,
          from: config.sender,
          subject: content.subject,
          text: content.text
        });
        delivery = "sent";
      } catch (error) {
        delivery = "failed";
        console.warn("Alert email failed", error?.code || "brevo_error");
      }
    }
    const saved = { id: crypto.randomUUID(), ...event, siteId, delivery };
    const history = (await this.ctx.storage.get("alertHistory")) || [];
    await this.ctx.storage.put("alertHistory", [saved, ...history].slice(0, 100));
    this.broadcast("operator", { type: "alert_event", event: saved });
    return saved;
  }

  async processAlerts(siteId) {
    const config = normalizeAlertConfig((await this.ctx.storage.get("alertConfig")) || DEFAULT_ALERT_CONFIG);
    if (!config.enabled) return;
    const status = (await this.ctx.storage.get("status")) || {};
    const previous = (await this.ctx.storage.get("alertState")) || {};
    const result = evaluateAlerts({ now: Date.now(), status, config, previous });
    await this.ctx.storage.put("alertState", result.state);
    for (const event of result.events) await this.deliverAlert(event, siteId, config);
  }

  async alarm() {
    const config = normalizeAlertConfig((await this.ctx.storage.get("alertConfig")) || DEFAULT_ALERT_CONFIG);
    if (!config.enabled) return;
    const siteId = (await this.ctx.storage.get("siteId")) || "OBRA_001";
    try { await this.processAlerts(siteId); }
    finally { await this.ctx.storage.setAlarm(Date.now() + 60_000); }
  }

  connections(role, excludedSocket = null) {
    return this.ctx.getWebSockets().filter((ws) => {
      const attachment = ws.deserializeAttachment();
      return ws !== excludedSocket && attachment?.authenticated && (!role || attachment.role === role);
    });
  }

  async currentStatus(siteId, excludedSocket = null) {
    const state = (await this.ctx.storage.get("status")) || {};
    const agentConnected = this.connections("agent", excludedSocket).length > 0;
    const heartbeatFresh = Date.now() - Number(state.lastHeartbeat || 0) <= HEARTBEAT_MAX_AGE_MS;
    const agentOnline = agentConnected && heartbeatFresh;
    const storedCameras = state.cameras || (state.cameraId ? { [state.cameraId]: Boolean(state.cameraOnline) } : {});
    const cameras = Object.entries(storedCameras).map(([cameraId, cameraOnline]) => ({
      cameraId,
      cameraOnline: agentOnline && Boolean(cameraOnline),
      supportsZoom: state.capabilities?.[cameraId]?.supportsZoom === true
    }));
    return {
      type: "status",
      siteId,
      agentOnline,
      cameras,
      cameraOnline: cameras.some((camera) => camera.cameraOnline),
      cameraId: cameras[0]?.cameraId || null,
      lastHeartbeat: state.lastHeartbeat || null
    };
  }

  broadcast(role, data) {
    for (const socket of this.connections(role)) send(socket, data);
  }

  operatorStatus(status, attachment) {
    const allowed = new Set(attachment?.allowedCameraIds || []);
    const cameras = (status.cameras || []).filter((camera) => allowed.has(camera.cameraId));
    return {
      ...status,
      cameras,
      cameraOnline: cameras.some((camera) => camera.cameraOnline),
      cameraId: cameras[0]?.cameraId || null
    };
  }

  async broadcastStatus(siteId, excludedSocket = null) {
    const status = await this.currentStatus(siteId, excludedSocket);
    for (const socket of this.connections("operator")) {
      send(socket, this.operatorStatus(status, socket.deserializeAttachment()));
    }
  }

  async authenticate(ws, message, attachment) {
    const role = message.role === "operator" ? "operator" : "agent";
    const operatorUser = role === "operator" ? await verifySupabaseUser(this.env, message.accessToken) : null;
    const operatorPermissions = operatorUser ? await getSupabasePermissions(this.env, message.accessToken, operatorUser.id) : null;
    const agentAuthorized = role === "agent" && this.env.AGENT_TOKEN && message.token === this.env.AGENT_TOKEN;
    if ((role === "operator" && !operatorUser) || (role === "agent" && !agentAuthorized)) {
      send(ws, { type: "error", error: "unauthorized" });
      ws.close(1008, "Unauthorized");
      return;
    }
    if (message.siteId !== attachment.siteId) {
      send(ws, { type: "error", error: "site_mismatch" });
      ws.close(1008, "Site mismatch");
      return;
    }

    const next = {
      ...attachment,
      authenticated: true,
      role,
      userId: operatorUser?.id || null,
      canPtz: role === "operator" && operatorPermissions?.canPtz === true,
      canTalk: role === "operator" && operatorPermissions?.canTalk === true,
      allowedCameraIds: role === "operator" ? (operatorPermissions?.allowedCameraIds || []) : [],
      agentId: role === "agent" && validIdentifier(message.agentId) ? message.agentId : null
    };
    ws.serializeAttachment(next);
    await this.ctx.storage.put("siteId", next.siteId);
    send(ws, { type: "auth_ok", role, siteId: next.siteId, permissions: role === "operator" ? { canPtz: next.canPtz, canTalk: next.canTalk, allowedCameraIds: next.allowedCameraIds } : undefined });
    if (role === "operator") send(ws, this.operatorStatus(await this.currentStatus(next.siteId), next));
  }

  async webSocketMessage(ws, raw) {
    const message = parseMessage(raw);
    const attachment = ws.deserializeAttachment() || {};
    if (!message) {
      send(ws, { type: "error", error: "invalid_json" });
      return;
    }

    if (!attachment.authenticated) {
      if (message.type !== "auth") {
        send(ws, { type: "error", error: "authentication_required" });
        ws.close(1008, "Authentication required");
        return;
      }
      await this.authenticate(ws, message, attachment);
      return;
    }

    if (attachment.role === "agent" && message.type === "heartbeat") {
      const status = {
        cameras: heartbeatCameras(message),
        capabilities: heartbeatCapabilities(message),
        lastHeartbeat: Date.now()
      };
      await this.ctx.storage.put("status", status);
      await this.processAlerts(attachment.siteId);
      await this.broadcastStatus(attachment.siteId);
      return;
    }

    if (attachment.role === "operator" && message.type === "ptz") {
      if (!attachment.canPtz) {
        send(ws, { type: "error", error: "ptz_forbidden" });
        return;
      }
      const command = validatePtz(message);
      if (!command) {
        send(ws, { type: "error", error: "invalid_ptz_command" });
        return;
      }
      if (!attachment.allowedCameraIds?.includes(command.cameraId)) {
        send(ws, { type: "error", error: "camera_forbidden" });
        return;
      }
      const agents = this.connections("agent");
      if (agents.length === 0) {
        send(ws, { type: "error", error: "agent_offline" });
        return;
      }
      command.commandId = crypto.randomUUID();
      for (const agent of agents) send(agent, command);
      send(ws, { type: "command_sent", commandId: command.commandId });
      return;
    }

    if (attachment.role === "operator" && message.type?.startsWith("talk_")) {
      if (!attachment.canTalk) {
        send(ws, { type: "error", error: "talk_forbidden" });
        return;
      }
      const command = validateTalk(message);
      if (!command) {
        send(ws, { type: "error", error: "invalid_talk_command" });
        return;
      }
      if (!attachment.allowedCameraIds?.includes(command.cameraId)) {
        send(ws, { type: "error", error: "camera_forbidden" });
        return;
      }
      const agents = this.connections("agent");
      if (agents.length === 0) {
        send(ws, { type: "error", error: "agent_offline" });
        return;
      }
      for (const agent of agents) send(agent, command);
      return;
    }

    if (attachment.role === "agent" && message.type === "command_result") {
      const ok = Boolean(message.ok ?? message.success);
      this.broadcast("operator", {
        type: "command_result",
        commandId: message.commandId || null,
        cameraId: validIdentifier(message.cameraId) ? message.cameraId : null,
        ok,
        error: ok ? null : String(message.error || "camera_error")
      });
      return;
    }

    if (attachment.role === "agent" && message.type === "talk_result") {
      this.broadcast("operator", {
        type: "talk_result",
        cameraId: validIdentifier(message.cameraId) ? message.cameraId : null,
        talkId: validIdentifier(message.talkId) ? message.talkId : null,
        action: ["started", "stopped"].includes(message.action) ? message.action : "error",
        ok: Boolean(message.ok),
        error: message.ok ? null : String(message.error || "talk_error").slice(0, 200)
      });
      return;
    }

    send(ws, { type: "error", error: "message_not_allowed" });
  }

  async webSocketClose(ws, code, reason) {
    const attachment = ws.deserializeAttachment();
    if (attachment?.role === "agent") {
      await this.broadcastStatus(attachment.siteId, ws);
    }
    try {
      ws.close(code, reason);
    } catch {
      // The runtime may already have completed the close handshake.
    }
  }

  webSocketError(ws) {
    try {
      ws.close(1011, "WebSocket error");
    } catch {
      // Socket is already closed.
    }
  }
}
