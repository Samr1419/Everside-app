// Cloudflare Pages Function — creates a Stripe Checkout session for a
// subscription, keeping the Stripe secret key server-side only.
// Lives at /api/create-checkout-session once deployed.
import Stripe from "stripe";
import { getSupabaseUser, getProfileByUserId, patchProfileByUserId, priceIdFor } from "../_lib/supabaseAdmin.js";

export async function onRequestPost(context) {
  const { request, env } = context;

  // The browser names a plan and a billing period; only this function knows which Stripe price that means.
  let tier, interval;
  try {
    ({ tier, interval } = await request.json());
  } catch {
    return new Response("Invalid request body", { status: 400 });
  }
  const priceId = priceIdFor(tier, interval, env);
  if (!priceId) return new Response("Unknown plan", { status: 400 });

  const user = await getSupabaseUser(request, env);
  if (!user) return new Response("Not signed in", { status: 401 });

  const stripe = new Stripe(env.STRIPE_SECRET_KEY, { httpClient: Stripe.createFetchHttpClient() });

  // Reuse this parent's existing Stripe customer if we already made one,
  // otherwise create it and remember it on their profile.
  const profile = await getProfileByUserId(user.id, env);
  // One plan at a time: someone already paying changes plan or cancels from inside the app instead.
  if (profile?.subscription_status === "active" || profile?.subscription_status === "trialing") {
    return new Response("You already have a plan", { status: 409 });
  }
  let customerId = profile?.stripe_customer_id;
  if (!customerId) {
    const customer = await stripe.customers.create({
      email: user.email,
      metadata: { supabase_user_id: user.id },
    });
    customerId = customer.id;
    await patchProfileByUserId(user.id, { stripe_customer_id: customerId }, env);
  }

  const origin = new URL(request.url).origin;
  const session = await stripe.checkout.sessions.create({
    // ── App-specific, not part of the Checkout Studio config below ──────
    // Links the session to this parent's own Stripe customer so the webhook
    // can find their profile again by stripe_customer_id.
    customer: customerId,
    mode: "subscription", // Everside is a recurring subscription, not a one-off charge
    line_items: [{ price: priceId, quantity: 1 }],
    success_url: `${origin}/?checkout=success`,
    cancel_url: `${origin}/?checkout=cancelled`,

    // ── Configured in Checkout Studio — see STRIPE_INTEGRATION_TODO.md ──
    ui_mode: "hosted_page",
    billing_address_collection: "auto",
    phone_number_collection: { enabled: false },
    automatic_tax: { enabled: false },
    allow_promotion_codes: false,
    payment_method_collection: "always",
    submit_type: "auto",
    integration_identifier: "hosted_mobile_app_0001",
    origin_context: "mobile_app",
  });

  return new Response(JSON.stringify({ url: session.url }), {
    headers: { "Content-Type": "application/json" },
  });
}
