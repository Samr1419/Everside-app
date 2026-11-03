// Cloudflare Pages Function — receives Stripe webhook events and is the
// ONLY place that writes subscription_status/tier to a parent's profile.
// Lives at /api/stripe-webhook — this exact URL is what you paste into
// Stripe's dashboard under Developers > Webhooks once deployed.
import Stripe from "stripe";
import {
  hasHandledWebhookEvent, recordWebhookEvent,
  patchProfileByCustomerId, tierForPriceId,
} from "../_lib/supabaseAdmin.js";
import { addMonths } from "../_lib/billing.js";

export async function onRequestPost(context) {
  const { request, env } = context;
  const signature = request.headers.get("stripe-signature");
  const payload = await request.text(); // raw body — signature verification needs the exact bytes Stripe sent

  const stripe = new Stripe(env.STRIPE_SECRET_KEY, { httpClient: Stripe.createFetchHttpClient() });
  const cryptoProvider = Stripe.createSubtleCryptoProvider();

  let event;
  try {
    event = await stripe.webhooks.constructEventAsync(payload, signature, env.STRIPE_WEBHOOK_SECRET, undefined, cryptoProvider);
  } catch (err) {
    return new Response("Webhook signature verification failed", { status: 400 });
  }

  if (await hasHandledWebhookEvent(event.id, env)) {
    return new Response(JSON.stringify({ received: true, duplicate: true }), { headers: { "Content-Type": "application/json" } });
  }

  try {
    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object;
        if (session.mode === "subscription" && session.subscription) {
          const subscription = await stripe.subscriptions.retrieve(session.subscription);
          await syncSubscription(subscription, env);
        }
        break;
      }
      case "customer.subscription.updated":
      case "customer.subscription.created": {
        await syncSubscription(event.data.object, env);
        break;
      }
      case "customer.subscription.deleted": {
        const subscription = event.data.object;
        // The plan has ended. Start the six month clock: if they have not renewed by then, a daily job deletes their data.
        await patchProfileByCustomerId(subscription.customer, {
          subscription_status: "canceled",
          subscription_tier: null,
          cancel_at_period_end: false,
          data_delete_after: addMonths(new Date(), 6).toISOString(),
          deletion_warned_30: null,
          deletion_warned_7: null,
        }, env);
        break;
      }
      default:
        // Other event types are ignored on purpose — this only needs enough
        // to know whether a parent's subscription is active and which tier.
        break;
    }
  } catch (err) {
    // Report the failure so Stripe retries delivery, rather than silently losing it.
    console.error("stripe webhook handling failed", err?.message);
    return new Response("Webhook handling error", { status: 500 });
  }

  await recordWebhookEvent(event.id, event.type, env);
  return new Response(JSON.stringify({ received: true }), { headers: { "Content-Type": "application/json" } });
}

async function syncSubscription(subscription, env) {
  const price = subscription.items?.data?.[0]?.price;
  const interval = price?.recurring?.interval;
  const paying = subscription.status === "active" || subscription.status === "trialing";
  const patch = {
    subscription_status: subscription.status, // 'trialing' | 'active' | 'past_due' | 'canceled' | ...
    subscription_tier: tierForPriceId(price?.id || null, env),
    billing_interval: interval === "month" || interval === "year" ? interval : null,
    cancel_at_period_end: !!subscription.cancel_at_period_end,
    current_period_end: new Date(subscription.current_period_end * 1000).toISOString(),
  };
  if (paying) {
    // Renewing (or starting again) cancels any pending deletion.
    patch.data_delete_after = null;
    patch.deletion_warned_30 = null;
    patch.deletion_warned_7 = null;
    if (!subscription.cancel_at_period_end) patch.data_choice = null;
  }
  await patchProfileByCustomerId(subscription.customer, patch, env);
}
