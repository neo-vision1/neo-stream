import { DurableObject } from "cloudflare:workers";
import { heartbeatCameras, parseMessage, validIdentifier, validatePtz } from "./protocol.js";

const HEARTBEAT_MAX_AGE_MS = 30_000;

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" }
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

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/health") {
      return json({ ok: true, service: "neo-vision-camera" });
    }

    const match = url.pathname.match(/^\/ws\/([A-Za-z0-9_-]{1,64})$/);
    if (match) {
      if (request.method !== "GET" || request.headers.get("Upgrade")?.toLowerCase() !== "websocket") {
        return json({ error: "WebSocket upgrade required" }, 426);
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
    const siteId = new URL(request.url).pathname.split("/").filter(Boolean).at(-1);
    if (!validIdentifier(siteId)) return json({ error: "Invalid site" }, 400);

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    this.ctx.acceptWebSocket(server);
    server.serializeAttachment({ authenticated: false, role: null, siteId });
    return new Response(null, { status: 101, webSocket: client });
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
      cameraOnline: agentOnline && Boolean(cameraOnline)
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

  async authenticate(ws, message, attachment) {
    const role = message.role === "operator" ? "operator" : "agent";
    const expected = role === "operator" ? this.env.OPERATOR_KEY : this.env.AGENT_TOKEN;
    if (!expected || typeof message.token !== "string" || message.token !== expected) {
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
      agentId: role === "agent" && validIdentifier(message.agentId) ? message.agentId : null
    };
    ws.serializeAttachment(next);
    send(ws, { type: "auth_ok", role, siteId: next.siteId });
    if (role === "operator") send(ws, await this.currentStatus(next.siteId));
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
        lastHeartbeat: Date.now()
      };
      await this.ctx.storage.put("status", status);
      this.broadcast("operator", await this.currentStatus(attachment.siteId));
      return;
    }

    if (attachment.role === "operator" && message.type === "ptz") {
      const command = validatePtz(message);
      if (!command) {
        send(ws, { type: "error", error: "invalid_ptz_command" });
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

    send(ws, { type: "error", error: "message_not_allowed" });
  }

  async webSocketClose(ws, code, reason) {
    const attachment = ws.deserializeAttachment();
    if (attachment?.role === "agent") {
      this.broadcast("operator", await this.currentStatus(attachment.siteId, ws));
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
