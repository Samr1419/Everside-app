// Small helpers around the Stripe subscription calls the cancel, delete and checkout functions share.
// Every function takes the Stripe client as an argument so it can be tested with a stand in.
import Stripe from "stripe";

export const stripeClient = (env) => new Stripe(env.STRIPE_SECRET_KEY, { httpClient: Stripe.createFetchHttpClient() });

const LIVE = ["active", "trialing", "past_due", "unpaid"];

export async function liveSubscriptions(stripe, customerId) {
  const out = [];
  for (const status of LIVE) {
    const page = await stripe.subscriptions.list({ customer: customerId, status, limit: 10 });
    out.push(...page.data);
  }
  return out;
}

// Stop billing today. No refund and no final invoice; the terms should say so.
export async function cancelNow(stripe, customerId) {
  const subs = await liveSubscriptions(stripe, customerId);
  for (const sub of subs) await stripe.subscriptions.cancel(sub.id, { prorate: false, invoice_now: false });
  return subs.length;
}

// Keep access until the end of the period already paid for, then stop. flag=false takes the cancellation back.
export async function setCancelAtPeriodEnd(stripe, customerId, flag) {
  const subs = await liveSubscriptions(stripe, customerId);
  for (const sub of subs) await stripe.subscriptions.update(sub.id, { cancel_at_period_end: flag });
  return subs;
}

export function addMonths(date, n) {
  const d = new Date(date);
  d.setUTCMonth(d.getUTCMonth() + n);
  return d;
}
