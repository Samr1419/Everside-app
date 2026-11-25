import React, { useEffect, useMemo, useState } from "react";
import {
  BLOG_TAGS, fetchPublishedArticles, fetchMyArticles, saveArticle, deleteArticle,
  reportArticle, isBlogAdmin, fetchReviewQueue, reviewArticle, resolveReports,
} from "./dataLayer";
import { ArrowLeft, PenLine, Search, Globe, Users, Flag, Trash2, Loader2, Share2, ShieldCheck, Info } from "lucide-react";

const DISCLAIMER = "Articles are written by parents and members. They share personal experience and are not legal or professional advice. Everside does not reply to articles.";
const fmt = (d) => { try { return new Date(d).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }); } catch { return ""; } };
const emptyDraft = { id: null, author_name: "", title: "", summary: "", body: "", tag: "EHCP", visibility: "members" };

function VisibilityBadge({ v }) {
  return v === "public"
    ? <span className="inline-flex items-center gap-1 text-[11px] font-bold text-sky-700 bg-sky-50 border border-sky-100 rounded-full px-2 py-0.5"><Globe size={11} /> Public</span>
    : <span className="inline-flex items-center gap-1 text-[11px] font-bold text-violet-700 bg-violet-50 border border-violet-100 rounded-full px-2 py-0.5"><Users size={11} /> Members only</span>;
}

function StatusBadge({ s }) {
  const map = { pending: ["Waiting for review", "bg-amber-50 text-amber-700 border-amber-100"], published: ["Published", "bg-emerald-50 text-emerald-700 border-emerald-100"], rejected: ["Not approved", "bg-rose-50 text-rose-700 border-rose-100"] };
  const [label, cls] = map[s] || map.pending;
  return <span className={`text-[11px] font-bold border rounded-full px-2 py-0.5 ${cls}`}>{label}</span>;
}

function Disclaimer() {
  return <div className="flex items-start gap-2 bg-sky-50 border border-sky-100 rounded-2xl px-4 py-3 text-xs text-slate-500"><Info size={14} className="text-sky-500 flex-shrink-0 mt-0.5" />{DISCLAIMER}</div>;
}

