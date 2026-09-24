import test from "node:test";
import assert from "node:assert/strict";
import { brevoConfigured, sendBrevoEmail } from "../src/email.js";

test("reports Brevo as configured only with an API key", () => {
  assert.equal(brevoConfigured({}), false);
  assert.equal(brevoConfigured({ BREVO_API_KEY: "key" }), true);
});

test("sends a transactional email through Brevo", async (t) => {
  let request;
  t.mock.method(globalThis, "fetch", async (url, init) => {
    request = { url, init };
    return new Response(null, { status: 201 });
  });

  await sendBrevoEmail({ BREVO_API_KEY: "secret-key" }, {
    to: "destino@example.com",
    from: "remetente@example.com",
    subject: "Teste",
    text: "Mensagem"
  });

  assert.equal(request.url, "https://api.brevo.com/v3/smtp/email");
  assert.equal(request.init.headers["api-key"], "secret-key");
  assert.deepEqual(JSON.parse(request.init.body), {
    sender: { email: "remetente@example.com", name: "Neo Vision" },
    to: [{ email: "destino@example.com" }],
    subject: "Teste",
    textContent: "Mensagem"
  });
});

test("does not expose the Brevo response when delivery fails", async (t) => {
  t.mock.method(globalThis, "fetch", async () => new Response("sensitive response", { status: 401 }));
  await assert.rejects(
    sendBrevoEmail({ BREVO_API_KEY: "secret-key" }, {
      to: "destino@example.com", from: "remetente@example.com", subject: "Teste", text: "Mensagem"
    }),
    /brevo_http_401/
  );
});
