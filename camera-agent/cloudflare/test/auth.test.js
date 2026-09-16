import test from "node:test";
import assert from "node:assert/strict";
import { supabaseConfigured, verifySupabaseUser } from "../src/auth.js";

const env = { SUPABASE_URL: "https://example.supabase.co", SUPABASE_ANON_KEY: "public-anon-key", ALLOWED_OPERATOR_EMAIL: "operador@example.com" };

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

test("rejects a valid Supabase user with another email", async () => {
  const user = await verifySupabaseUser(env, "c".repeat(30), async () => ({
    ok: true,
    json: async () => ({ id: "user-2", email: "outra@example.com" })
  }));
  assert.equal(user, null);
});
