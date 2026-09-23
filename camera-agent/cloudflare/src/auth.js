export function supabaseConfigured(env) {
  return Boolean(env?.SUPABASE_URL && env?.SUPABASE_ANON_KEY);
}

export async function verifySupabaseUser(env, accessToken, fetchImpl = fetch) {
  if (!supabaseConfigured(env) || typeof accessToken !== "string" || accessToken.length < 20 || accessToken.length > 8192) {
    return null;
  }

  let userUrl;
  try {
    userUrl = new URL("/auth/v1/user", `${env.SUPABASE_URL.replace(/\/$/, "")}/`);
  } catch {
    return null;
  }

  try {
    const response = await fetchImpl(userUrl, {
      headers: {
        apikey: env.SUPABASE_ANON_KEY,
        authorization: `Bearer ${accessToken}`
      }
    });
    if (!response.ok) return null;
    const user = await response.json();
    return typeof user?.id === "string" && user.id ? { id: user.id, email: user.email || null } : null;
  } catch {
    return null;
  }
}

export async function getSupabasePermissions(env, accessToken, userId, fetchImpl = fetch) {
  if (!supabaseConfigured(env) || typeof userId !== "string" || !userId || typeof accessToken !== "string") return null;
  let profileUrl;
  try {
    profileUrl = new URL("/rest/v1/profiles", `${env.SUPABASE_URL.replace(/\/$/, "")}/`);
    profileUrl.searchParams.set("id", `eq.${userId}`);
    profileUrl.searchParams.set("select", "role,can_ptz,can_talk,multicamera_limit");
    profileUrl.searchParams.set("limit", "1");
  } catch {
    return null;
  }
  try {
    const response = await fetchImpl(profileUrl, {
      headers: { apikey: env.SUPABASE_ANON_KEY, authorization: `Bearer ${accessToken}` }
    });
    if (!response.ok) return null;
    const rows = await response.json();
    const profile = Array.isArray(rows) ? rows[0] : null;
    if (!profile) return null;
    const role = ["admin", "operator", "viewer"].includes(profile.role) ? profile.role : "viewer";
    const admin = role === "admin";
    const allCameraIds = Array.from({ length: 11 }, (_, index) => `CAM${String(index + 1).padStart(2, "0")}`);
    let allowedCameraIds = allCameraIds;
    if (!admin) {
      try {
        const accessUrl = new URL("/rest/v1/profile_camera_access", `${env.SUPABASE_URL.replace(/\/$/, "")}/`);
        accessUrl.searchParams.set("user_id", `eq.${userId}`);
        accessUrl.searchParams.set("select", "camera_id");
        const accessResponse = await fetchImpl(accessUrl, {
          headers: { apikey: env.SUPABASE_ANON_KEY, authorization: `Bearer ${accessToken}` }
        });
        if (accessResponse.ok) {
          const accessRows = await accessResponse.json();
          allowedCameraIds = Array.isArray(accessRows)
            ? accessRows.map((row) => row.camera_id).filter((cameraId) => allCameraIds.includes(cameraId))
            : [];
        }
      } catch {
        // Mantém compatibilidade até o esquema de acesso por câmera ser aplicado.
      }
    }
    return {
      role,
      canPtz: admin || profile.can_ptz === true,
      canTalk: admin || profile.can_talk === true,
      multicameraLimit: admin ? 11 : ([1, 2, 4, 6, 9, 11].includes(Number(profile.multicamera_limit)) ? Number(profile.multicamera_limit) : 1),
      allowedCameraIds
    };
  } catch {
    return null;
  }
}
