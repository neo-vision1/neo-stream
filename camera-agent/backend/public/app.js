const $ = id => document.getElementById(id);
let polling = null;
let moving = false;

function headers() { return { 'content-type': 'application/json', 'x-api-key': $('key').value }; }
function cameraId() { return encodeURIComponent($('camera').value.trim()); }
async function api(path, options = {}) {
  const response = await fetch(path, { ...options, headers: headers() });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || `Erro ${response.status}`);
  return body;
}
function setState(kind, online) {
  $(`${kind}Dot`).className = `dot ${online ? 'online' : 'offline'}`;
  $(`${kind}Status`).textContent = online ? 'ONLINE' : 'OFFLINE';
}
async function refresh() {
  try {
    const s = await api(`/api/cameras/${cameraId()}/status`);
    setState('agent', s.agentOnline); setState('camera', s.cameraOnline);
    $('message').textContent = s.agentOnline ? 'Sistema conectado.' : 'Aguardando o Agent do notebook.';
  } catch (e) { setState('agent', false); setState('camera', false); $('message').textContent = e.message; }
}
async function move(direction, button) {
  if (moving) await stop();
  moving = true; button.classList.add('active');
  try { await api(`/api/cameras/${cameraId()}/ptz/move`, { method: 'POST', body: JSON.stringify({ direction, speed: 5 }) }); $('message').textContent = `Movendo: ${direction}`; }
  catch (e) { moving = false; button.classList.remove('active'); $('message').textContent = e.message; }
}
async function stop() {
  document.querySelectorAll('.move').forEach(b => b.classList.remove('active'));
  if (!moving) return;
  moving = false;
  try { await api(`/api/cameras/${cameraId()}/ptz/stop`, { method: 'POST', body: '{}' }); $('message').textContent = 'Câmera parada.'; }
  catch (e) { $('message').textContent = `STOP: ${e.message}`; }
}
document.querySelectorAll('.move').forEach(button => {
  button.addEventListener('pointerdown', e => { e.preventDefault(); button.setPointerCapture(e.pointerId); move(button.dataset.direction, button); });
  ['pointerup', 'pointercancel', 'lostpointercapture'].forEach(name => button.addEventListener(name, stop));
});
$('stop').addEventListener('click', () => { moving = true; stop(); });
$('connect').addEventListener('click', () => { sessionStorage.setItem('neoOperatorKey', $('key').value); clearInterval(polling); refresh(); polling = setInterval(refresh, 5000); });
$('key').value = sessionStorage.getItem('neoOperatorKey') || '';
window.addEventListener('blur', stop);

