// Resend email client (https://resend.com). Uses the REST API directly via
// fetch so there's no SDK dependency to pin.

const API_KEY = process.env.RESEND_API_KEY || "";
const FROM = process.env.REMINDER_EMAIL_FROM || "";
const TO = process.env.REMINDER_EMAIL_TO || "";

export function resendConfigured() {
  return Boolean(API_KEY && FROM && TO);
}

export async function sendEmail({ subject, html, text, to }) {
  if (!resendConfigured()) {
    throw new Error(
      "Resend is not configured (set RESEND_API_KEY, REMINDER_EMAIL_FROM, REMINDER_EMAIL_TO)."
    );
  }
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: FROM,
      to: [to || TO],
      subject,
      html,
      text,
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Resend ${res.status}: ${body}`);
  }
  return res.json();
}
