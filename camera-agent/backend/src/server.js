import 'dotenv/config';
import crypto from 'node:crypto';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { WebSocketServer, WebSocket } from 'ws';
import { AgentRegistry } from './state.js';

const PORT = Number(process.env.PORT || 8080);
const AGENT_TOKEN = process.env.AGENT_TOKEN || '';
const OPERATOR_KEY = process.env.OPERATOR_KEY || '';
const HEARTBEAT_TIMEOUT_MS = Number(process.env.HEARTBEAT_TIMEOUT_MS || 30000);
const COMMAND_TIMEOUT_MS = Number(process.env.COMMAND_TIMEOUT_MS || 5000);

if (!AGENT_TOKEN || !OPERATOR_KEY || AGENT_TOKEN.startsWith('troque-') || OPERATOR_KEY.startsWith('troque-')) {
  console.error('Configure AGENT_TOKEN e OPERATOR_KEY com valores seguros.');
  process.exit(1);
}

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ noServer: true });
const registry = new AgentRegistry();
const pending = new Map();
const publicDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');

app.use(express.json({ limit: '16kb' }));
app.use(express.static(publicDir));

app.get('/health', (_req, res) => res.json({ status: 'ok' }));

function requireOperator(req, res, next) {
  const supplied = req.get('x-api-key') || '';
  const a = Buffer.from(supplied);
  const b = Buffer.from(OPERATOR_KEY);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return res.status(401).json({ error: 'Chave do operador inválida' });
  next();
}

function sendCommand(cameraId, payload) {
  const agent = registry.forCamera(cameraId);
  if (!agent || agent.socket.readyState !== WebSocket.OPEN) throw Object.assign(new Error('Agent offline'), { status: 503 });
  const commandId = crypto.randomUUID();
  const message = { type: 'ptz', commandId, cameraId, ...payload };
  agent.lastCommand = { ...payload, at: new Date().toISOString() };
  agent.socket.send(JSON.stringify(message));
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { pending.delete(commandId); reject(Object.assign(new Error('Tempo de resposta excedido'), { status: 504 })); }, COMMAND_TIMEOUT_MS);
    pending.set(commandId, { resolve, reject, timer });
  });
}

app.get('/api/cameras/:cameraId/status', requireOperator, (req, res) => res.json(registry.status(req.params.cameraId, HEARTBEAT_TIMEOUT_MS)));
app.get('/api/agents', requireOperator, (_req, res) => res.json([...registry.agents.values()].map(a => registry.status(a.cameraId || '', HEARTBEAT_TIMEOUT_MS))));
app.post('/api/cameras/:cameraId/ptz/move', requireOperator, async (req, res) => {
  const direction = String(req.body.direction || '').toLowerCase();
  const speed = Math.max(1, Math.min(8, Number(req.body.speed || 5)));
  if (!['up', 'down', 'left', 'right'].includes(direction)) return res.status(400).json({ error: 'Direção inválida' });
  try { res.json(await sendCommand(req.params.cameraId, { command: 'move', direction, speed })); }
  catch (error) { res.status(error.status || 500).json({ error: error.message }); }
});
app.post('/api/cameras/:cameraId/ptz/stop', requireOperator, async (req, res) => {
  try { res.json(await sendCommand(req.params.cameraId, { command: 'stop' })); }
  catch (error) { res.status(error.status || 500).json({ error: error.message }); }
});

server.on('upgrade', (req, socket, head) => {
  if (new URL(req.url, 'http://localhost').pathname !== '/agent') return socket.destroy();
  wss.handleUpgrade(req, socket, head, ws => wss.emit('connection', ws));
});

wss.on('connection', ws => {
  let agentId = null;
  const authTimer = setTimeout(() => ws.close(4001, 'Auth timeout'), 5000);
  ws.on('message', raw => {
    let msg;
    try { msg = JSON.parse(raw.toString()); } catch { return ws.close(4002, 'JSON inválido'); }
    if (!agentId) {
      if (msg.type !== 'auth' || msg.token !== AGENT_TOKEN || !msg.agentId || !msg.siteId) return ws.close(4003, 'Autenticação inválida');
      agentId = String(msg.agentId);
      registry.register(agentId, String(msg.siteId), ws);
      clearTimeout(authTimer);
      return ws.send(JSON.stringify({ type: 'auth_ok' }));
    }
    if (msg.type === 'heartbeat') registry.heartbeat(agentId, msg);
    if (msg.type === 'command_result' && msg.commandId) {
      const item = pending.get(msg.commandId);
      if (item) {
        clearTimeout(item.timer); pending.delete(msg.commandId);
        msg.success ? item.resolve(msg) : item.reject(Object.assign(new Error(msg.error || 'Falha na câmera'), { status: 502 }));
      }
    }
  });
  ws.on('close', () => { clearTimeout(authTimer); if (agentId) registry.remove(agentId, ws); });
});

server.listen(PORT, () => console.log(`Neo Vision Camera Backend ativo na porta ${PORT}`));
