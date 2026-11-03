// Runs once a day (Supabase pg_cron calls it, see supabase-security/04_schedule_deletion.sql).
//  1. Deletes the data of anyone whose paid plan ended more than six months ago and who has not renewed,
//     and of anyone without a paid plan who has not opened the app for six months.
//  2. Emails a warning 30 days and 7 days before that happens.
// Protected by a shared secret; the browser can never call it successfully.
import { adminHeaders } from "../_lib/supabaseAdmin.js";
import { eraseUser } from "../_lib/eraseUser.js";
import { sendEmail } from "../_lib/email.js";

const DAY = 86_400_000;
const json = (obj, status = 200) => new Response(JSON.stringify(obj), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });

function sameSecret(a, b) {
  if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

const PAYING = ["active", "trialing", "past_due", "unpaid", "incomplete"];   // never deleted while a plan is live or being chased for payment
const addMonths = (date, n) => { const d = new Date(date); d.setUTCMonth(d.getUTCMonth() + n); return d; };

// When, if ever, this account is due to be deleted, and why. One rule decides everything.
export function deletionPlan(p) {
  if (PAYING.includes(p.subscription_status)) return null;
  if (p.data_delete_after) return { due: Date.parse(p.data_delete_after), kind: "lapsed" };   // a paid plan ended and was not renewed
  if (p.last_active_at) return { due: addMonths(p.last_active_at, 6).getTime(), kind: "inactive" }; // no paid plan and not opened for 6 months
  return null;
}

function warningText(kind, why, when, appUrl) {
  const date = new Date(when).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "Europe/London" });
  const lead = kind === "7" ? `In one week, on ${date},` : `On ${date},`;
  const reason = why === "inactive"
    ? "You haven't opened Everside for almost six months."
    : "Your Everside plan ended some time ago.";
  const keep = why === "inactive"
    ? `1. Just sign in at ${appUrl} before that date. That's all it takes, and nothing will be deleted.`
    : `1. Start a plan again before that date. Sign in at ${appUrl} and choose a plan. Nothing will be deleted.`;
  return [
    "Hello,",
    "",
    `${reason} ${lead} we will permanently delete your account and everything in it: your children's details, your Vault documents and your actions. We do this automatically after six months, as our privacy policy explains.`,
    "",
    "If you want to keep your information, you have two choices:",
    keep,
    `2. Sign in and download everything first. In the app, open Plan, privacy and your data and choose "Download all my files".`,
    "",
    "If you do nothing, your data will be deleted on that date and cannot be recovered.",
    "",
    "The Everside team",
  ].join("\n");
}

export async function onRequestPost({ request, env }) {
  if (!env.CRON_SECRET || !sameSecret(request.headers.get("x-cron-secret"), env.CRON_SECRET)) return json({ error: "Not allowed" }, 401);

  const h = { ...adminHeaders(env), "Content-Type": "application/json" };
  const appUrl = env.APP_URL || new URL(request.url).origin;
  const now = Date.now();
  const result = { deleted: 0, failed: 0, warned_30: 0, warned_7: 0 };

  // Only lapsed accounts have a deletion date, so this list stays small. The decisions are made here, in code, where they can be tested.
  // Candidates: anyone with a deletion date, plus anyone not seen for about five months (within a month of the six month line).
  const cutoff = new Date(addMonths(now, -6).getTime() + 31 * DAY).toISOString();
  const r = await fetch(`${env.SUPABASE_URL}/rest/v1/profiles?or=(data_delete_after.not.is.null,last_active_at.lt.${encodeURIComponent(cutoff)})&select=id,subscription_status,data_delete_after,last_active_at,deletion_warned_30,deletion_warned_7&limit=1000`, { headers: h });
  if (!r.ok) return json({ error: "Could not read accounts" }, 500);
  const rows = await r.json();

  for (const p of rows) {
    const plan = deletionPlan(p);
    if (!plan || !Number.isFinite(plan.due)) continue;   // paying, or nothing due
    const due = plan.due;
    if (due <= now) {
      try { await eraseUser(p.id, env); result.deleted++; } catch (e) { result.failed++; console.error("purge failed for one account", e?.message); }
      continue;
    }
    const left = due - now;
    const kind = left <= 7 * DAY && !p.deletion_warned_7 ? "7" : left <= 30 * DAY && !p.deletion_warned_30 && !p.deletion_warned_7 ? "30" : null;
    if (!kind) continue;
    const u = await fetch(`${env.SUPABASE_URL}/auth/v1/admin/users/${encodeURIComponent(p.id)}`, { headers: h });
    const email = u.ok ? (await u.json())?.email : null;
    const sent = await sendEmail(env, { to: email, subject: kind === "7" ? "Your Everside data will be deleted in one week" : "Your Everside data will be deleted in 30 days", text: warningText(kind, plan.kind, due, appUrl) });
    if (!sent) continue; // try again tomorrow
    const stamp = new Date().toISOString();
    await fetch(`${env.SUPABASE_URL}/rest/v1/profiles?id=eq.${encodeURIComponent(p.id)}`, {
      method: "PATCH", headers: { ...h, Prefer: "return=minimal" },
      body: JSON.stringify(kind === "7" ? { deletion_warned_7: stamp, deletion_warned_30: p.deletion_warned_30 || stamp } : { deletion_warned_30: stamp }),
    });
    result[`warned_${kind}`]++;
  }
  return json(result);
}
