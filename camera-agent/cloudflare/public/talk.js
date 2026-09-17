(() => {
  let button;
  let send;
  let getCameraId;
  let stream = null;
  let context = null;
  let processor = null;
  let source = null;
  let silent = null;
  let talkId = null;
  let ready = false;
  let enabled = false;
  let safetyTimer = null;

  function pcmBase64(floatSamples, inputRate) {
    const ratio = inputRate / 8000;
    const count = Math.floor(floatSamples.length / ratio);
    const bytes = new Uint8Array(count * 2);
    const view = new DataView(bytes.buffer);
    for (let i = 0; i < count; i += 1) {
      const start = Math.floor(i * ratio);
      const end = Math.max(start + 1, Math.floor((i + 1) * ratio));
      let sum = 0;
      for (let j = start; j < end && j < floatSamples.length; j += 1) sum += floatSamples[j];
      const sample = Math.max(-1, Math.min(1, sum / (end - start)));
      view.setInt16(i * 2, sample < 0 ? sample * 32768 : sample * 32767, true);
    }
    let binary = "";
    for (let i = 0; i < bytes.length; i += 1) binary += String.fromCharCode(bytes[i]);
    return btoa(binary);
  }

  async function cleanup(notify = true) {
    clearTimeout(safetyTimer);
    const endingId = talkId;
    const cameraId = getCameraId?.();
    talkId = null;
    ready = false;
    button?.classList.remove("active");
    if (processor) processor.disconnect();
    if (source) source.disconnect();
    if (silent) silent.disconnect();
    processor = source = silent = null;
    stream?.getTracks().forEach((track) => track.stop());
    stream = null;
    if (context) await context.close().catch(() => {});
    context = null;
    if (notify && endingId && cameraId) send({ type: "talk_stop", cameraId, talkId: endingId });
  }

  async function start(event) {
    event.preventDefault();
    if (!enabled || talkId) return;
    const cameraId = getCameraId();
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true }, video: false });
      context = new AudioContext({ latencyHint: "interactive" });
      source = context.createMediaStreamSource(stream);
      processor = context.createScriptProcessor(4096, 1, 1);
      silent = context.createGain();
      silent.gain.value = 0;
      source.connect(processor);
      processor.connect(silent);
      silent.connect(context.destination);
      talkId = crypto.randomUUID();
      processor.onaudioprocess = (audioEvent) => {
        if (!ready || !talkId) return;
        const audio = pcmBase64(audioEvent.inputBuffer.getChannelData(0), context.sampleRate);
        send({ type: "talk_audio", cameraId, talkId, audio });
      };
      button.classList.add("active");
      send({ type: "talk_start", cameraId, talkId });
      safetyTimer = setTimeout(() => cleanup(true), 30_000);
    } catch {
      await cleanup(false);
      window.dispatchEvent(new CustomEvent("neo-talk-error", { detail: "microphone_denied" }));
    }
  }

  function init(options) {
    button = options.button;
    send = options.send;
    getCameraId = options.getCameraId;
    button.addEventListener("pointerdown", start);
    ["pointerup", "pointercancel", "lostpointercapture"].forEach((name) => button.addEventListener(name, () => cleanup(true)));
    window.addEventListener("blur", () => cleanup(true));
  }

  function setEnabled(value) {
    enabled = Boolean(value && navigator.mediaDevices?.getUserMedia);
    if (button) button.disabled = !enabled;
    if (!enabled && talkId) cleanup(true);
  }

  function handleMessage(message) {
    if (message.type !== "talk_result" || message.talkId !== talkId) return false;
    if (!message.ok) {
      cleanup(false);
      window.dispatchEvent(new CustomEvent("neo-talk-error", { detail: message.error || "talk_error" }));
    } else if (message.action === "started") {
      ready = true;
      window.dispatchEvent(new CustomEvent("neo-talk-started"));
    } else if (message.action === "stopped") {
      cleanup(false);
    }
    return true;
  }

  window.NeoVisionTalk = { init, setEnabled, handleMessage, stop: () => cleanup(true) };
})();
