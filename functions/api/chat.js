// Everside Navigator proxy. Signed in users only. The server decides the model, the length,
// the scope of the conversation and how much each plan may use. The browser decides none of that.
// Needs the plan and usage functions from supabase-security/01_security_fixes_part1.sql.
import { getSupabaseUser } from "../_lib/supabaseAdmin.js";
import { SCOPE_GUARD, GUARD_REMINDER, OFF_TOPIC_TOKEN, OFF_TOPIC_REPLY, limitMessage } from "../_lib/aiScope.js";

const MODEL = "claude-sonnet-5";
const MAX_TOKENS_CHAT = 1000;
const MAX_TOKENS_FILING = 250;
const MAX_BODY_BYTES = 8_000_000;       // a 5 MB file is about 6.7 MB once base64 encoded
const KEEP_MESSAGES = 20;
const MAX_SYSTEM_CHARS = 30_000;
const MAX_TEXT_CHARS = 12_000;
const ATTACHMENT_REMOVED = "[A file shared earlier is not re-sent. Rely on your earlier reply about it.]";
const IMAGE_TYPES = { "image/jpeg": [0xff, 0xd8, 0xff], "image/png": [0x89, 0x50, 0x4e, 0x47], "image/gif": [0x47, 0x49, 0x46, 0x38], "image/webp": null };

const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
const bad = (msg = "Invalid request.") => json({ error: msg, reason: "invalid" }, 400);

function headBytes(b64, n = 12) {
  try { const s = atob(b64.slice(0, 24)); return Array.from(s.slice(0, n), (c) => c.charCodeAt(0)); } catch { return null; }
}
function looksLike(type, b64) {
  const h = headBytes(b64); if (!h) return false;
  if (type === "application/pdf") return h[0] === 0x25 && h[1] === 0x50 && h[2] === 0x44 && h[3] === 0x46; // %PDF
  if (type === "image/webp") return h[0] === 0x52 && h[1] === 0x49 && h[2] === 0x46 && h[3] === 0x46 && h[8] === 0x57 && h[9] === 0x45; // RIFF....WE
  const sig = IMAGE_TYPES[type]; return !!sig && sig.every((v, i) => h[i] === v);
}
// Best effort page count from the raw PDF. Compressed PDFs hide their page objects, so those fall back to a size estimate.
function pdfPages(b64, bytes) {
  try {
    const raw = atob(b64);
    const n = (raw.match(/\/Type\s*\/Page(?![s\w])/g) || []).length;
    if (n > 0) return n;
  } catch { /* fall through */ }
  return Math.max(1, Math.ceil(bytes / 150_000));
}

function cleanBlock(b) {
  if (!b || typeof b !== "object") return null;
  if (b.type === "text" && typeof b.text === "string" && b.text.length <= MAX_TEXT_CHARS) return { type: "text", text: b.text };
  if (b.type === "image" && b.source?.type === "base64" && typeof b.source.data === "string" && b.source.media_type in IMAGE_TYPES && looksLike(b.source.media_type, b.source.data))
    return { type: "image", source: { type: "base64", media_type: b.source.media_type, data: b.source.data } };
  if (b.type === "document" && b.source?.type === "base64" && b.source.media_type === "application/pdf" && typeof b.source.data === "string" && looksLike("application/pdf", b.source.data))
    return { type: "document", source: { type: "base64", media_type: "application/pdf", data: b.source.data } };
  return null;
}
const isFile = (b) => b.type === "image" || b.type === "document";

