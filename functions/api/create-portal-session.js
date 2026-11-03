// Cloudflare Pages Function — opens Stripe's hosted Customer Portal so a
// parent can update their card or see invoices, without Everside
// ever handling card details. Lives at /api/create-portal-session.
import Stripe from "stripe";
import { getSupabaseUser, getProfileByUserId } from "../_lib/supabaseAdmin.js";

export async function onRequestPost(context) {
  const { request, env } = context;

  const user = await getSupabaseUser(request, env);
  if (!user) return new Response("Not signed in", { status: 401 });

  const profile = await getProfileByUserId(user.id, env);
  if (!profile?.stripe_customer_id) {
    return new Response("No subscription found for this account yet", { status: 404 });
  }

  const stripe = new Stripe(env.STRIPE_SECRET_KEY, { httpClient: Stripe.createFetchHttpClient() });
  const origin = new URL(request.url).origin;

  // Set STRIPE_PORTAL_CONFIGURATION to a portal configuration with cancellation switched OFF, so
  // cancelling always goes through the in-app flow (feedback and the choice about the parent's data).
  const portalSession = await stripe.billingPortal.sessions.create({
    customer: profile.stripe_customer_id,
    return_url: `${origin}/`,
    ...(env.STRIPE_PORTAL_CONFIGURATION ? { configuration: env.STRIPE_PORTAL_CONFIGURATION } : {}),
  });

  return new Response(JSON.stringify({ url: portalSession.url }), {
    headers: { "Content-Type": "application/json" },
  });
}
