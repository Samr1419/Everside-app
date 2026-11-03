import { supabase } from "./supabaseClient";

// ── Parents / carers ──────────────────────────────────────────────────────
export async function fetchParents(userId) {
  const { data, error } = await supabase
    .from("parents").select("*").eq("user_id", userId).order("created_at");
  return { data, error };
}

export async function addParent(userId, { name, relationship, phone }) {
  const { data, error } = await supabase
    .from("parents").insert([{ user_id: userId, name, relationship, phone }]).select();
  return { data, error };
}

export async function setProfileDetails(address, local_authority) {
  const { error } = await supabase.rpc("set_profile_details", { new_address: address, new_local_authority: local_authority });
  return { error };
}

export async function fetchProfile(userId) {
  const { data, error } = await supabase.from("profiles").select("id, address, local_authority, subscription_status, subscription_tier, current_period_end, billing_interval, cancel_at_period_end, data_delete_after").eq("id", userId).single();
  return { data, error };
}

// ── Children ──────────────────────────────────────────────────────────────
export async function fetchChildren(userId) {
  const { data, error } = await supabase
    .from("children").select("*").eq("user_id", userId).order("created_at");
  return { data, error };
}

export async function addChild(userId, { name, age, conditions, condition_other, school_name, year_group, journey_stage }) {
  const { data, error } = await supabase
    .from("children")
    .insert([{ user_id: userId, name, age, conditions, condition_other, school_name, year_group, journey_stage: journey_stage ?? 0 }])
    .select();
  return { data, error };
}

export async function updateChildStage(childId, journey_stage) {
  const { data, error } = await supabase
    .from("children").update({ journey_stage }).eq("id", childId).select();
  return { data, error };
}

// ── Vault items — scoped per child ───────────────────────────────────────
export async function fetchVaultItems(userId, childId) {
  const { data, error } = await supabase
    .from("vault_items")
    .select("*")
    .eq("user_id", userId)
    .eq("child_id", childId)
    .order("created_at", { ascending: false });
  return { data, error };
}

export async function addVaultItem(userId, childId, { category, title, description, item_date, file_path, file_name, file_type, file_size }) {
  const { data, error } = await supabase
    .from("vault_items")
    .insert([{ user_id: userId, child_id: childId, category, title, description, item_date, file_path, file_name, file_type, file_size }])
    .select();
  return { data, error };
}

export async function deleteVaultItem(itemId) {
  const { error } = await supabase.from("vault_items").delete().eq("id", itemId);
  return { error };
}

// ── Vault documents — stored in the private "vault-files" bucket, one ──────
// folder per parent, so a file is only ever readable by its own account.
// Path shape: {userId}/{childId}/{category}/{timestamp}_{filename}
export async function uploadVaultFile(userId, childId, category, file) {
  const safeCategory = (category || "Evidence").replace(/[^a-zA-Z0-9 &_-]/g, "").trim() || "Evidence";
  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
  const path = `${userId}/${childId}/${safeCategory}/${Date.now()}_${safeName}`;
  const { error } = await supabase.storage.from("vault-files").upload(path, file, {
    contentType: file.type || "application/octet-stream",
    upsert: false,
  });
  if (error) return { path: null, error };
  return { path, error: null };
}

// A signed link that works for a short time, since the bucket itself is private.
export async function getVaultFileUrl(path, expiresInSeconds = 120) {
  const { data, error } = await supabase.storage.from("vault-files").createSignedUrl(path, expiresInSeconds);
  return { url: data?.signedUrl || null, error };
}

export async function deleteVaultItemAndFile(item) {
  if (item.file_path) {
    await supabase.storage.from("vault-files").remove([item.file_path]);
  }
  const { error } = await supabase.from("vault_items").delete().eq("id", item.id);
  return { error };
}

// ── Conversation feedback — a star rating shown when a parent leaves the ──
// Chat tab after a real exchange; anything below 4 stars asks what went wrong.
export async function submitConversationFeedback(userId, childId, rating, comment) {
  const { data, error } = await supabase
    .from("conversation_feedback")
    .insert([{ user_id: userId, child_id: childId, rating, comment: comment || null }])
    .select();
  return { data, error };
}

// ── Subscription / billing — reads the profile's own status, writes happen ──
// server-side only (via the Stripe webhook function), never directly from the app.
export async function fetchSubscriptionStatus(userId) {
  const { data, error } = await supabase
    .from("profiles")
    .select("subscription_status, subscription_tier, current_period_end")
    .eq("id", userId)
    .single();
  return { data, error };
}