async function rpc(env, fn, args) {
  const r = await fetch(`${env.SUPABASE_URL}/rest/v1/rpc/${fn}`, {
    method: "POST",
    headers: { apikey: env.SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify(args),
  });
  if (!r.ok) throw new Error(`rpc ${fn} failed`);
  return r.json();
}

export async function onRequestPost({ request, env }) {
  const user = await getSupabaseUser(request, env);
  if (!user?.id) return json({ error: "Please sign in.", reason: "auth" }, 401);
  if (Number(request.headers.get("content-length") || 0) > MAX_BODY_BYTES) return json({ error: "That is too large to send.", reason: "file_too_big" }, 413);

  let body;
  try { body = await request.json(); } catch { return bad(); }
  const { system, messages, purpose } = body || {};
  const filing = purpose === "filing";                       // the AI is only suggesting a Vault folder and title
  if (typeof system !== "string" || system.length > MAX_SYSTEM_CHARS) return bad();
  if (!Array.isArray(messages) || messages.length === 0) return bad();

  // Rebuild each message from known fields only.
  const clean = [];
  for (const m of messages.slice(-KEEP_MESSAGES)) {
    if (!m || (m.role !== "user" && m.role !== "assistant")) return bad();
    if (typeof m.content === "string") {
      if (m.content.length > MAX_TEXT_CHARS) return json({ error: "That message is too long.", reason: "invalid" }, 400);
      clean.push({ role: m.role, content: m.content });
    } else if (Array.isArray(m.content) && m.content.length > 0) {
      const blocks = m.content.map(cleanBlock);
      if (blocks.some((x) => x === null)) return bad("That file type is not supported. Please use a JPG, PNG, WebP or PDF.");
      clean.push({ role: m.role, content: blocks });
    } else return bad();
  }
  while (clean.length && clean[0].role !== "user") clean.shift();
  if (!clean.length || clean[clean.length - 1].role !== "user") return bad();

  // Only the newest message may carry a file. Older files are replaced with a note so they are not paid for again.
  const lastIdx = clean.length - 1;
  let attachment = null;
  clean.forEach((m, i) => {
    if (!Array.isArray(m.content)) return;
    const files = m.content.filter(isFile);
    if (i === lastIdx) { if (files.length === 1) attachment = files[0]; else if (files.length > 1) attachment = "many"; }
    else if (files.length) m.content = m.content.filter((b) => !isFile(b)).concat({ type: "text", text: ATTACHMENT_REMOVED });
  });
  if (attachment === "many") return json({ error: "Please attach one file at a time.", reason: "invalid" }, 400);
  if (filing && !attachment) return bad();

  const isDoc = !!attachment;
  const bytes = isDoc ? Math.floor((attachment.source.data.length * 3) / 4) : 0;
  const pages = attachment?.type === "document" ? pdfPages(attachment.source.data, bytes) : null;

  let gate;
  try { gate = await rpc(env, "ai_check_and_count", { p_user: user.id, p_is_doc: isDoc, p_count_message: !filing, p_attach_bytes: bytes, p_pdf_pages: pages }); }
  catch { return json({ error: "Service unavailable. Please try again shortly.", reason: "unavailable" }, 503); }
  if (!gate.allowed) return json({ error: limitMessage(gate.reason, gate.usage), reason: gate.reason, usage: gate.usage }, 429);

  const upstream = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-api-key": env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01" },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: filing ? MAX_TOKENS_FILING : MAX_TOKENS_CHAT,
      system: [
        { type: "text", text: SCOPE_GUARD },
        { type: "text", text: system, cache_control: { type: "ephemeral" } },   // the child's context repeats every turn, so it is cached
        { type: "text", text: GUARD_REMINDER },
      ],
      messages: clean,
    }),
  });
  if (!upstream.ok) {
    // The parent should not lose an allowance because our provider failed.
    try { await rpc(env, "ai_refund", { p_user: user.id, p_was_doc: isDoc, p_was_message: !filing, p_strike: false }); } catch { /* best effort */ }
    return json({ error: "The Navigator is unavailable right now.", reason: "unavailable" }, 502);
  }
  const data = await upstream.json();
  const text = (data.content || []).filter((b) => b.type === "text").map((b) => b.text).join("").trim();

  if (new RegExp(`^${OFF_TOPIC_TOKEN}\\b`).test(text)) {
    let usage = gate.usage;
    try { usage = await rpc(env, "ai_refund", { p_user: user.id, p_was_doc: isDoc, p_was_message: !filing, p_strike: true }); } catch { /* best effort */ }
    return json({ content: [{ type: "text", text: OFF_TOPIC_REPLY }], off_topic: true, usage });
  }
  return json({ content: data.content, usage: gate.usage });
}
