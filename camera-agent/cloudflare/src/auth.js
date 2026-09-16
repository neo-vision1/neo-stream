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
