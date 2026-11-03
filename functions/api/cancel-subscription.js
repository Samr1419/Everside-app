// Cancels, or resumes, the signed in parent's plan. Cancelling always comes with two things:
//  1. why they are leaving (feedback), and
//  2. what should happen to their data: "keep" (plan ends when the paid period ends, data is kept for 6 months and then
//     deleted automatically unless they renew) or "export_delete" (the app has already made them a zip; billing stops now
//     and everything, including the account, is deleted).
import { getSupabaseUser, getProfileByUserId, patchProfileByUserId, adminHeaders } from "../_lib/supabaseAdmin.js";
import { stripeClient, liveSubscriptions, cancelNow, setCancelAtPeriodEnd, addMonths } from "../_lib/billing.js";
import { eraseUser } from "../_lib/eraseUser.js";

export const REASONS = ["too_expensive", "got_what_i_needed", "not_using_enough", "answers_not_helpful", "missing_feature", "privacy_concern", "technical_problems", "other", "prefer_not_to_say"];
const json = (obj, status = 200) => new Response(JSON.stringify(obj), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });

async function saveFeedback(env, row) {
  const r = await fetch(`${env.SUPABASE_URL}/rest/v1/cancellation_feedback`, {
    method: "POST", headers: { ...adminHeaders(env), "Content-Type": "application/json", Prefer: "return=minimal" }, body: JSON.stringify(row),
  });
  if (!r.ok) throw new Error("feedback not saved");
}

export async function onRequestPost({ request, env }, deps = {}) {
  const user = await getSupabaseUser(request, env);
  if (!user?.id) return json({ error: "Please sign in.", reason: "auth" }, 401);
  let body;
  try { body = await request.json(); } catch { return json({ error: "Invalid request." }, 400); }
  const action = body?.action === "resume" ? "resume" : "cancel";

  const profile = await getProfileByUserId(user.id, env);
  if (!profile?.stripe_customer_id) return json({ error: "There is no plan on this account." }, 404);
  const stripe = deps.stripe || stripeClient(env);

  try {
    if (action === "resume") {
      const subs = await setCancelAtPeriodEnd(stripe, profile.stripe_customer_id, false);
      if (!subs.length) return json({ error: "There is no plan to resume." }, 409);
      await patchProfileByUserId(user.id, { cancel_at_period_end: false, data_choice: null }, env);
      return json({ ok: true });
    }

    // ---- cancel ----
    const { reason, comment, choice } = body || {};
    if (!REASONS.includes(reason)) return json({ error: "Please tell us why you are leaving, or choose 'Prefer not to say'." }, 400);
    if (choice !== "keep" && choice !== "export_delete") return json({ error: "Please choose what should happen to your data." }, 400);
    const note = typeof comment === "string" ? comment.trim().slice(0, 1000) || null : null;
    if (choice === "export_delete" && body.confirmed !== true) return json({ error: "Please confirm you have saved your files." }, 400);

    const live = await liveSubscriptions(stripe, profile.stripe_customer_id);
    if (!live.length) return json({ error: "There is no active plan to cancel." }, 409);

    await saveFeedback(env, { user_id: user.id, tier: profile.subscription_tier || null, billing_interval: profile.billing_interval || null, reason, comment: note, data_choice: choice });

    if (choice === "keep") {
      await setCancelAtPeriodEnd(stripe, profile.stripe_customer_id, true);
      await patchProfileByUserId(user.id, { cancel_at_period_end: true, data_choice: "keep" }, env);
      const endsOn = profile.current_period_end || null;
      const deleteAfter = endsOn ? addMonths(endsOn, 6).toISOString() : null;
      return json({ ok: true, deleted: false, ends_on: endsOn, delete_after: deleteAfter });
    }

    // export_delete: stop billing today, then remove everything. Billing stops first so a failure never leaves a paying ghost account.
    await cancelNow(stripe, profile.stripe_customer_id);
    await eraseUser(user.id, env);
    return json({ ok: true, deleted: true });
  } catch (e) {
    console.error("cancel-subscription failed", e?.message);
    return json({ error: "Something went wrong and we could not finish. Nothing has been lost; please try again." }, 500);
  }
}
