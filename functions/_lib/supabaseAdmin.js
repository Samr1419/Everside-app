// Shared helpers for the Stripe functions. Filenames/folders starting with
// "_" are ignored by Cloudflare Pages Functions routing, so this file is
// just a plain module the other functions import — it is not itself a route.

// Verifies the parent's Supabase access token (sent as "Authorization:
// Bearer <token>" from dataLayer.js) and returns { id, email }, or null if
// the token is missing/invalid. This never uses the service role key, so a
// forged or expired token simply fails, the same as any other Supabase call.
export async function getSupabaseUser(request, env) {
  const authHeader = request.headers.get("Authorization");
  if (!authHeader) return null;
  const res = await fetch(`${env.SUPABASE_URL}/auth/v1/user`, {
    headers: { Authorization: authHeader, apikey: env.SUPABASE_ANON_KEY },
  });
  if (!res.ok) return null;
  return res.json();
}

// The next few use the service role key, so they run only server-side here
// — never sent to or callable from the browser — and can read/write any
// row regardless of RLS. Keep every use of this key inside /functions.
export async function getProfileByUserId(userId, env) {
  const res = await fetch(
    `${env.SUPABASE_URL}/rest/v1/profiles?id=eq.${encodeURIComponent(userId)}&select=stripe_customer_id,subscription_status,subscription_tier,billing_interval,cancel_at_period_end,current_period_end,data_choice`,
    { headers: adminHeaders(env) }
  );
  const rows = await res.json();
  return rows?.[0] || null;
}

export async function patchProfileByUserId(userId, patch, env) {
  await fetch(`${env.SUPABASE_URL}/rest/v1/profiles?id=eq.${encodeURIComponent(userId)}`, {
    method: "PATCH",
    headers: { ...adminHeaders(env), "Content-Type": "application/json", Prefer: "return=minimal" },
    body: JSON.stringify(patch),
  });
}

export async function patchProfileByCustomerId(stripeCustomerId, patch, env) {
  await fetch(`${env.SUPABASE_URL}/rest/v1/profiles?stripe_customer_id=eq.${encodeURIComponent(stripeCustomerId)}`, {
    method: "PATCH",
    headers: { ...adminHeaders(env), "Content-Type": "application/json", Prefer: "return=minimal" },
    body: JSON.stringify(patch),
  });
}

// Stripe retries webhook deliveries, so every event id is recorded once it's
// handled, and a repeat delivery of the same event id is skipped.
export async function hasHandledWebhookEvent(eventId, env) {
  const res = await fetch(`${env.SUPABASE_URL}/rest/v1/stripe_webhook_events?id=eq.${encodeURIComponent(eventId)}&select=id`, {
    headers: adminHeaders(env),
  });
  const rows = await res.json();
  return Array.isArray(rows) && rows.length > 0;
}

export async function recordWebhookEvent(eventId, type, env) {
  await fetch(`${env.SUPABASE_URL}/rest/v1/stripe_webhook_events`, {
    method: "POST",
    headers: { ...adminHeaders(env), "Content-Type": "application/json", Prefer: "return=minimal,resolution=ignore-duplicates" },
    body: JSON.stringify({ id: eventId, type }),
  });
}

export function adminHeaders(env) {
  return { apikey: env.SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}` };
}

// There are four Stripe prices: each tier has a monthly and an annual one. Their ids live in Cloudflare variables.
const PRICE_VARS = {
  guided: { month: "STRIPE_PRICE_GUIDED_MONTHLY", year: "STRIPE_PRICE_GUIDED_ANNUAL" },
  full_support: { month: "STRIPE_PRICE_FULL_SUPPORT_MONTHLY", year: "STRIPE_PRICE_FULL_SUPPORT_ANNUAL" },
};

// Which Stripe price to charge for a tier and billing period. Returns null for anything we do not sell,
// so the browser can never name its own price.
export function priceIdFor(tier, interval, env) {
  const name = PRICE_VARS[tier]?.[interval];
  return name && env[name] ? env[name] : null;
}

// Maps a Stripe Price id back to the internal tier name stored on the profile.
export function tierForPriceId(priceId, env) {
  if (!priceId) return null;
  for (const [tier, byInterval] of Object.entries(PRICE_VARS)) {
    for (const name of Object.values(byInterval)) if (env[name] && env[name] === priceId) return tier;
  }
  return null;
}
