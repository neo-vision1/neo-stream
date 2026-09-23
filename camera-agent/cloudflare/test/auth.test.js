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
    assert.equal(url.pathname, "/rest/v1/profiles");
    assert.equal(url.searchParams.get("id"), "eq.user-1");
    assert.equal(options.headers.authorization, `Bearer ${"a".repeat(30)}`);
    return { ok: true, json: async () => [{ role: "operator", can_ptz: true, can_talk: false, multicamera_limit: 6 }] };
  });
  assert.deepEqual(permissions, { role: "operator", canPtz: true, canTalk: false, multicameraLimit: 6 });
});

test("rejects missing permission profiles", async () => {
  assert.equal(await getSupabasePermissions(env, "a".repeat(30), "user-1", async () => ({ ok: true, json: async () => [] })), null);
});
