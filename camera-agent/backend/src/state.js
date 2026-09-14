export class AgentRegistry {
  constructor(now = () => Date.now()) {
    this.now = now;
    this.agents = new Map();
    this.cameras = new Map();
  }

  register(agentId, siteId, socket) {
    this.remove(agentId);
    this.agents.set(agentId, { agentId, siteId, socket, lastHeartbeat: this.now(), cameraOnline: false, cameraId: null, lastCommand: null });
    return this.agents.get(agentId);
  }

  heartbeat(agentId, data) {
    const agent = this.agents.get(agentId);
    if (!agent) return null;
    agent.lastHeartbeat = this.now();
    agent.cameraOnline = Boolean(data.cameraOnline);
    if (data.cameraId) {
      if (agent.cameraId && agent.cameraId !== data.cameraId) this.cameras.delete(agent.cameraId);
      agent.cameraId = data.cameraId;
      this.cameras.set(data.cameraId, agentId);
    }
    return agent;
  }

  forCamera(cameraId) {
    const id = this.cameras.get(cameraId);
    return id ? this.agents.get(id) : null;
  }

  remove(agentId, socket) {
    const agent = this.agents.get(agentId);
    if (!agent || (socket && agent.socket !== socket)) return;
    if (agent.cameraId) this.cameras.delete(agent.cameraId);
    this.agents.delete(agentId);
  }

  status(cameraId, staleMs) {
    const agent = this.forCamera(cameraId);
    if (!agent) return { cameraId, agentOnline: false, cameraOnline: false };
    const agentOnline = this.now() - agent.lastHeartbeat <= staleMs && agent.socket.readyState === 1;
    return { cameraId, agentOnline, cameraOnline: agentOnline && agent.cameraOnline, agentId: agent.agentId, siteId: agent.siteId, lastHeartbeat: new Date(agent.lastHeartbeat).toISOString(), lastCommand: agent.lastCommand };
  }
}

