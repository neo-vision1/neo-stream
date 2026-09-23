import test from "node:test";
import assert from "node:assert/strict";
import { getSupabasePermissions, supabaseConfigured, verifySupabaseUser } from "../src/auth.js";

const env = { SUPABASE_URL: "https://example.supabase.co", SUPABASE_ANON_KEY: "public-anon-key" };

test("detects missing Supabase configuration", () => {
  assert.equal(supabaseConfigured(env), true);
  assert.equal(supabaseConfigured({ SUPABASE_URL: env.SUPABASE_URL }), false);
});

test("validates an access token with Supabase Auth", async () => {
  const user = await verifySupabaseUser(env, "a".repeat(30), async (url, options) => {
    assert.equal(url.href, "https://example.supabase.co/auth/v1/user");
    assert.equal(options.headers.apikey, env.SUPABASE_ANON_KEY);
    assert.equal(options.headers.authorization, `Bearer ${"a".repeat(30)}`);
    return { ok: true, json: async () => ({ id: "user-1", email: "operador@example.com" }) };
  });
  assert.deepEqual(user, { id: "user-1", email: "operador@example.com" });
});

test("rejects invalid or refused access tokens", async () => {
  assert.equal(await verifySupabaseUser(env, "short", async () => { throw new Error("should not run"); }), null);
  assert.equal(await verifySupabaseUser(env, "b".repeat(30), async () => ({ ok: false })), null);
});

test("loads operator permissions with fail-closed booleans", async () => {
  const permissions = await getSupabasePermissions(env, "a".repeat(30), "user-1", async (url, options) => {
    assert.equal(options.headers.authorization, `Bearer ${"a".repeat(30)}`);
    if (url.pathname === "/rest/v1/profiles") {
      assert.equal(url.searchParams.get("id"), "eq.user-1");
      return { ok: true, json: async () => [{ role: "operator", can_ptz: true, can_talk: false, multicamera_limit: 6 }] };
    }
    assert.equal(url.pathname, "/rest/v1/profile_camera_access");
    return { ok: true, json: async () => [{ camera_id: "CAM06" }] };
  });
  assert.deepEqual(permissions, { role: "operator", canPtz: true, canTalk: false, multicameraLimit: 6, allowedCameraIds: ["CAM06"] });
});

test("rejects missing permission profiles", async () => {
  assert.equal(await getSupabasePermissions(env, "a".repeat(30), "user-1", async () => ({ ok: true, json: async () => [] })), null);
});

test("always grants the administrator full camera access", async () => {
  const permissions = await getSupabasePermissions(env, "a".repeat(30), "admin-1", async () => ({
    ok: true,
    json: async () => [{ role: "admin", can_ptz: false, can_talk: false, multicamera_limit: 1 }]
  }));
  assert.deepEqual(permissions, {
    role: "admin", canPtz: true, canTalk: true, multicameraLimit: 11,
    allowedCameraIds: ["CAM01", "CAM02", "CAM03", "CAM04", "CAM05", "CAM06", "CAM07", "CAM08", "CAM09", "CAM10", "CAM11"]
  });
});

test("falls back to all cameras while the access table is not installed", async () => {
  const permissions = await getSupabasePermissions(env, "a".repeat(30), "user-1", async (url) => {
    if (url.pathname === "/rest/v1/profiles") return { ok: true, json: async () => [{ role: "viewer", can_ptz: false, can_talk: false, multicamera_limit: 1 }] };
    return { ok: false, json: async () => ({}) };
  });
  assert.equal(permissions.allowedCameraIds.length, 11);
});
