import test from 'node:test';
import assert from 'node:assert/strict';
import { AgentRegistry } from '../src/state.js';

test('registra heartbeat e localiza câmera', () => {
  let time = 1000;
  const registry = new AgentRegistry(() => time);
  const socket = { readyState: 1 };
  registry.register('A1', 'OBRA', socket);
  registry.heartbeat('A1', { cameraId: 'CAM01', cameraOnline: true });
  assert.equal(registry.forCamera('CAM01').agentId, 'A1');
  assert.equal(registry.status('CAM01', 30000).cameraOnline, true);
  time = 32000;
  assert.equal(registry.status('CAM01', 30000).agentOnline, false);
});

test('remove apenas a sessão correspondente', () => {
  const registry = new AgentRegistry();
  const oldSocket = { readyState: 1 };
  const newSocket = { readyState: 1 };
  registry.register('A1', 'OBRA', oldSocket);
  registry.register('A1', 'OBRA', newSocket);
  registry.remove('A1', oldSocket);
  assert.equal(registry.agents.get('A1').socket, newSocket);
});

