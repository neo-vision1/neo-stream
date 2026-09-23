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
    return {
      role: ["admin", "operator", "viewer"].includes(profile.role) ? profile.role : "viewer",
      canPtz: profile.can_ptz === true,
      canTalk: profile.can_talk === true,
      multicameraLimit: [1, 2, 4, 6, 9, 11].includes(Number(profile.multicamera_limit)) ? Number(profile.multicamera_limit) : 1
    };
  } catch {
    return null;
  }
}
