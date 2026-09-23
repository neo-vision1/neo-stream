(() => {
  const defaults = {
    role: "viewer",
    canPtz: false,
    canTalk: false,
    multicameraEnabled: true,
    profileGridLimit: 4,
    systemGridLimit: 4,
    autoPauseHidden: true,
    idleMinutes: 10,
    cameraNames: {},
    gridCameraIds: []
  };
  let state = { ...defaults };
  let loadGeneration = 0;
  const listeners = new Set();

  function notify() { listeners.forEach((listener) => listener({ ...state })); }

  async function load(session) {
    const generation = ++loadGeneration;
    let nextState = { ...defaults, cameraNames: {}, gridCameraIds: [] };
    const client = window.NeoVisionAuth.client;
    const userId = session?.user?.id;
    if (!client || !userId) { state = nextState; notify(); return state; }
    try {
      const [profileResult, settingsResult, namesResult, viewResult] = await Promise.all([
        client.from("profiles").select("role,can_ptz,can_talk,multicamera_limit").eq("id", userId).maybeSingle(),
        client.from("app_settings").select("multicamera_enabled,max_multicamera,auto_pause_hidden,idle_minutes").eq("site_id", "OBRA_001").maybeSingle(),
        client.from("camera_preferences").select("camera_id,custom_name").eq("user_id", userId),
        client.from("viewer_preferences").select("grid_camera_ids").eq("user_id", userId).maybeSingle()
      ]);
      if (profileResult.data) nextState = {
        ...nextState,
        role: profileResult.data.role || "viewer",
        canPtz: profileResult.data.can_ptz !== false,
        canTalk: profileResult.data.can_talk !== false,
        profileGridLimit: profileResult.data.multicamera_limit || 4
      };
      if (nextState.role === "admin") nextState = { ...nextState, canPtz: true, canTalk: true, profileGridLimit: 11 };
      if (settingsResult.data) nextState = {
        ...nextState,
        multicameraEnabled: settingsResult.data.multicamera_enabled !== false,
        systemGridLimit: settingsResult.data.max_multicamera || 4,
        autoPauseHidden: settingsResult.data.auto_pause_hidden !== false,
        idleMinutes: settingsResult.data.idle_minutes || 10
      };
      if (Array.isArray(namesResult.data)) {
        nextState.cameraNames = Object.fromEntries(namesResult.data.map((row) => [row.camera_id, row.custom_name]).filter(([, name]) => name));
      }
      if (Array.isArray(viewResult.data?.grid_camera_ids)) {
        nextState.gridCameraIds = viewResult.data.grid_camera_ids.filter((id) => /^CAM[0-9]{2}$/.test(id));
      }
    } catch (error) {
      console.warn("Preferências remotas indisponíveis; usando padrões seguros.", error);
    }
    if (generation !== loadGeneration || window.NeoVisionAuth.session?.user?.id !== userId) return state;
    state = nextState;
    notify();
    return state;
  }

  async function refreshAccess() {
    const client = window.NeoVisionAuth.client;
    const userId = window.NeoVisionAuth.session?.user?.id;
    if (!client || !userId) return state;
    const [profileResult, settingsResult] = await Promise.all([
      client.from("profiles").select("role,can_ptz,can_talk,multicamera_limit").eq("id", userId).maybeSingle(),
      client.from("app_settings").select("multicamera_enabled,max_multicamera,auto_pause_hidden,idle_minutes").eq("site_id", "OBRA_001").maybeSingle()
    ]);
    if (window.NeoVisionAuth.session?.user?.id !== userId) return state;
    if (profileResult.error || !profileResult.data) throw profileResult.error || new Error("Perfil não encontrado.");
    const profile = profileResult.data;
    const admin = profile.role === "admin";
    state = {
      ...state,
      role: profile.role || "viewer",
      canPtz: admin || profile.can_ptz === true,
      canTalk: admin || profile.can_talk === true,
      profileGridLimit: admin ? 11 : (profile.multicamera_limit || 1)
    };
    if (settingsResult.data) state = {
      ...state,
      multicameraEnabled: settingsResult.data.multicamera_enabled !== false,
      systemGridLimit: settingsResult.data.max_multicamera || 4,
      autoPauseHidden: settingsResult.data.auto_pause_hidden !== false,
      idleMinutes: settingsResult.data.idle_minutes || 10
    };
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

  async function saveGridSelection(cameraIds) {
    const client = window.NeoVisionAuth.client;
    const userId = window.NeoVisionAuth.session?.user?.id;
    if (!client || !userId) return false;
    const gridCameraIds = [...new Set(cameraIds)].filter((id) => /^CAM[0-9]{2}$/.test(id)).slice(0, 11);
    const { error } = await client.from("viewer_preferences").upsert({
      user_id: userId,
      grid_camera_ids: gridCameraIds,
      updated_at: new Date().toISOString()
    }, { onConflict: "user_id" });
    if (error) throw error;
    state.gridCameraIds = gridCameraIds;
    return true;
  }

  async function listProfiles() {
    if (state.role !== "admin") throw new Error("Acesso administrativo necessário.");
    const client = window.NeoVisionAuth.client;
    const { data, error } = await client.from("profiles")
      .select("id,email,role,can_ptz,can_talk,multicamera_limit,created_at")
      .order("email", { ascending: true });
    if (error) throw error;
    return data || [];
  }

  async function updateProfile(id, values) {
    if (state.role !== "admin") throw new Error("Acesso administrativo necessário.");
    if (id === window.NeoVisionAuth.session?.user?.id) throw new Error("A conta em uso não pode ser alterada aqui.");
    const client = window.NeoVisionAuth.client;
    const payload = {
      role: ["admin", "operator", "viewer"].includes(values.role) ? values.role : "viewer",
      can_ptz: Boolean(values.canPtz),
      can_talk: Boolean(values.canTalk),
      multicamera_limit: [1, 2, 4, 6, 9, 11].includes(Number(values.multicameraLimit)) ? Number(values.multicameraLimit) : 1
    };
    const { data, error } = await client.from("profiles").update(payload).eq("id", id).select("id,role,can_ptz,can_talk,multicamera_limit").single();
    if (error) throw error;
    if (!data?.id) throw new Error("O Supabase não confirmou a atualização do perfil.");
    if (payload.multicamera_limit > state.systemGridLimit) {
      const nextSystemLimit = payload.multicamera_limit;
      const { error: settingsError } = await client.from("app_settings").upsert({
        site_id: "OBRA_001",
        multicamera_enabled: state.multicameraEnabled,
        max_multicamera: nextSystemLimit,
        auto_pause_hidden: state.autoPauseHidden,
        idle_minutes: state.idleMinutes,
        updated_at: new Date().toISOString()
      }, { onConflict: "site_id" });
      if (settingsError) throw settingsError;
      state = { ...state, systemGridLimit: nextSystemLimit };
      notify();
    }
    return data;
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
    load, refreshAccess, saveCameraName, saveGridSelection, saveAdminSettings, listProfiles, updateProfile,
    onChange(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    get value() { return { ...state, cameraNames: { ...state.cameraNames } }; }
  };
})();
