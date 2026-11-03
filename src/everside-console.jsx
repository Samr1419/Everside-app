import React, { useState, useRef, useEffect } from "react";
import {
  Search, ArrowLeft, Send, Sparkles, User, Bot, AlertTriangle,
  Clock, CheckCircle2, Inbox, StickyNote, X, Info
} from "lucide-react";

const INITIAL_CASES = [
  {
    id: 1,
    parentName: "Priya Shah",
    childName: "Leo",
    childAge: 7,
    journeyStage: "Appeal / mediation",
    status: "escalated",
    reason: "AI flagged uncertainty on the appeal deadline",
    internalNotes: "",
    messages: [
      { sender: "parent", text: "The council refused to assess Leo. Can I still appeal? How long do I have?", time: "9:02am" },
      { sender: "ai", text: "I'm not confident enough to give you a definitive answer on your exact deadline — that depends on the date on your refusal letter. It's usually a matter of weeks, so it's worth checking that date and confirming the exact deadline with IPSEA or SENDIASS. I've flagged this so a member of the Everside team can help you directly.", time: "9:03am" },
      { sender: "parent", text: "So do I definitely only have 2 months? I don't want to miss it.", time: "9:06am" },
    ],
  },
  {
    id: 2,
    parentName: "Tom Whitfield",
    childName: "Mia",
    childAge: 11,
    journeyStage: "EHCP drafting",
    status: "new",
    reason: "Parent asked to speak to a real person",
    internalNotes: "",
    messages: [
      { sender: "parent", text: "This app is fine but I really just want to talk to an actual human about our draft EHCP. Is that possible?", time: "Yesterday" },
      { sender: "ai", text: "Of course — I've let the Everside team know, and someone will get back to you shortly. In the meantime, is there a specific part of the draft you're most concerned about?", time: "Yesterday" },
      { sender: "parent", text: "The provision section — it feels really vague.", time: "Yesterday" },
    ],
  },
  {
    id: 3,
    parentName: "Aisha Bello",
    childName: "Josh",
    childAge: 9,
    journeyStage: "Appeal / mediation",
    status: "in_progress",
    reason: "Mentioned tribunal — flagged for review",
    internalNotes: "Sent Access SEND + Davina Stubbs details on 18 Aug.",
    messages: [
      { sender: "parent", text: "We've decided to go to tribunal. I don't really know where to start.", time: "Mon" },
      { sender: "ai", text: "That's a big step, and it makes sense to want proper support here. I can help you organise your evidence, but a tribunal case really benefits from advice from a solicitor or an independent SEN advocate who can represent you formally. I've flagged your case so a member of the Everside team can point you toward the right support.", time: "Mon" },
      { sender: "staff", text: "Hi Aisha, thanks for your patience — I've sent over two independent advocates who specialise in tribunal support. Let us know if you'd like help preparing anything in the meantime.", time: "Mon" },
      { sender: "parent", text: "Thank you, that's really helpful. I'll get in touch with them.", time: "Tue" },
    ],
  },
  {
    id: 4,
    parentName: "Katie Ward",
    childName: "Freya",
    childAge: 13,
    journeyStage: "Annual review",
    status: "resolved",
    reason: "No response for 3 days — check-in needed",
    internalNotes: "",
    messages: [
      { sender: "staff", text: "Hi Katie, just checking in ahead of Freya's annual review next week — is there anything you'd like help preparing?", time: "Fri" },
      { sender: "parent", text: "Actually yes, could you help me write up what's changed since her last review?", time: "Fri" },
      { sender: "staff", text: "Of course — I've added a note in your Vault under Evidence with a template you can fill in section by section.", time: "Fri" },
      { sender: "parent", text: "Perfect, thank you so much!", time: "Fri" },
    ],
  },
];

const DRAFT_SYSTEM_PROMPT = `You are drafting a reply for a member of the Everside support team to send to a parent, after their conversation was escalated from the AI Navigator to a person.

Write ONLY the suggested reply message itself — no preamble, no headers, no explanation of what you wrote.

Keep it warm, calm, and specific to what the parent actually asked. Address them by first name if given.

If the question involves a specific legal deadline, appeal right, or outcome, do not state it with certainty — suggest confirming the exact detail against the parent's own official documents, or by checking gov.uk, IPSEA, or SENDIASS, and offer to help them find the right official information rather than guessing. Never guarantee an outcome.

Keep the draft to 3–5 sentences. The staff member will review and edit it before sending, so it should read as a genuine, ready-to-send first draft, not a template.`;

function callClaude(messages, systemPrompt) {
  return fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "claude-sonnet-4-6",
      max_tokens: 500,
      system: systemPrompt,
      messages,
    }),
  }).then((r) => r.json());
}

