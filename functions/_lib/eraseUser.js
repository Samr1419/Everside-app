// Deletes everything we hold for one parent: stored files, database rows and the sign in itself.
// Used by "delete my account", by "send me a zip and delete everything", and by the daily six month clean up.
// It throws if any step fails, so callers can report the problem and nothing is half hidden.
import { adminHeaders } from "./supabaseAdmin.js";

const TABLES = ["actions", "vault_items", "conversation_feedback", "children", "parents", "consent_records", "ai_usage"];
const BUCKET = "vault-files";

export async function eraseUser(userId, env) {
  const uid = encodeURIComponent(userId);
  const h = { ...adminHeaders(env), "Content-Type": "application/json" };

  // 1. Walk the user's folder tree and collect every file path (folders have no id).
  const files = [];
  const stack = [`${userId}`];
  let guard = 0;
  while (stack.length && guard++ < 500) {
    const prefix = stack.pop();
    for (let offset = 0; ; offset += 100) {
      const r = await fetch(`${env.SUPABASE_URL}/storage/v1/object/list/${BUCKET}`, {
        method: "POST", headers: h, body: JSON.stringify({ prefix, limit: 100, offset }),
      });
      if (!r.ok) throw new Error("Could not list files");
      const items = await r.json();
      for (const it of items) (it.id ? files : stack).push(`${prefix}/${it.name}`);
      if (items.length < 100) break;
    }
  }
  // 2. Delete the files in batches.
  for (let i = 0; i < files.length; i += 100) {
    const r = await fetch(`${env.SUPABASE_URL}/storage/v1/object/${BUCKET}`, {
      method: "DELETE", headers: h, body: JSON.stringify({ prefixes: files.slice(i, i + 100) }),
    });
    if (!r.ok) throw new Error("Could not delete files");
  }
  // 3. Delete rows (belt and braces, in case a foreign key does not cascade).
  for (const t of TABLES) {
    const r = await fetch(`${env.SUPABASE_URL}/rest/v1/${t}?user_id=eq.${uid}`, { method: "DELETE", headers: h });
    if (!r.ok && r.status !== 404) throw new Error(`Could not delete ${t}`);
  }
  // 3b. Cancellation feedback stays (it helps us improve) but loses the link to the person.
  const fb = await fetch(`${env.SUPABASE_URL}/rest/v1/cancellation_feedback?user_id=eq.${uid}`, {
    method: "PATCH", headers: { ...h, Prefer: "return=minimal" }, body: JSON.stringify({ user_id: null }),
  });
  if (!fb.ok && fb.status !== 404) throw new Error("Could not unlink feedback");
  const pr = await fetch(`${env.SUPABASE_URL}/rest/v1/profiles?id=eq.${uid}`, { method: "DELETE", headers: h });
  if (!pr.ok && pr.status !== 404) throw new Error("Could not delete profile");
  // 4. Delete the sign in itself.
  const del = await fetch(`${env.SUPABASE_URL}/auth/v1/admin/users/${uid}`, { method: "DELETE", headers: h });
  if (!del.ok && del.status !== 404) throw new Error("Could not delete account");
  return { files: files.length };
}
