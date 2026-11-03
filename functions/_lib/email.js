// Sends a plain text email through Resend (https://resend.com). Needs RESEND_API_KEY and MAIL_FROM
// (for example "Everside <hello@ever-side.co.uk>", on a domain you have verified with Resend).
// Returns true if the email was accepted, false if email is not set up or the send failed.
export async function sendEmail(env, { to, subject, text }) {
  if (!env.RESEND_API_KEY || !env.MAIL_FROM || !to) return false;
  try {
    const r = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: env.MAIL_FROM, to: [to], subject, text }),
    });
    return r.ok;
  } catch { return false; }
}
