// Deletes the signed in parent's whole account: stops billing, then removes stored files, database rows and the sign in.
// Only this function can do it (it uses the service role key); the browser just asks.
import { getSupabaseUser, getProfileByUserId } from "../_lib/supabaseAdmin.js";
import { stripeClient, cancelNow } from "../_lib/billing.js";
import { eraseUser } from "../_lib/eraseUser.js";

const json = (obj, status = 200) => new Response(JSON.stringify(obj), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });

export async function onRequestPost({ request, env }, deps = {}) {
  const user = await getSupabaseUser(request, env);
  if (!user?.id) return new Response("Not signed in", { status: 401 });
  try {
    // Stop billing first. If that fails nothing is deleted, so nobody ends up paying for an account that no longer exists.
    const profile = await getProfileByUserId(user.id, env);
    if (profile?.stripe_customer_id) {
      const stripe = deps.stripe || stripeClient(env);
      await cancelNow(stripe, profile.stripe_customer_id);
    }
    await eraseUser(user.id, env);
  } catch (e) {
    console.error("delete-account failed", e?.message);
    return json({ error: "We could not finish deleting the account. Nothing has been lost; please try again." }, 500);
  }
  return json({ ok: true });
}
