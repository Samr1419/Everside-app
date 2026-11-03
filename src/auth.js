import { supabase } from "./supabaseClient";

// Passwordless — matches the onboarding flow, which only ever asks for an
// email address, not a separate account password. Supabase emails a magic
// link; clicking it signs the user in.
export async function signInWithMagicLink(email) {
  const { data, error } = await supabase.auth.signInWithOtp({ email });
  return { data, error };
}

export async function signOut() {
  const { error } = await supabase.auth.signOut();
  return { error };
}

export async function getCurrentUser() {
  const { data: { user } } = await supabase.auth.getUser();
  return user;
}

export function onAuthStateChange(callback) {
  const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
    callback(session?.user ?? null);
  });
  return () => listener.subscription.unsubscribe();
}

// ── Vault passcode ────────────────────────────────────────────────────────
// The 4-digit code is hashed server-side (see set_vault_passcode /
// check_vault_passcode in the schema) — the plain value never round-trips
// back from the database.
export async function setVaultPasscode(passcode) {
  const { error } = await supabase.rpc("set_vault_passcode", { new_passcode: passcode });
  return { error };
}

export async function checkVaultPasscode(attempt) {
  const { data, error } = await supabase.rpc("check_vault_passcode", { attempt });
  return { correct: data === true, error };
}
