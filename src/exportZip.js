// Builds a zip of everything a parent has in Everside, entirely in their browser: nothing is sent anywhere.
// Contents: README.txt, everside-data.json (children, actions, Vault index), documents/ (the real files), and
// conversations/ (the Navigator chats that are open in this session; chats are not stored on our servers).
import JSZip from "jszip";
import { supabase } from "./supabaseClient";
import { exportFamilyData } from "./dataLayer";

const safe = (t, fallback = "item") =>
  (String(t || fallback).replace(/[\\/:*?"<>|\u0000-\u001f]/g, "_").replace(/\s+/g, " ").trim().slice(0, 80)) || fallback;
const extOf = (name) => (name && name.includes(".") ? name.slice(name.lastIndexOf(".")) : "");

export async function buildExportZip(userId, messagesByChild = {}, onProgress = () => {}) {
  const zip = new JSZip();
  const data = await exportFamilyData(userId);
  const missing = [];
  let filesAdded = 0;

  const items = [];
  for (const child of data.children || []) for (const v of child.vaultItems || []) if (v.file_path) items.push({ child, v });

  let done = 0;
  for (const { child, v } of items) {
    onProgress({ done, total: items.length });
    const { data: blob, error } = await supabase.storage.from("vault-files").download(v.file_path);
    if (error || !blob) { missing.push(`${child.name}: ${v.title || v.file_name || v.file_path}`); done++; continue; }
    const base = safe(v.title || v.file_name);
    const ext = extOf(v.file_name) || extOf(v.file_path);
    const path = `documents/${safe(child.name)}/${safe(v.category, "Other")}/${String(++filesAdded).padStart(3, "0")} ${base}${base.toLowerCase().endsWith(ext.toLowerCase()) ? "" : ext}`;
    zip.file(path, blob);
    done++;
  }
  onProgress({ done, total: items.length });

  // Chats: only what is open in this session. Say so in the zip as well as on screen.
  let chatFiles = 0;
  for (const child of data.children || []) {
    const msgs = messagesByChild[child.id] || [];
    if (!msgs.length) continue;
    const text = msgs.map((m) => `${m.role === "user" ? "You" : "Everside"}: ${m.text || ""}${m.image ? `  [file shared: ${m.image.name || "attachment"}]` : ""}`).join("\n\n");
    zip.file(`conversations/${safe(child.name)}.txt`, text);
    chatFiles++;
  }

  zip.file("everside-data.json", JSON.stringify(data, null, 2));
  zip.file("README.txt", [
    "Your Everside export",
    `Made on ${new Date().toLocaleString("en-GB")}`,
    "",
    "documents/           Every file in your Vault, sorted by child and folder.",
    "everside-data.json   Your details, your children's details, your actions and a list of your Vault items.",
    chatFiles ? "conversations/       The Navigator conversations that were open when you made this file." : "conversations/       None. Everside does not store your chats, so only an open conversation can be saved here.",
    "",
    missing.length ? `These ${missing.length} file(s) could not be included:\n  ${missing.join("\n  ")}\n` : "All of your Vault files are included.",
    "This file is private. Anyone who has it can read your family's information, so store it somewhere safe.",
  ].join("\n"));

  const blob = await zip.generateAsync({ type: "blob", compression: "DEFLATE" });
  return { blob, filesAdded, chatFiles, missing, bytes: blob.size };
}

export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}
