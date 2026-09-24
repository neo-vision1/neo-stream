const BREVO_EMAIL_ENDPOINT = "https://api.brevo.com/v3/smtp/email";

export function brevoConfigured(env = {}) {
  return Boolean(env.BREVO_API_KEY);
}

export async function sendBrevoEmail(env, { to, from, subject, text }) {
  if (!brevoConfigured(env)) throw new Error("brevo_not_configured");

  const response = await fetch(BREVO_EMAIL_ENDPOINT, {
    method: "POST",
    headers: {
      accept: "application/json",
      "api-key": env.BREVO_API_KEY,
      "content-type": "application/json"
    },
    body: JSON.stringify({
      sender: { email: from, name: "Neo Vision" },
      to: [{ email: to }],
      subject,
      textContent: text
    })
  });

  if (!response.ok) {
    const error = new Error(`brevo_http_${response.status}`);
    error.code = `brevo_http_${response.status}`;
    throw error;
  }
}