const statusMeta = {
  escalated: { label: "Escalated", icon: AlertTriangle, dot: "bg-rose-400", text: "text-rose-600", bg: "bg-rose-50", border: "border-rose-100" },
  new: { label: "New", icon: Inbox, dot: "bg-sky-400", text: "text-sky-600", bg: "bg-sky-50", border: "border-sky-100" },
  in_progress: { label: "In progress", icon: Clock, dot: "bg-amber-400", text: "text-amber-600", bg: "bg-amber-50", border: "border-amber-100" },
  resolved: { label: "Resolved", icon: CheckCircle2, dot: "bg-emerald-400", text: "text-emerald-600", bg: "bg-emerald-50", border: "border-emerald-100" },
};

const FILTERS = [
  { key: "all", label: "All" },
  { key: "escalated", label: "Escalated" },
  { key: "new", label: "New" },
  { key: "in_progress", label: "In progress" },
  { key: "resolved", label: "Resolved" },
];

export default function EversideConsole() {
  const [cases, setCases] = useState(INITIAL_CASES);
  const [selectedId, setSelectedId] = useState(null);
  const [filter, setFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [reply, setReply] = useState("");
  const [drafting, setDrafting] = useState(false);
  const [showContext, setShowContext] = useState(false);
  const [notesDraft, setNotesDraft] = useState("");
  const threadEndRef = useRef(null);

  const selectedCase = cases.find((c) => c.id === selectedId) || null;

  useEffect(() => {
    const link = document.createElement("link");
    link.href = "https://fonts.googleapis.com/css2?family=Fredoka:wght@600;700&family=Quicksand:wght@400;500;600;700&display=swap";
    link.rel = "stylesheet";
    document.head.appendChild(link);
    return () => document.head.removeChild(link);
  }, []);

  useEffect(() => {
    setReply("");
    setShowContext(false);
    setNotesDraft(selectedCase?.internalNotes || "");
  }, [selectedId]);

  useEffect(() => {
    threadEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [selectedCase?.messages.length]);

  const fredoka = { fontFamily: "'Fredoka', sans-serif" };
  const quicksand = { fontFamily: "'Quicksand', sans-serif" };

  const filtered = cases.filter((c) => {
    const matchesFilter = filter === "all" || c.status === filter;
    const q = search.toLowerCase();
    const matchesSearch = !q || c.parentName.toLowerCase().includes(q) || c.childName.toLowerCase().includes(q);
    return matchesFilter && matchesSearch;
  });

  function sendReply() {
    if (!reply.trim() || !selectedCase) return;
    setCases((prev) =>
      prev.map((c) =>
        c.id === selectedCase.id
          ? {
              ...c,
              messages: [...c.messages, { sender: "staff", text: reply.trim(), time: "Just now" }],
              status: c.status === "resolved" ? c.status : "in_progress",
            }
          : c
      )
    );
    setReply("");
  }

  async function draftWithAI() {
    if (!selectedCase) return;
    setDrafting(true);
    const transcript = selectedCase.messages
      .map((m) => `${m.sender === "parent" ? selectedCase.parentName : m.sender === "ai" ? "Everside Navigator (AI)" : "Staff"}: ${m.text}`)
      .join("\n");
    const prompt = `Case: ${selectedCase.parentName}, parent of ${selectedCase.childName} (age ${selectedCase.childAge}). Journey stage: ${selectedCase.journeyStage}. Escalation reason: ${selectedCase.reason || "none"}.\n\nConversation so far:\n${transcript}\n\nWrite a suggested reply from the Everside team to ${selectedCase.parentName}.`;
    try {
      const data = await callClaude([{ role: "user", content: prompt }], DRAFT_SYSTEM_PROMPT);
      const block = (data.content || []).find((b) => b.type === "text");
      setReply(block ? block.text.trim() : "");
    } catch (e) {
      setReply("");
    } finally {
      setDrafting(false);
    }
  }

  function setStatus(status) {
    setCases((prev) => prev.map((c) => (c.id === selectedCase.id ? { ...c, status } : c)));
  }

  function saveNotes() {
    setCases((prev) => prev.map((c) => (c.id === selectedCase.id ? { ...c, internalNotes: notesDraft } : c)));
    setShowContext(false);
  }

  return (
    <div className="h-screen bg-stone-50 flex flex-col" style={quicksand}>
      <header className="bg-white border-b border-stone-200 px-4 py-3 flex items-center justify-between flex-shrink-0">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-xl bg-orange-100 flex items-center justify-center">
            <Sparkles size={16} className="text-orange-500" />
          </div>
          <div>
            <p style={fredoka} className="text-base font-semibold text-slate-800 leading-tight">Everside Console</p>
            <p className="text-[11px] text-slate-400 leading-tight">Demo mode — fictional families</p>
          </div>
        </div>
      </header>

      <div className="flex-1 flex overflow-hidden">
        {/* Case list */}
        <div className={`${selectedCase ? "hidden lg:flex" : "flex"} flex-col w-full lg:w-80 flex-shrink-0 border-r border-stone-200 bg-white`}>
          <div className="p-3 border-b border-stone-100">
            <div className="flex items-center gap-2 bg-stone-100 rounded-xl px-3 py-2 mb-3">
              <Search size={15} className="text-slate-400 flex-shrink-0" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search parent or child"
                className="bg-transparent outline-none text-sm flex-1 min-w-0 text-slate-700"
              />
            </div>
            <div className="flex gap-1.5 overflow-x-auto pb-1">
              {FILTERS.map((f) => (
                <button
                  key={f.key}
                  onClick={() => setFilter(f.key)}
                  className={`text-xs font-bold px-2.5 py-1.5 rounded-full whitespace-nowrap transition-colors ${
                    filter === f.key ? "bg-orange-500 text-white" : "bg-stone-100 text-slate-500"
                  }`}
                >
                  {f.label}
                </button>
              ))}
            </div>
          </div>

          <div className="flex-1 overflow-y-auto">
            {filtered.length === 0 && <p className="text-sm text-slate-400 text-center mt-8">No cases match.</p>}
            {filtered.map((c) => {
              const meta = statusMeta[c.status];
              const last = c.messages[c.messages.length - 1];
              return (
                <button
                  key={c.id}
                  onClick={() => setSelectedId(c.id)}
                  className={`w-full text-left px-4 py-3 border-b border-stone-100 hover:bg-stone-50 transition-colors ${selectedId === c.id ? "bg-orange-50" : ""}`}
                >
                  <div className="flex items-center justify-between mb-1">
                    <p className="text-sm font-bold text-slate-800">{c.parentName}</p>
                    <span className={`w-2 h-2 rounded-full flex-shrink-0 ${meta.dot}`} />
                  </div>
                  <p className="text-xs text-slate-400 mb-1">Parent of {c.childName}, {c.childAge}</p>
                  <p className="text-xs text-slate-500 truncate">{last.sender === "staff" ? "You: " : ""}{last.text}</p>
                </button>
              );
            })}
          </div>
        </div>

        {/* Thread */}
        <div className={`${selectedCase ? "flex" : "hidden lg:flex"} flex-col flex-1 min-w-0`}>
          {!selectedCase && (
            <div className="flex-1 flex items-center justify-center text-center px-8">
              <div>
                <Inbox size={28} className="text-stone-300 mx-auto mb-3" />
                <p className="text-sm text-slate-400">Select a case to view the conversation.</p>
              </div>
            </div>
          )}

          {selectedCase && (
            <>
              <div className="bg-white border-b border-stone-200 px-4 py-3 flex items-center gap-3 flex-shrink-0">
                <button onClick={() => setSelectedId(null)} className="lg:hidden text-slate-400">
                  <ArrowLeft size={20} />
                </button>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-bold text-slate-800">{selectedCase.parentName}</p>
                  <p className="text-xs text-slate-400">Parent of {selectedCase.childName}, {selectedCase.childAge} · {selectedCase.journeyStage}</p>
                </div>
                <button onClick={() => setShowContext(true)} className="p-2 rounded-full bg-stone-100 text-slate-500 flex-shrink-0">
                  <Info size={16} />
                </button>
              </div>

              {selectedCase.reason && (
                <div className={`mx-4 mt-3 flex items-center gap-2 text-xs font-bold px-3 py-2 rounded-xl flex-shrink-0 ${statusMeta[selectedCase.status].bg} ${statusMeta[selectedCase.status].text} border ${statusMeta[selectedCase.status].border}`}>
                  <AlertTriangle size={13} className="flex-shrink-0" /> {selectedCase.reason}
                </div>
              )}

              <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
                {selectedCase.messages.map((m, i) => (
                  <div key={i} className={`flex ${m.sender === "staff" ? "justify-end" : "justify-start"}`}>
                    <div className={`max-w-[80%] rounded-2xl px-4 py-2.5 text-sm ${
                      m.sender === "staff" ? "bg-orange-500 text-white rounded-br-md"
                      : m.sender === "ai" ? "bg-stone-100 text-slate-600 rounded-bl-md"
                      : "bg-white border border-stone-200 text-slate-700 rounded-bl-md"
                    }`}>
                      {m.sender === "ai" && (
                        <p className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-wide text-slate-400 mb-1">
                          <Bot size={11} /> Everside Navigator (AI)
                        </p>
                      )}
                      {m.sender === "parent" && (
                        <p className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-wide text-slate-400 mb-1">
                          <User size={11} /> {selectedCase.parentName.split(" ")[0]}
                        </p>
                      )}
                      <p className="whitespace-pre-wrap leading-relaxed">{m.text}</p>
                      <p className={`text-[10px] mt-1 ${m.sender === "staff" ? "text-orange-100" : "text-slate-400"}`}>{m.time}</p>
                    </div>
                  </div>
                ))}
                <div ref={threadEndRef} />
              </div>

              <div className="border-t border-stone-200 bg-white p-3 flex-shrink-0">
                <div className="flex items-center justify-between mb-2">
                  <button
                    onClick={draftWithAI}
                    disabled={drafting}
                    className="flex items-center gap-1.5 text-xs font-bold text-orange-600 bg-orange-50 hover:bg-orange-100 px-3 py-1.5 rounded-full transition-colors disabled:opacity-50"
                  >
                    <Sparkles size={13} /> {drafting ? "Drafting…" : "Draft with AI"}
                  </button>
                  {selectedCase.status !== "resolved" ? (
                    <button onClick={() => setStatus("resolved")} className="text-xs font-bold text-emerald-600">Mark resolved</button>
                  ) : (
                    <button onClick={() => setStatus("in_progress")} className="text-xs font-bold text-slate-400">Reopen</button>
                  )}
                </div>
                <div className="flex items-end gap-2">
                  <textarea
                    value={reply}
                    onChange={(e) => setReply(e.target.value)}
                    placeholder="Type your reply…"
                    rows={2}
                    className="flex-1 resize-none border border-stone-200 rounded-2xl px-3 py-2 text-sm outline-none focus:border-orange-300 text-slate-700"
                  />
                  <button onClick={sendReply} className="bg-orange-500 hover:bg-orange-600 text-white rounded-full p-3 flex-shrink-0 transition-colors">
                    <Send size={16} />
                  </button>
                </div>
              </div>
            </>
          )}
        </div>
      </div>

      {/* Context panel */}
      {showContext && selectedCase && (
        <div className="fixed inset-0 bg-slate-900/40 z-40 flex items-end sm:items-center justify-center" onClick={() => setShowContext(false)}>
          <div className="bg-white rounded-t-3xl sm:rounded-3xl w-full max-w-sm p-5 max-h-[85vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 style={fredoka} className="text-base font-semibold text-slate-800">Case details</h3>
              <button onClick={() => setShowContext(false)} className="text-slate-400"><X size={20} /></button>
            </div>

            <div className="space-y-3 mb-5">
              <div className="bg-stone-50 rounded-2xl p-3">
                <p className="text-xs font-bold text-slate-400 uppercase tracking-wide mb-1">Parent</p>
                <p className="text-sm font-bold text-slate-800">{selectedCase.parentName}</p>
              </div>
              <div className="bg-stone-50 rounded-2xl p-3">
                <p className="text-xs font-bold text-slate-400 uppercase tracking-wide mb-1">Child</p>
                <p className="text-sm font-bold text-slate-800">{selectedCase.childName}, age {selectedCase.childAge}</p>
              </div>
              <div className="bg-stone-50 rounded-2xl p-3">
                <p className="text-xs font-bold text-slate-400 uppercase tracking-wide mb-1">Journey stage</p>
                <p className="text-sm font-bold text-slate-800">{selectedCase.journeyStage}</p>
              </div>
              <div>
                <p className="text-xs font-bold text-slate-400 uppercase tracking-wide mb-2">Status</p>
                <div className="flex flex-wrap gap-1.5">
                  {Object.entries(statusMeta).map(([key, meta]) => (
                    <button
                      key={key}
                      onClick={() => setStatus(key)}
                      className={`text-xs font-bold px-2.5 py-1.5 rounded-full transition-colors ${
                        selectedCase.status === key ? `${meta.bg} ${meta.text} border ${meta.border}` : "bg-stone-100 text-slate-400"
                      }`}
                    >
                      {meta.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <div>
              <p className="text-xs font-bold text-slate-400 uppercase tracking-wide mb-2 flex items-center gap-1.5">
                <StickyNote size={12} /> Internal notes (not visible to the parent)
              </p>
              <textarea
                value={notesDraft}
                onChange={(e) => setNotesDraft(e.target.value)}
                rows={4}
                placeholder="Add a private note about this case…"
                className="w-full resize-none border border-stone-200 rounded-2xl px-3 py-2 text-sm outline-none focus:border-orange-300 text-slate-700 mb-3"
              />
              <button onClick={saveNotes} className="w-full bg-slate-800 hover:bg-slate-900 text-white font-bold text-sm py-2.5 rounded-2xl transition-colors">
                Save note
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
