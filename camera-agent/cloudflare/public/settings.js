(() => {
  const defaults = {
    role: "viewer",
    canPtz: true,
    canTalk: true,
    multicameraEnabled: true,
    profileGridLimit: 4,
    systemGridLimit: 4,
    autoPauseHidden: true,
    idleMinutes: 10,
    cameraNames: {}
  };
  let state = { ...defaults };
  const listeners = new Set();

  function notify() { listeners.forEach((listener) => listener({ ...state })); }

  async function load(session) {
    state = { ...defaults, cameraNames: {} };
    const client = window.NeoVisionAuth.client;
    const userId = session?.user?.id;
    if (!client || !userId) { notify(); return state; }
    try {
      const [profileResult, settingsResult, namesResult] = await Promise.all([
        client.from("profiles").select("role,can_ptz,can_talk,multicamera_limit").eq("id", userId).maybeSingle(),
        client.from("app_settings").select("multicamera_enabled,max_multicamera,auto_pause_hidden,idle_minutes").eq("site_id", "OBRA_001").maybeSingle(),
        client.from("camera_preferences").select("camera_id,custom_name").eq("user_id", userId)
      ]);
      if (profileResult.data) state = {
        ...state,
        role: profileResult.data.role || "viewer",
        canPtz: profileResult.data.can_ptz !== false,
        canTalk: profileResult.data.can_talk !== false,
        profileGridLimit: profileResult.data.multicamera_limit || 4
      };
      if (settingsResult.data) state = {
        ...state,
        multicameraEnabled: settingsResult.data.multicamera_enabled !== false,
        systemGridLimit: settingsResult.data.max_multicamera || 4,
        autoPauseHidden: settingsResult.data.auto_pause_hidden !== false,
        idleMinutes: settingsResult.data.idle_minutes || 10
      };
      if (Array.isArray(namesResult.data)) {
        state.cameraNames = Object.fromEntries(namesResult.data.map((row) => [row.camera_id, row.custom_name]).filter(([, name]) => name));
      }
    } catch (error) {
      console.warn("Preferências remotas indisponíveis; usando padrões seguros.", error);
    }
    notify();
    return state;
  }

  async function saveCameraName(cameraId, customName) {
    const client = window.NeoVisionAuth.client;
    const userId = window.NeoVisionAuth.session?.user?.id;
    if (!client || !userId) return false;
    const name = String(customName || "").trim().slice(0, 60);
    const { error } = await client.from("camera_preferences").upsert({ user_id: userId, camera_id: cameraId, custom_name: name }, { onConflict: "user_id,camera_id" });
    if (error) throw error;
    state.cameraNames = { ...state.cameraNames, [cameraId]: name };
    notify();
    return true;
  }

  async function saveAdminSettings(values) {
    if (state.role !== "admin") throw new Error("Acesso administrativo necessário.");
    const client = window.NeoVisionAuth.client;
    const payload = {
      site_id: "OBRA_001",
      multicamera_enabled: Boolean(values.multicameraEnabled),
      max_multicamera: Number(values.systemGridLimit),
      auto_pause_hidden: Boolean(values.autoPauseHidden),
      idle_minutes: Number(values.idleMinutes),
      updated_at: new Date().toISOString()
    };
    const { error } = await client.from("app_settings").upsert(payload, { onConflict: "site_id" });
    if (error) throw error;
    state = { ...state, ...values };
    notify();
  }

  window.NeoVisionSettings = {
    load, saveCameraName, saveAdminSettings,
    onChange(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    get value() { return { ...state, cameraNames: { ...state.cameraNames } }; }
  };
})();