export default function BlogTab({ fredoka, userId, onBack, setToast }) {
  const [view, setView] = useState("list");          // list | read | write | mine | review
  const [articles, setArticles] = useState([]);
  const [mine, setMine] = useState([]);
  const [loading, setLoading] = useState(true);
  const [admin, setAdmin] = useState(false);
  const [open, setOpen] = useState(null);
  const [query, setQuery] = useState("");
  const [tagFilter, setTagFilter] = useState("All");
  const [draft, setDraft] = useState(emptyDraft);
  const [privacyOk, setPrivacyOk] = useState(false);
  const [saving, setSaving] = useState(false);
  const [reporting, setReporting] = useState(false);
  const [reportReason, setReportReason] = useState("");
  const [queue, setQueue] = useState({ posts: [], reports: [] });

  async function load() {
    setLoading(true);
    const [pub, my, isAdmin] = await Promise.all([fetchPublishedArticles(), fetchMyArticles(userId), isBlogAdmin()]);
    setArticles(pub.data); setMine(my.data); setAdmin(isAdmin);
    setLoading(false);
  }
  useEffect(() => { load(); }, [userId]);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return articles.filter((a) => (tagFilter === "All" || a.tag === tagFilter)
      && (!q || `${a.title} ${a.summary} ${a.author_name}`.toLowerCase().includes(q)));
  }, [articles, query, tagFilter]);

  function startWrite(existing) {
    setDraft(existing ? { ...emptyDraft, ...existing } : emptyDraft);
    setPrivacyOk(false);
    setView("write");
  }

  const draftValid = draft.author_name.trim().length >= 1 && draft.title.trim().length >= 5
    && draft.summary.trim().length >= 10 && draft.body.trim().length >= 50 && privacyOk;

  async function submit() {
    if (!draftValid || saving) return;
    setSaving(true);
    const { error } = await saveArticle(userId, {
      ...draft, author_name: draft.author_name.trim(), title: draft.title.trim(), summary: draft.summary.trim(), body: draft.body.trim(),
    });
    setSaving(false);
    if (error) { setToast("Couldn't send your article. Please check the lengths and try again."); return; }
    setToast("Sent for review. We'll publish it once it's checked.");
    await load(); setView("mine");
  }

  async function remove(id) {
    if (!window.confirm || !window.confirm("Delete this article? This can't be undone.")) return;
    const { error } = await deleteArticle(id);
    if (error) { setToast("Couldn't delete that article."); return; }
    setToast("Article deleted"); await load(); if (view === "read") setView("list");
  }

  async function sendReport() {
    if (reportReason.trim().length < 3) return;
    const { error } = await reportArticle(userId, open.id, reportReason.trim());
    setReporting(false); setReportReason("");
    setToast(error ? "You've already reported this article, or something went wrong." : "Thanks. We'll take a look.");
  }

  async function share(a) {
    const url = `https://www.ever-side.co.uk/blog/${a.id}`;
    try {
      if (navigator.share) await navigator.share({ title: a.title, url });
      else { await navigator.clipboard.writeText(url); setToast("Link copied"); }
    } catch { /* closed the share sheet */ }
  }

  async function openReview() {
    setView("review"); setQueue(await fetchReviewQueue());
  }
  async function decide(id, status) {
    let note = null;
    if (status === "rejected") note = window.prompt ? window.prompt("Short note for the writer (optional)") : null;
    const { error } = await reviewArticle(id, status, note);
    if (error) { setToast("Couldn't update that article."); return; }
    await resolveReports(id);
    setToast(status === "published" ? "Published" : status === "rejected" ? "Not approved" : "Moved back to review");
    setQueue(await fetchReviewQueue()); load();
  }

  const Header = ({ title, back }) => (
    <div className="flex items-center gap-3 mb-5">
      <button onClick={back} className="p-2 -ml-2 rounded-full hover:bg-stone-100"><ArrowLeft size={20} className="text-slate-600" /></button>
      <h1 style={fredoka} className="text-2xl font-semibold text-slate-800 flex-1">{title}</h1>
    </div>
  );

  // ── Read one article ──
  if (view === "read" && open) {
    const related = articles.filter((a) => a.tag === open.tag && a.id !== open.id).slice(0, 3);
    return (
      <div className="max-w-md mx-auto px-5 pt-6 pb-8 space-y-5">
        <Header title="" back={() => setView("list")} />
        <div className="flex flex-wrap items-center gap-2"><span className="text-xs font-bold uppercase tracking-wide text-orange-600">{open.tag}</span><VisibilityBadge v={open.visibility} /></div>
        <h2 style={fredoka} className="text-2xl font-semibold text-slate-800 -mt-2">{open.title}</h2>
        <p className="text-xs text-slate-400 -mt-3">By {open.author_name} · {fmt(open.published_at)}</p>
        <div className="text-[15px] leading-relaxed text-slate-700 whitespace-pre-wrap">{open.body}</div>
        <Disclaimer />
        <div className="flex gap-2">
          {open.visibility === "public" && <button onClick={() => share(open)} className="flex-1 flex items-center justify-center gap-2 text-sm font-bold text-slate-600 bg-white border border-stone-200 rounded-2xl py-2.5"><Share2 size={15} /> Share</button>}
          {open.user_id === userId
            ? <button onClick={() => remove(open.id)} className="flex-1 flex items-center justify-center gap-2 text-sm font-bold text-rose-600 bg-white border border-stone-200 rounded-2xl py-2.5"><Trash2 size={15} /> Delete</button>
            : <button onClick={() => setReporting(true)} className="flex-1 flex items-center justify-center gap-2 text-sm font-bold text-slate-500 bg-white border border-stone-200 rounded-2xl py-2.5"><Flag size={15} /> Report</button>}
        </div>
        {reporting && (
          <div className="bg-white border border-stone-200 rounded-2xl p-4 space-y-3">
            <p className="text-sm font-semibold text-slate-700">What's wrong with this article?</p>
            <textarea value={reportReason} onChange={(e) => setReportReason(e.target.value)} rows={3} maxLength={500} className="w-full border border-stone-200 rounded-xl p-3 text-sm" placeholder="For example, it names a child or a school" />
            <div className="flex gap-2"><button onClick={() => setReporting(false)} className="flex-1 text-sm font-bold text-slate-500 py-2">Cancel</button><button onClick={sendReport} className="flex-1 bg-orange-500 text-white text-sm font-bold rounded-full py-2">Send report</button></div>
          </div>
        )}
        {related.length > 0 && (
          <div className="space-y-2"><p className="text-xs font-bold uppercase tracking-wide text-slate-400">Related articles</p>
            {related.map((a) => <button key={a.id} onClick={() => { setOpen(a); setReporting(false); window.scrollTo?.(0, 0); }} className="w-full text-left bg-white border border-stone-200 rounded-2xl px-4 py-3 text-sm font-semibold text-slate-700">{a.title}</button>)}
          </div>
        )}
      </div>
    );
  }

  // ── Write or edit ──
  if (view === "write") {
    const field = "w-full border border-stone-200 rounded-xl px-3 py-2.5 text-sm bg-white";
    return (
      <div className="max-w-md mx-auto px-5 pt-6 pb-8 space-y-4">
        <Header title={draft.id ? "Edit article" : "Write an article"} back={() => setView(draft.id ? "mine" : "list")} />
        <label className="block text-xs font-bold text-slate-500">Name to show<input value={draft.author_name} maxLength={60} onChange={(e) => setDraft({ ...draft, author_name: e.target.value })} className={`${field} mt-1`} placeholder="For example, Sarah, mum of two" /></label>
        <label className="block text-xs font-bold text-slate-500">Title<input value={draft.title} maxLength={140} onChange={(e) => setDraft({ ...draft, title: e.target.value })} className={`${field} mt-1`} /></label>
        <label className="block text-xs font-bold text-slate-500">Short summary<textarea value={draft.summary} maxLength={300} rows={2} onChange={(e) => setDraft({ ...draft, summary: e.target.value })} className={`${field} mt-1`} /></label>
        <label className="block text-xs font-bold text-slate-500">Topic
          <select value={draft.tag} onChange={(e) => setDraft({ ...draft, tag: e.target.value })} className={`${field} mt-1`}>{BLOG_TAGS.map((t) => <option key={t}>{t}</option>)}</select>
        </label>
        <label className="block text-xs font-bold text-slate-500">Your article<textarea value={draft.body} maxLength={20000} rows={12} onChange={(e) => setDraft({ ...draft, body: e.target.value })} className={`${field} mt-1 leading-relaxed`} /></label>

        <div className="space-y-2">
          <p className="text-xs font-bold text-slate-500">Who can read it?</p>
          {[["members", Users, "Members only", "Only signed in Everside members can read the full article. Others see the title and summary."],
            ["public", Globe, "Public", "Anyone can read it, including on the Everside website, and it can be shared."]].map(([v, Icon, label, hint]) => (
            <button key={v} type="button" onClick={() => setDraft({ ...draft, visibility: v })}
              className={`w-full text-left flex gap-3 rounded-2xl border px-4 py-3 ${draft.visibility === v ? "border-orange-400 bg-orange-50" : "border-stone-200 bg-white"}`}>
              <Icon size={18} className={draft.visibility === v ? "text-orange-500 mt-0.5" : "text-slate-400 mt-0.5"} />
              <span><span className="block text-sm font-bold text-slate-700">{label}</span><span className="block text-xs text-slate-500">{hint}</span></span>
            </button>
          ))}
        </div>

        <label className="flex items-start gap-3 bg-amber-50 border border-amber-100 rounded-2xl px-4 py-3 text-xs text-amber-900">
          <input type="checkbox" checked={privacyOk} onChange={(e) => setPrivacyOk(e.target.checked)} className="mt-0.5" />
          I haven't included my child's full name, their school, or details that could identify a case or a professional.
        </label>
        <Disclaimer />
        <p className="text-xs text-slate-400">Every article is checked by Everside before it goes live. Editing a published article sends it back for a quick check.</p>
        <button onClick={submit} disabled={!draftValid || saving} className="w-full bg-orange-500 disabled:bg-stone-300 text-white font-bold rounded-full py-3 flex items-center justify-center gap-2">
          {saving && <Loader2 size={16} className="animate-spin" />} Send for review
        </button>
        {!draftValid && <p className="text-[11px] text-slate-400 text-center">Title at least 5 characters, summary 10, article 50, and tick the privacy box.</p>}
      </div>
    );
  }

  // ── My articles ──
  if (view === "mine") {
    return (
      <div className="max-w-md mx-auto px-5 pt-6 pb-8 space-y-3">
        <Header title="My articles" back={() => setView("list")} />
        {mine.length === 0 && <p className="text-sm text-slate-400">You haven't written anything yet.</p>}
        {mine.map((a) => (
          <div key={a.id} className="bg-white border border-stone-200 rounded-2xl p-4 space-y-2">
            <div className="flex flex-wrap gap-2"><StatusBadge s={a.status} /><VisibilityBadge v={a.visibility} /></div>
            <p style={fredoka} className="text-lg font-semibold text-slate-800">{a.title}</p>
            {a.status === "rejected" && a.review_note && <p className="text-xs text-rose-600">Note from Everside: {a.review_note}</p>}
            <div className="flex gap-2 pt-1">
              <button onClick={() => startWrite(a)} className="text-xs font-bold text-orange-600">Edit</button>
              <button onClick={() => remove(a.id)} className="text-xs font-bold text-rose-500">Delete</button>
            </div>
          </div>
        ))}
      </div>
    );
  }

  // ── Review queue (Everside only) ──
  if (view === "review") {
    const reportsFor = (id) => queue.reports.filter((r) => r.post_id === id);
    const pending = queue.posts.filter((p) => p.status === "pending");
    const reported = queue.posts.filter((p) => p.status === "published" && reportsFor(p.id).length);
    const Card = ({ p }) => (
      <div className="bg-white border border-stone-200 rounded-2xl p-4 space-y-2">
        <div className="flex flex-wrap gap-2"><StatusBadge s={p.status} /><VisibilityBadge v={p.visibility} /><span className="text-[11px] font-bold text-slate-400">{p.tag}</span></div>
        <p style={fredoka} className="text-lg font-semibold text-slate-800">{p.title}</p>
        <p className="text-xs text-slate-400">By {p.author_name} · {fmt(p.updated_at)}</p>
        <details><summary className="text-xs font-bold text-slate-500 cursor-pointer">Read in full</summary><p className="text-sm text-slate-600 whitespace-pre-wrap mt-2">{p.summary}{"\n\n"}{p.body}</p></details>
        {reportsFor(p.id).map((r) => <p key={r.id} className="text-xs text-rose-600">Report: {r.reason}</p>)}
        <div className="flex gap-2 pt-1">
          {p.status !== "published" && <button onClick={() => decide(p.id, "published")} className="flex-1 bg-emerald-500 text-white text-xs font-bold rounded-full py-2">Approve</button>}
          {p.status === "published" && <button onClick={() => decide(p.id, "pending")} className="flex-1 bg-amber-500 text-white text-xs font-bold rounded-full py-2">Unpublish</button>}
          <button onClick={() => decide(p.id, "rejected")} className="flex-1 bg-rose-500 text-white text-xs font-bold rounded-full py-2">Reject</button>
        </div>
      </div>
    );
    return (
      <div className="max-w-md mx-auto px-5 pt-6 pb-8 space-y-3">
        <Header title="Review articles" back={() => setView("list")} />
        <p className="text-xs font-bold uppercase tracking-wide text-slate-400">Waiting for review ({pending.length})</p>
        {pending.map((p) => <Card key={p.id} p={p} />)}
        <p className="text-xs font-bold uppercase tracking-wide text-slate-400 pt-3">Reported ({reported.length})</p>
        {reported.map((p) => <Card key={p.id} p={p} />)}
      </div>
    );
  }

  // ── Article list ──
  return (
    <div className="max-w-md mx-auto px-5 pt-6 pb-8 space-y-4">
      <Header title="Parent articles" back={onBack} />
      <p className="text-sm text-slate-500 -mt-3">Real experiences from parents going through SEND and EHCPs.</p>
      <div className="flex gap-2">
        <button onClick={() => startWrite(null)} className="flex-1 bg-orange-500 text-white text-sm font-bold rounded-full py-2.5 flex items-center justify-center gap-2"><PenLine size={15} /> Write an article</button>
        <button onClick={() => setView("mine")} className="flex-1 bg-white border border-stone-200 text-slate-600 text-sm font-bold rounded-full py-2.5">My articles{mine.length ? ` (${mine.length})` : ""}</button>
      </div>
      {admin && <button onClick={openReview} className="w-full flex items-center justify-center gap-2 text-sm font-bold text-emerald-700 bg-emerald-50 border border-emerald-100 rounded-full py-2.5"><ShieldCheck size={15} /> Review articles</button>}
      <div className="relative"><Search size={16} className="absolute left-3 top-3 text-slate-400" /><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search articles" className="w-full border border-stone-200 rounded-full pl-9 pr-4 py-2.5 text-sm bg-white" /></div>
      <div className="flex gap-2 overflow-x-auto pb-1">
        {["All", ...BLOG_TAGS].map((t) => <button key={t} onClick={() => setTagFilter(t)} className={`text-xs font-bold px-3 py-1.5 rounded-full whitespace-nowrap ${tagFilter === t ? "bg-orange-500 text-white" : "bg-stone-100 text-slate-500"}`}>{t}</button>)}
      </div>
      {loading && <div className="flex justify-center py-8"><Loader2 size={20} className="animate-spin text-slate-300" /></div>}
      {!loading && shown.length === 0 && <p className="text-sm text-slate-400 text-center py-6">No articles yet. Why not write the first one?</p>}
      {shown.map((a) => (
        <button key={a.id} onClick={() => { setOpen(a); setReporting(false); setView("read"); }} className="w-full text-left bg-white border border-stone-200 rounded-3xl p-5 space-y-2 shadow-sm hover:shadow-md transition-shadow">
          <div className="flex flex-wrap items-center gap-2"><span className="text-[11px] font-bold uppercase tracking-wide text-orange-600">{a.tag}</span><VisibilityBadge v={a.visibility} /></div>
          <p style={fredoka} className="text-lg font-semibold text-slate-800">{a.title}</p>
          <p className="text-sm text-slate-500">{a.summary}</p>
          <p className="text-xs text-slate-400">By {a.author_name} · {fmt(a.published_at)}</p>
        </button>
      ))}
      <Disclaimer />
    </div>
  );
}