// Asks our own Cloudflare Function to create a Stripe Checkout session and
// returns the URL to redirect the parent to. Never talks to Stripe directly
// from the browser, and never touches card details. The function identifies
// the parent from this Supabase access token, so it's sent along as a bearer
// token — the same token already sitting in the signed-in Supabase session.
async function authHeader() {
  const { data } = await supabase.auth.getSession();
  const token = data?.session?.access_token;
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export async function startCheckout(tier, interval) {
  const res = await fetch("/api/create-checkout-session", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(await authHeader()) },
    body: JSON.stringify({ tier, interval }),   // the server decides which Stripe price that means
  });
  if (!res.ok) return { url: null, error: await res.text() };
  const { url } = await res.json();
  return { url, error: null };
}

// Opens Stripe's hosted page for payment details and invoices. Cancelling is not done there: it goes through cancelPlan below.
export async function openBillingPortal() {
  const res = await fetch("/api/create-portal-session", {
    method: "POST",
    headers: { ...(await authHeader()) },
  });
  if (!res.ok) return { url: null, error: await res.text() };
  const { url } = await res.json();
  return { url, error: null };
}

// Cancels the plan. reason and choice are required: choice is "keep" (plan ends when the paid period ends, data kept 6 months)
// or "export_delete" (billing stops now and everything is deleted; confirmed must be true and the zip must already be saved).
// Returns { ok, deleted, ends_on, delete_after } or { error }.
export async function cancelPlan({ reason, comment, choice, confirmed }) {
  const res = await fetch("/api/cancel-subscription", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(await authHeader()) },
    body: JSON.stringify({ action: "cancel", reason, comment, choice, confirmed }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) return { error: data.error || "Something went wrong. Please try again." };
  return data;
}

export async function resumePlan() {
  const res = await fetch("/api/cancel-subscription", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(await authHeader()) },
    body: JSON.stringify({ action: "resume" }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) return { error: data.error || "Something went wrong. Please try again." };
  return data;
}

// ── Actions — scoped per child ───────────────────────────────────────────
export async function fetchActions(userId, childId) {
  const { data, error } = await supabase
    .from("actions")
    .select("*")
    .eq("user_id", userId)
    .eq("child_id", childId)
    .order("created_at", { ascending: false });
  return { data, error };
}

export async function addAction(userId, childId, { title, due_date, status = "upcoming" }) {
  const { data, error } = await supabase
    .from("actions")
    .insert([{ user_id: userId, child_id: childId, title, due_date, status }])
    .select();
  return { data, error };
}

export async function updateActionStatus(actionId, status) {
  const { data, error } = await supabase
    .from("actions").update({ status }).eq("id", actionId).select();
  return { data, error };
}

// ── Security panel: export / delete, now per child ───────────────────────
export async function deleteChildData(childId) {
  // Remove the stored files first, then the rows that point at them.
  const { data: items } = await supabase.from("vault_items").select("file_path").eq("child_id", childId);
  const paths = (items || []).map((i) => i.file_path).filter(Boolean);
  if (paths.length) await supabase.storage.from("vault-files").remove(paths);
  await supabase.from("vault_items").delete().eq("child_id", childId);
  await supabase.from("actions").delete().eq("child_id", childId);
}

// Deletes the whole account: every file, every row and the sign-in itself.
// The work happens in our own server function because only it can delete a user.
export async function deleteAccount() {
  const { data: { session } } = await supabase.auth.getSession();
  const res = await fetch("/api/delete-account", {
    method: "POST",
    headers: { Authorization: `Bearer ${session?.access_token}` },
  });
  if (!res.ok) return { error: new Error("Could not delete the account") };
  await supabase.auth.signOut();
  return { error: null };
}

// Keeps a record of what the parent agreed to, and under which version of our policies.
export async function recordConsents(userId, consentTypes, policyVersion) {
  if (!consentTypes?.length) return { error: null };
  const rows = consentTypes.map((consent_type) => ({ user_id: userId, consent_type, policy_version: policyVersion }));
  const { error } = await supabase.from("consent_records").insert(rows);
  return { error };
}

export async function exportFamilyData(userId) {
  const [{ data: parents }, { data: children }] = await Promise.all([
    fetchParents(userId),
    fetchChildren(userId),
  ]);
  const childData = await Promise.all(
    (children || []).map(async (c) => {
      const [{ data: vaultItems }, { data: actions }] = await Promise.all([
        fetchVaultItems(userId, c.id),
        fetchActions(userId, c.id),
      ]);
      return { ...c, vaultItems, actions };
    })
  );
  return { parents, children: childData, exportedAt: new Date().toISOString() };
}

// How much of the plan's Navigator allowance has been used, so the app can show it. Read only; the server enforces it.
export async function fetchAiUsage() {
  const { data, error } = await supabase.rpc("get_my_ai_usage");
  return { data, error };
}

// Tells the server the parent opened the app, so an account that is simply in use is never treated as abandoned.
// Fire and forget: if it fails, nothing visible happens.
export async function touchActivity() {
  try { await supabase.rpc("touch_activity"); } catch { /* ignore */ }
}
