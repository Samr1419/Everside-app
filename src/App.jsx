import React, { useState, useRef, useEffect } from "react";
import { supabase } from "./supabaseClient";
import { signInWithMagicLink, getCurrentUser, onAuthStateChange, setVaultPasscode, checkVaultPasscode } from "./auth";
import {
  fetchParents, addParent, fetchChildren, addChild,
  fetchVaultItems, addVaultItem, fetchActions, addAction, updateActionStatus,
  deleteChildData, deleteAccount, recordConsents, fetchAiUsage, touchActivity, exportFamilyData, setProfileDetails, fetchProfile,
  uploadVaultFile, getVaultFileUrl, deleteVaultItemAndFile,
  submitConversationFeedback, startCheckout, openBillingPortal, cancelPlan, resumePlan,
} from "./dataLayer";
import { buildExportZip, downloadBlob } from "./exportZip";
import {
  Home, MessageCircle, Lock, Map, CheckSquare, Send, Paperclip,
  X, ChevronRight, Clock, AlertCircle, CheckCircle2, FileText,
  Sparkles, ArrowLeft, Info, ShieldCheck, Download, Trash2,
  UserPlus, Plus, Mail, BookOpen, Upload, Loader2, Eye, Star,
} from "lucide-react";

const STAGES = [
  { title: "Understanding your child's needs", blurb: "Noticing patterns and starting to gather your own observations." },
  { title: "SEN Support", blurb: "The school puts extra support in place without an EHCP." },
  { title: "Requesting an EHC needs assessment", blurb: "You (or the school) formally ask the council to assess your child." },
  { title: "Assessment", blurb: "The council gathers evidence from professionals to decide." },
  { title: "Decision", blurb: "The council decides whether to issue an EHCP." },
  { title: "EHCP drafting", blurb: "A draft plan is written and you can comment on it." },
  { title: "Final EHCP", blurb: "The plan is finalised and support should begin." },
  { title: "Annual review", blurb: "The plan is reviewed every year, without exception." },
  { title: "Amendment", blurb: "The plan is updated when your child's needs change." },
  { title: "Appeal / mediation", blurb: "If you disagree with a decision, this is how you challenge it." },
];

const VAULT_CATEGORIES = ["School", "EHCP", "Health & Assessments", "Evidence", "Meetings", "Correspondence"];

// The plans on offer. The Stripe price ids are NOT here: the server holds four of them (each plan monthly and yearly)
// as Cloudflare variables, and the browser only names a plan and a billing period.
// PRICES is what the plan buttons show. Set each to match your Stripe prices, for example "£99 a year".
// Left empty, the button shows no price and Stripe's checkout page shows it.
const PRICES = { guided: { month: "", year: "" }, full_support: { month: "", year: "" } };
const SUBSCRIPTION_TIERS = [
  { id: "guided", name: "Guided", blurb: "Navigator chat (120 messages a month), 20 document reads a month, the Vault and the Journey tracker." },
  { id: "full_support", name: "Full Support", blurb: "250 messages and 50 document reads a month, and longer PDFs (up to 50 pages)." },
];

// A quick, offline first guess at a document's folder from its filename, used
// as a starting point before the AI reads it (for images) or when it can't
// be read at all (e.g. a PDF) — always shown to the parent to confirm or change.
function guessCategoryFromFilename(name) {
  const n = name.toLowerCase();
  if (/ehcp|ehc plan|section f|section i|draft plan/.test(n)) return "EHCP";
  if (/report|assessment|ep |educational psych|salt|ot |occupational|diagnos|camhs|paediatric/.test(n)) return "Health & Assessments";
  if (/letter|email|correspond/.test(n)) return "Correspondence";
  if (/minutes|meeting|review/.test(n)) return "Meetings";
  if (/school|senco|provision map|timetable/.test(n)) return "School";
  return "Evidence";
}
const CONDITION_OPTIONS = [
  "Autism Spectrum Condition", "ADHD / ADD", "Speech, Language and Communication Needs",
  "Specific Learning Difficulty (e.g. Dyslexia, Dyscalculia)", "Social, Emotional and Mental Health needs",
  "Physical or Sensory Disability", "Learning Disability", "Not yet diagnosed / still exploring",
];
const RELATIONSHIP_OPTIONS = ["Mother", "Father", "Guardian", "Carer", "Other"];
const YEAR_GROUPS = ["Not yet in school", "Nursery", "Reception", "Year 1", "Year 2", "Year 3", "Year 4", "Year 5", "Year 6", "Year 7", "Year 8", "Year 9", "Year 10", "Year 11", "Year 12", "Year 13"];
const PENDING_KEY = "everside_pending_onboarding";
const POLICY_VERSION = "2026-10-31"; // change this whenever the privacy policy or terms change

function emptyParent() { return { name: "", relationship: "Mother", phone: "" }; }
function emptyChild() { return { name: "", age: "", conditions: [], conditionOther: "", schoolName: "", yearGroup: "", currentStage: 0 }; }

function buildSystemPrompt(child, localAuthority) {
  const conds = [...(child?.conditions || []), child?.condition_other].filter(Boolean).join(", ") || "not yet specified";
  const stageTitle = STAGES[child?.journey_stage || 0]?.title || "not yet specified";
  return `You are the Everside Navigator — a calm, patient, non-judgemental AI guide helping a UK parent understand and organise their child's SEND/EHCP journey.

You are currently helping with ${child?.name || "this child"}${child?.age ? `, age ${child.age}` : ""}${child?.year_group ? `, ${child.year_group}` : ""}${child?.school_name ? ` at ${child.school_name}` : ""}. Known areas of need: ${conds}. Current stage of their journey: ${stageTitle}.${localAuthority ? ` Their local authority is ${localAuthority}.` : ""}

Use this context naturally rather than asking the parent to repeat it. If the local authority is known, you can refer to it by name when relevant (e.g. "worth checking ${localAuthority || "your local authority"}'s Local Offer").

Personality: calm, patient, intelligent, direct, reassuring. Never urgent or bureaucratic in tone.

Core principle: you are an evidence-building and reasoning assistant, not an advocate writing a persuasive letter. Your job is to help the parent work out, factually and objectively, whether their child's needs require provision that is additional to or different from what the school can ordinarily offer, and to help them document that clearly. Test the evidence rather than simply arguing the parent's case, and give real weight to the school's own view as one input, not an obstacle to work around.

How you build a case, roughly in this order (skip steps you already have clear answers to; don't march through this as a rigid checklist, and don't re-ask for anything the parent or the child's profile has already told you):
1. Confirm the relevant background and diagnoses using what you already know, without re-asking for it.
2. Map how the needs show up across the relevant SEND areas (Communication and Interaction; Cognition and Learning; Social, Emotional and Mental Health; Sensory and/or Physical).
3. Establish the impact on education and daily life with concrete, dated examples, not general descriptions.
4. Identify what SEN Support or reasonable adjustments are already in place.
5. Quantify that support precisely: what it is, who delivers it, how often, for how long, at what intensity.
6. Evaluate effectiveness: what changed, what didn't, and under what conditions (e.g. only with heavy adult prompting).
7. Flag any gap between what was planned (e.g. in a provision map) and what is actually happening.
8. Weigh the needs against what's ordinarily available, since that comparison, not the diagnosis or the amount of support given, is what actually determines whether an EHC needs assessment is justified.
9. Identify what evidence is still missing, and ask for it specifically, rather than drafting around the gap.
10. Help define measurable outcomes, then connect each outcome to the provision that would actually achieve it.
11. Only once needs, impact, provision, gaps and outcomes are reasonably clear, help draft the EHC needs assessment request itself.
12. If they're ready to submit, give a general submission and follow-up checklist, but say plainly that the exact process depends on their local authority, and point them to that LA's own website or Local Offer to confirm it.

Precision in language, since small overstatements undermine an otherwise strong case:
- Never imply that a diagnosis, a lack of progress, or a given amount of existing SEN Support automatically means a child is entitled to an EHCP. The test is always whether needs require provision beyond what's ordinarily available, not how much has already been tried.
- Avoid framing an evidence gap itself as proof of anything (e.g. don't say something like "that gap is powerful evidence"). A gap just means more documentation is needed.
- Avoid adversarial framing like "the school doesn't get to decide." Say instead that the school can give its professional view, while the legal decision on whether to carry out an assessment sits with the local authority.
- Progress that depends on heavy adult prompting, or that comes at a cost (exhaustion, dysregulation at home) doesn't by itself prove an EHCP is needed either, but it is exactly the kind of detail worth documenting precisely, since it speaks to whether support is sustainable and whether it's meeting the need or just managing it.
- Be precise about who can commission a professional assessment: the parent can request one privately, the school can sometimes arrange one, and the local authority can be asked to commission one as part of the EHC needs assessment. Don't blur these together.

How you help:
- Let the parent explain their situation in plain language. Ask only one or two clarifying questions at a time.
- Expand any SEND acronym the first time it appears in a conversation (e.g. MLD, SEMH, EOTAS), even if the parent used it first.
- If a parent names a diagnosis (e.g. ADHD, autism) without connecting it to SEND's official areas of need, offer how it commonly maps to the four broad areas (Communication and Interaction; Cognition and Learning; Social, Emotional and Mental Health; Sensory and/or Physical) — framed as "commonly falls under", not a definitive claim, since presentation varies.
- When discussing what a school must actually deliver, name "Section F" specifically and note it's the legally enforceable part of an EHCP, unlike most other sections. If a parent can't tell whether provision is actually happening, suggest asking the school for a provision map.
- When helping review a draft section, use the framing "is this specific and measurable, or vague enough that it won't be enforceable" — that's the language parents themselves use to judge adequacy.
- When a parent describes their child as "fine at school" but struggling, exhausted, or withdrawn at home, recognise this as a well-documented pattern (masking or camouflaging). Attendance difficulty or Emotionally Based School Avoidance (EBSA) can itself be valid evidence for a needs assessment, even if the school reports no concerns.
- Parents can formally ask the local authority to commission an educational psychologist, OT, or SALT assessment as part of the EHC needs assessment — mention this when relevant, not just as something to raise later at appeal.
- A specialist unit or resourced provision attached to a mainstream school has to be named specifically in the plan — "a mainstream school with a unit" is not the same as that unit actually being secured.
- Transport problems (late, early, or overly long journeys) should be raised with the local authority's transport team, not the transport company, since the LA holds the contract.
- A long wait on an NHS autism/CAMHS diagnostic pathway is common; mention "Right to Choose" (the NHS right to request a different or faster provider) as a real option worth looking into.
- If a parent mentions being told their child must be on the school's SEN Support register before requesting an EHC needs assessment: this is commonly used to discourage requests, but it is not a legal precondition — a request can be made regardless of register status. Since local authorities do push back on this in practice, suggest confirming directly with IPSEA or SENDIASS if this comes up, rather than treating it as fully settled.
- A related version of this: a parent may be told their child must first show needs "substantially different" from Ordinarily Available Provision (the support a school gives all children without extra funding) before an assessment request is worth making. This is a threshold some schools and LAs apply in practice, not a fixed legal precondition on its own, so treat it the same way as the SEN register point: acknowledge it's commonly raised, and suggest confirming with IPSEA or SENDIASS if it's being used to block a request.
- If a plan or a school's response describes support as "funding equivalent to X hours" rather than a real timetable of what will happen, help the parent turn that into a specific question for the school: who delivers it, how often, and how they'd know if it isn't happening. Suggest asking for a provision map to check.
- If a parent says the local authority won't include a private OT, SALT, educational psychologist, or other professional's report in Section F, note this is a common and genuine point of disagreement. Section F should reflect assessed need rather than who commissioned the report, so this is worth raising directly, and worth confirming with IPSEA or SENDIASS if the LA won't move on it.
- If EOTAS (Education Otherwise Than At School) is already in place or being discussed, mention that provision is sometimes delivered through a personal budget managed via a third-party support organisation, since parents often aren't told this is how it can work in practice.
- Carer-related benefits (e.g. Universal Credit's disabled child element or carer element) can be mentioned as worth looking into, but leave eligibility and amounts to Citizens Advice or Turn2us — benefits calculations are their own specialist area.
- When a parent describes a difficult day, help turn it into a clear, specific, factual account. Never invent details they didn't tell you. Ask "Is this accurate?" before treating anything as finalised.

Deadlines:
- Distinguish fixed, universal statutory deadlines (e.g. the Year 6 phase-transfer EHCP issue date of 15 February) from case-specific ones. State fixed deadlines with confidence.
- For anything that depends on a specific family's own documents, stay cautious and ask them to verify against the original letter.

Myths to correct, confidently and calmly, if a parent repeats one they were told:
- "Your child isn't severe enough to qualify" — not how eligibility works.
- "The school has to try something else first" — not a legal requirement before requesting an assessment.
- "EHCPs are only for certain situations" — eligibility depends on need, not diagnosis category.
- "The rules are different in our local authority" — the same SEND Code of Practice applies across all of England.
- "They've had SEN Support for months/years, so they must qualify now" — also not how eligibility works. The relevant question isn't how much support has been given or for how long, it's whether the needs require provision beyond what's ordinarily available. Correct this as gently as the other myths, since it's an easy, sympathetic thing for a parent to assume.

Say clearly that something is worth discussing with a real person rather than settling in chat, and suggest contacting the Everside team or an appropriate professional (SENDIASS, IPSEA, a solicitor), when:
- The parent mentions tribunal, mediation, or appeal. If a decision or annual review is badly overdue, or a placement is actively collapsing, you can mention that parents sometimes request an emergency annual review rather than waiting for the scheduled one, and that a tribunal appeal is sometimes heard faster as a paper hearing instead of an in-person one, but frame both as options to raise with SENDIASS or IPSEA, never as something you can arrange or guarantee will speed things up.
- The parent is deciding what to name in Section I (parental preference) — this is high-stakes and often hard to reverse; lay out the tradeoff plainly without pushing either direction. If they're weighing mainstream against specialist, note this is a genuine trade-off either way, not a decision with one clearly right answer.
- You are not confident enough to give a clear answer.

Treat these as a more serious safeguarding matter, not just "worth discussing with a person" — point directly to real safeguarding channels (NSPCC on 0808 800 5000, the local authority's children's social care team, or 999 if urgent), the same way the Safeguarding Statement itself does, rather than only suggesting the Everside team:
- A child's safety at school, or exclusion, is being raised or discussed.
- Unexplained injuries, or physical restraint or handling by school staff.
- Punitive responses (e.g. losing break time) to behaviour that appears connected to the child's disability.

Never:
- Invent specific legislation, case law, or policy detail — if unsure, say so and point to checking official guidance (gov.uk, IPSEA, SENDIASS, or their Local Authority's Local Offer).
- Claim a child "qualifies" or "will win" an assessment or appeal, or guarantee any outcome.
- Present your suggestions as legal, medical, or professional advice.
- Encourage exaggeration — aim for accurate, specific, evidence-based descriptions only.
- Present the parent's case as settled or one-sided — note where the school's view differs, and where evidence is still incomplete, rather than only building the strongest possible argument for the parent.

If shown an image of a letter or document, describe what it appears to show in plain English, flag anything that looks like a date or action needed, and add a note to verify details against the original.

Keep replies short and conversational — a few sentences, not long blocks. End most replies with either a gentle clarifying question or one small, clear suggested next step.`;
}

async function callClaude(messages, systemPrompt, options = {}) {
  const { data: { session } } = await supabase.auth.getSession();
  const r = await fetch("/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${session?.access_token}` },
    // The server decides the model, the length, the topic rules and the allowance. We only send the conversation.
    body: JSON.stringify({ system: systemPrompt, messages, purpose: options.purpose }),
  });
  const body = await r.json().catch(() => ({}));
  if (!r.ok) {
    const err = new Error(body.error || "The Navigator is unavailable right now.");
    err.reason = body.reason; err.usage = body.usage;
    throw err;
  }
  return body;
}

// Builds the content the server expects: a text block plus, on the newest message only, one image or PDF.
function attachmentBlock(a) {
  return a.kind === "pdf"
    ? { type: "document", source: { type: "base64", media_type: "application/pdf", data: a.data } }
    : { type: "image", source: { type: "base64", media_type: a.mediaType, data: a.data } };
}
const ATTACH_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif", "application/pdf"];

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result.split(",")[1]);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

const statusStyles = {
  due: { dot: "bg-rose-400", label: "Due soon", text: "text-rose-600" },
  upcoming: { dot: "bg-amber-400", label: "Upcoming", text: "text-amber-600" },
  done: { dot: "bg-emerald-400", label: "Completed", text: "text-emerald-600" },
};

export default function EversideApp() {
  const [authLoading, setAuthLoading] = useState(true);
  const [session, setSession] = useState(null);
  const [awaitingMagicLink, setAwaitingMagicLink] = useState(false);
  const [pendingEmail, setPendingEmail] = useState("");

  // Onboarding draft — local only, nothing saved until the magic link is confirmed
  const [step, setStep] = useState(0);
  const [email, setEmail] = useState("");
  const [passcode, setPasscode] = useState("");
  const [address, setAddress] = useState("");
  const [postcode, setPostcode] = useState("");
  const [localAuthority, setLocalAuthority] = useState("");
  const [laLookupStatus, setLaLookupStatus] = useState("idle"); // idle | loading | done | error
  const [parents, setParents] = useState([emptyParent()]);
  const [obChildren, setObChildren] = useState([emptyChild()]);
  const [consents, setConsents] = useState({ responsibility: false, specialCategory: false, aiProcessing: false, aiLimits: false, humanReview: false });

  const [profile, setProfile] = useState(null);

  // Real data, fetched from Supabase once authenticated
  const [children, setChildren] = useState([]);
  const [activeChild, setActiveChild] = useState(0);
  const [vaultItems, setVaultItems] = useState([]);
  const [actions, setActions] = useState([]);
  const [dataLoading, setDataLoading] = useState(false);

  const [tab, setTab] = useState("home");
  const [openCategory, setOpenCategory] = useState(null);
  const [vaultLocked, setVaultLocked] = useState(true);
  const [requirePasscode, setRequirePasscode] = useState(true);
  const [autoLockOnSwitch, setAutoLockOnSwitch] = useState(true);
  const [showSecurityPanel, setShowSecurityPanel] = useState(false);

  const [messagesByChild, setMessagesByChild] = useState({});
  const [input, setInput] = useState("");
  const [pendingImage, setPendingImage] = useState(null);
  const [aiUsage, setAiUsage] = useState(null);
  const [chatError, setChatError] = useState(null);
  const [loading, setLoading] = useState(false);
  const [toast, setToast] = useState(null);
  const fileInputRef = useRef(null);
  const chatEndRef = useRef(null);

  // Vault document upload: idle -> reading (AI is suggesting a folder) -> confirm -> saving
  const [vaultUploadStep, setVaultUploadStep] = useState("idle");
  const [vaultUploadFile, setVaultUploadFile] = useState(null);
  const [vaultUploadDraft, setVaultUploadDraft] = useState({ category: "Evidence", title: "", item_date: new Date().toLocaleDateString() });
  const vaultFileInputRef = useRef(null);

  // End-of-conversation feedback: shown when leaving Chat after a real exchange.
  // ratedExchangeCounts remembers, per child, the message count already rated
  // or skipped, so the same exchange never prompts twice.
  const [feedbackModal, setFeedbackModal] = useState(false);
  const [pendingTabAfterFeedback, setPendingTabAfterFeedback] = useState(null);
  const [ratedExchangeCounts, setRatedExchangeCounts] = useState({});

  const fredoka = { fontFamily: "'Fredoka', sans-serif" };
  const quicksand = { fontFamily: "'Quicksand', sans-serif" };

  useEffect(() => {
    const link = document.createElement("link");
    link.href = "https://fonts.googleapis.com/css2?family=Fredoka:wght@500;600;700&family=Quicksand:wght@400;500;600;700&display=swap";
    link.rel = "stylesheet";
    document.head.appendChild(link);
    return () => document.head.removeChild(link);
  }, []);

  useEffect(() => {
    let unsub;
    (async () => {
      const user = await getCurrentUser();
      if (user) await handleAuthenticated(user);
      setAuthLoading(false);
    })();
    unsub = onAuthStateChange(async (user) => {
      if (user) { await handleAuthenticated(user); } else { setSession(null); }
    });
    return () => unsub && unsub();
  }, []);

  async function handleAuthenticated(user) {
    setAwaitingMagicLink(false);
    const pendingRaw = localStorage.getItem(PENDING_KEY);
    if (pendingRaw) {
      try {
        const pending = JSON.parse(pendingRaw);
        await recordConsents(user.id, pending.consentTypes, POLICY_VERSION);
        await setVaultPasscode(pending.passcode);
        await setProfileDetails(pending.address, pending.localAuthority);
        for (const p of pending.parents) if (p.name) await addParent(user.id, p);
        for (const c of pending.children) {
          if (c.name) {
            await addChild(user.id, {
              name: c.name, age: c.age ? Number(c.age) : null, conditions: c.conditions,
              condition_other: c.conditionOther, school_name: c.schoolName, year_group: c.yearGroup,
              journey_stage: c.currentStage ? Number(c.currentStage) : 0,
            });
          }
        }
      } finally {
        localStorage.removeItem(PENDING_KEY);
      }
    }
    setSession(user);
    touchActivity();   // lets the server know this account is in use (see the 6 month inactivity rule)
    const [{ data: kids }, { data: prof }] = await Promise.all([fetchChildren(user.id), fetchProfile(user.id)]);
    setChildren(kids || []);
    setProfile(prof || null);
    setActiveChild(0);
    const { data: usage } = await fetchAiUsage();
    if (usage) setAiUsage(usage);
  }

  useEffect(() => {
    if (!session || children.length === 0) return;
    loadChildData();
    // eslint-disable-next-line
  }, [session, activeChild, children.length]);

  async function loadChildData() {
    const child = children[activeChild];
    if (!child) return;
    setDataLoading(true);
    const [{ data: v }, { data: a }] = await Promise.all([
      fetchVaultItems(session.id, child.id),
      fetchActions(session.id, child.id),
    ]);
    setVaultItems(v || []);
    setActions(a || []);
    setDataLoading(false);
  }

  useEffect(() => { chatEndRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messagesByChild, activeChild, loading]);
  useEffect(() => { if (!toast) return; const t = setTimeout(() => setToast(null), 2200); return () => clearTimeout(t); }, [toast]);
  useEffect(() => { if (tab !== "vault" && autoLockOnSwitch) { setVaultLocked(true); setOpenCategory(null); } }, [tab, autoLockOnSwitch]);

  function updateParent(i, field, val) { setParents((prev) => prev.map((p, idx) => (idx === i ? { ...p, [field]: val } : p))); }
  function updateObChild(i, field, val) { setObChildren((prev) => prev.map((c, idx) => (idx === i ? { ...c, [field]: val } : c))); }
  function toggleCondition(i, condition) {
    setObChildren((prev) => prev.map((c, idx) => {
      if (idx !== i) return c;
      const has = c.conditions.includes(condition);
      return { ...c, conditions: has ? c.conditions.filter((x) => x !== condition) : [...c.conditions, condition] };
    }));
  }

  const canFinishConsent = Object.values(consents).every(Boolean);

  async function lookupLocalAuthority() {
    const pc = postcode.trim();
    if (!pc) return;
    setLaLookupStatus("loading");
    try {
      const res = await fetch(`https://api.postcodes.io/postcodes/${encodeURIComponent(pc)}`);
      const data = await res.json();
      if (data.status === 200 && data.result?.admin_district) {
        setLocalAuthority(data.result.admin_district);
        setLaLookupStatus("done");
      } else {
        setLaLookupStatus("error");
      }
    } catch (e) {
      setLaLookupStatus("error");
    }
  }

  const [onboardError, setOnboardError] = useState(null);

  async function finishOnboarding() {
    setOnboardError(null);
    const { error } = await signInWithMagicLink(email);
    if (error) {
      setOnboardError(error.message || "Something went wrong sending the sign-in email.");
      return;
    }
    localStorage.setItem(PENDING_KEY, JSON.stringify({ consentTypes: Object.keys(consents).filter((k) => consents[k]), parents, children: obChildren, passcode, address: `${address}, ${postcode}`.trim(), localAuthority }));
    setPendingEmail(email);
    setAwaitingMagicLink(true);
  }

  const currentChild = children[activeChild] || null;
  const childId = currentChild?.id;
  const vault = Object.fromEntries(VAULT_CATEGORIES.map((cat) => [cat, vaultItems.filter((v) => v.category === cat)]));
  const messages = (childId && messagesByChild[childId]) || (currentChild ? [{ role: "assistant", text: `Hi — I'm here to help you make sense of where you are with ${currentChild.name}'s support, and what's worth doing next. What's happening at the moment?` }] : []);

  function setMessages(updater) {
    if (!childId) return;
    setMessagesByChild((prev) => ({ ...prev, [childId]: typeof updater === "function" ? updater(messages) : updater }));
  }

  // Leaving the Chat tab after a real back-and-forth (more than just the
  // opening greeting) asks for a quick star rating first. Already-rated or
  // still-empty conversations switch tabs immediately, same as before.
  function changeTab(nextTab) {
    const hadRealExchange = messages.length >= 3;
    const alreadyHandled = childId && ratedExchangeCounts[childId] === messages.length;
    if (tab === "chat" && nextTab !== "chat" && childId && hadRealExchange && !alreadyHandled) {
      setPendingTabAfterFeedback(nextTab);
      setFeedbackModal(true);
      return;
    }
    setTab(nextTab);
  }

  function markExchangeHandled() {
    if (childId) setRatedExchangeCounts((prev) => ({ ...prev, [childId]: messages.length }));
  }

  async function submitFeedback(rating, comment) {
    if (childId) await submitConversationFeedback(session.id, childId, rating, comment);
    markExchangeHandled();
    setFeedbackModal(false);
    if (pendingTabAfterFeedback) { setTab(pendingTabAfterFeedback); setPendingTabAfterFeedback(null); }
  }

  function skipFeedback() {
    markExchangeHandled();
    setFeedbackModal(false);
    if (pendingTabAfterFeedback) { setTab(pendingTabAfterFeedback); setPendingTabAfterFeedback(null); }
  }

  async function handleSend() {
    if ((!input.trim() && !pendingImage) || !currentChild) return;
    const userMsg = { role: "user", text: input.trim(), image: pendingImage };
    const nextMessages = [...messages, userMsg];
    setChatError(null);
    setMessages(nextMessages);
    setInput(""); setPendingImage(null); setLoading(true);

    // Only the newest message carries its file. Earlier files are not sent again, so they do not use up the allowance twice.
    const lastIdx = nextMessages.length - 1;
    const apiMessages = nextMessages.map((m, idx) => (m.image && idx === lastIdx)
      ? { role: m.role, content: [attachmentBlock(m.image), { type: "text", text: m.text || "What does this mean, and what should I do next?" }] }
      : { role: m.role, content: m.text || (m.image ? `[Shared a file: ${m.image.name || "attachment"}]` : "") });

    try {
      const data = await callClaude(apiMessages, buildSystemPrompt(currentChild, profile?.local_authority));
      if (data.usage) setAiUsage(data.usage);
      const textBlock = (data.content || []).find((b) => b.type === "text");
      setMessages((prev) => [...prev, { role: "assistant", text: textBlock ? textBlock.text : "Sorry, could you try rephrasing?" }]);
    } catch (e) {
      if (e.usage) setAiUsage(e.usage);
      // Limit and file problems are explained plainly; the parent's message is taken back out of the thread so nothing is lost.
      if (e.reason && e.reason !== "unavailable") {
        setMessages(nextMessages.slice(0, -1));
        setInput(userMsg.text);
        if (userMsg.image) setPendingImage(userMsg.image);
        setChatError({ reason: e.reason, text: e.message });
      } else {
        setMessages((prev) => [...prev, { role: "assistant", text: "I'm having trouble responding right now. Please try again in a moment." }]);
      }
    } finally { setLoading(false); }
  }

  async function handleFile(e) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setChatError(null);
    if (!ATTACH_TYPES.includes(file.type)) { setChatError({ reason: "invalid", text: "Please attach a JPG, PNG or WebP photo, or a PDF." }); return; }
    const maxMb = aiUsage?.max_attachment_mb || 4;
    if (file.size > maxMb * 1024 * 1024) { setChatError({ reason: "file_too_big", text: `That file is too large. Please keep attachments under ${maxMb} MB.` }); return; }
    const data = await fileToBase64(file);
    const isPdf = file.type === "application/pdf";
    setPendingImage({ kind: isPdf ? "pdf" : "image", name: file.name, mediaType: file.type, data, preview: isPdf ? null : URL.createObjectURL(file) });
  }

  async function saveLastToVault() {
    const lastUser = [...messages].reverse().find((m) => m.role === "user");
    if (!lastUser || !currentChild) return;
    await addVaultItem(session.id, currentChild.id, { category: "Evidence", title: "Note from chat", description: lastUser.text || "Saved from a shared screenshot.", item_date: new Date().toLocaleDateString() });
    await loadChildData();
    setToast("Saved to your Vault");
  }

  // ── Vault document upload ──────────────────────────────────────────────
  // Step 1: parent picks a file. If it's an image, ask the AI to suggest which
  // of the six Vault folders it belongs to and a short title, purely as a
  // starting point the parent can change, never a silent, final decision.
  async function handleVaultFilePick(e) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file || !currentChild) return;

    setVaultUploadFile(file);
    const fallbackTitle = file.name.replace(/\.[^/.]+$/, "");
    setVaultUploadDraft({ category: guessCategoryFromFilename(file.name), title: fallbackTitle, item_date: new Date().toLocaleDateString() });

    const readable = ATTACH_TYPES.includes(file.type);
    const withinSize = file.size <= (aiUsage?.max_attachment_mb || 4) * 1024 * 1024;
    const readsLeft = aiUsage ? aiUsage.doc_reads_used < aiUsage.doc_reads_limit : true;
    if (!readable || !withinSize || !readsLeft) {
      // Not readable automatically (Word file, too large, or this plan's document reads are used up): go straight to confirm with a best guess folder.
      setVaultUploadStep("confirm");
      return;
    }

    setVaultUploadStep("reading");
    try {
      const base64 = await fileToBase64(file);
      const classifyPrompt = `Which one of these Vault folders does this document belong to: ${VAULT_CATEGORIES.join(", ")}? Also suggest a short, specific title for it (a few words, e.g. "EP report, March 2026" or "Letter from SENCO"). Reply with only this JSON shape and nothing else: {"category":"one of the folder names exactly as given","title":"short title"}`;
      const data = await callClaude(
        [{ role: "user", content: [attachmentBlock({ kind: file.type === "application/pdf" ? "pdf" : "image", mediaType: file.type, data: base64 }), { type: "text", text: classifyPrompt }] }],
        "You are a filing assistant for a UK SEND/EHCP document vault. Look at the document and reply with only the requested JSON, no other text.",
        { purpose: "filing" }
      );
      if (data.usage) setAiUsage(data.usage);
      const textBlock = (data.content || []).find((b) => b.type === "text");
      const parsed = textBlock ? JSON.parse(textBlock.text.trim().replace(/^```json\s*|\s*```$/g, "")) : null;
      const category = VAULT_CATEGORIES.includes(parsed?.category) ? parsed.category : guessCategoryFromFilename(file.name);
      const title = (parsed?.title || fallbackTitle).slice(0, 120);
      setVaultUploadDraft((prev) => ({ ...prev, category, title }));
    } catch (e) {
      if (e.usage) setAiUsage(e.usage);
      // AI suggestion failed or wasn't parseable — that's fine, the filename-based guess already set above still stands.
    } finally {
      setVaultUploadStep("confirm");
    }
  }

  async function confirmVaultUpload() {
    if (!vaultUploadFile || !currentChild) return;
    setVaultUploadStep("saving");
    try {
      const { path, error: uploadError } = await uploadVaultFile(session.id, currentChild.id, vaultUploadDraft.category, vaultUploadFile);
      if (uploadError) throw uploadError;
      await addVaultItem(session.id, currentChild.id, {
        category: vaultUploadDraft.category,
        title: vaultUploadDraft.title || vaultUploadFile.name,
        description: "",
        item_date: vaultUploadDraft.item_date,
        file_path: path,
        file_name: vaultUploadFile.name,
        file_type: vaultUploadFile.type,
        file_size: vaultUploadFile.size,
      });
      await loadChildData();
      setToast(`Saved to ${vaultUploadDraft.category}`);
      cancelVaultUpload();
    } catch (e) {
      setVaultUploadStep("confirm");
      setToast("Couldn't save that file — please try again.");
    }
  }

  function cancelVaultUpload() {
    setVaultUploadStep("idle");
    setVaultUploadFile(null);
    setVaultUploadDraft({ category: "Evidence", title: "", item_date: new Date().toLocaleDateString() });
  }

  async function viewVaultFile(item) {
    if (!item.file_path) return;
    const { url, error } = await getVaultFileUrl(item.file_path);
    if (url) window.open(url, "_blank", "noopener");
    else setToast("Couldn't open that file right now.");
  }

  async function removeVaultItem(item) {
    await deleteVaultItemAndFile(item);
    await loadChildData();
    setToast("Removed from your Vault");
  }

  async function createActionFromChat() {
    if (!currentChild) return;
    await addAction(session.id, currentChild.id, { title: "Follow up from Everside Navigator chat", due_date: "In 7 days", status: "upcoming" });
    await loadChildData();
    setToast("Added to your Actions");
  }

  async function upgradeToTier(tier, interval) {
    const { url, error } = await startCheckout(tier, interval);
    if (url) window.location.href = url;
    else setToast("Couldn't start checkout — please try again in a moment.");
  }

  async function manageBilling() {
    const { url, error } = await openBillingPortal();
    if (url) window.location.href = url;
    else setToast("Couldn't open billing — please try again in a moment.");
  }

  const [exporting, setExporting] = useState(false);
  async function exportData() {
    setExporting(true);
    try {
      const out = await buildExportZip(session.id, messagesByChild);
      downloadBlob(out.blob, "everside-export.zip");
      setToast(out.missing.length ? `Downloaded. ${out.missing.length} file(s) could not be included.` : "Your zip has been downloaded");
    } catch { setToast("Couldn't make the zip. Please try again."); }
    setExporting(false);
  }
  // Used by the cancel flow: builds the zip, saves it to their device, and reports what went in.
  async function buildAndSaveZip(onProgress) {
    const out = await buildExportZip(session.id, messagesByChild, onProgress);
    downloadBlob(out.blob, "everside-export.zip");
    return out;
  }
  async function refreshProfile() {
    const { data } = await fetchProfile(session.id);
    if (data) setProfile(data);
  }
  async function handleCancel(payload) {
    const out = await cancelPlan(payload);
    if (!out?.error && !out.deleted) await refreshProfile();   // after a full deletion the account is gone; the screen signs out when they press Done
    return out;
  }
  async function handleResume() {
    const out = await resumePlan();
    if (out?.error) { setToast(out.error); return; }
    await refreshProfile(); setToast("Your plan will carry on as normal");
  }

  async function deleteAll() {
    if (!currentChild) return;
    await deleteChildData(currentChild.id);
    await loadChildData();
    setToast("This child's data deleted");
  }

  async function deleteWholeAccount() {
    const { error } = await deleteAccount();
    if (error) { setToast("Couldn't delete the account. Please try again or email us."); return; }
    window.location.href = "/";
  }

  async function toggleActionDone(action) {
    await updateActionStatus(action.id, action.status === "done" ? "upcoming" : "done");
    await loadChildData();
  }

  if (authLoading) {
    return <div className="min-h-screen bg-stone-50 flex items-center justify-center" style={quicksand}><p className="text-sm text-slate-400">Loading…</p></div>;
  }

  if (awaitingMagicLink) {
    return (
      <div className="min-h-screen bg-stone-50 flex flex-col items-center justify-center px-6 text-center" style={quicksand}>
        <div className="w-16 h-16 rounded-full bg-orange-100 flex items-center justify-center mb-5"><Mail size={26} className="text-orange-500" /></div>
        <h2 style={fredoka} className="text-xl font-semibold text-slate-800 mb-2">Check your email</h2>
        <p className="text-sm text-slate-500 max-w-xs mb-6">We've sent a sign-in link to <span className="font-bold text-slate-700">{pendingEmail}</span>. Open it on this device to finish setting up your account.</p>
        <button onClick={() => signInWithMagicLink(pendingEmail)} className="text-sm font-bold text-orange-600">Resend the email</button>
      </div>
    );
  }

  if (!session) {
    return (
      <Onboarding
        fredoka={fredoka} quicksand={quicksand} step={step} setStep={setStep}
        email={email} setEmail={setEmail} passcode={passcode} setPasscode={setPasscode}
        address={address} setAddress={setAddress} postcode={postcode} setPostcode={setPostcode}
        lookupLocalAuthority={lookupLocalAuthority} laLookupStatus={laLookupStatus}
        localAuthority={localAuthority} setLocalAuthority={setLocalAuthority}
        parents={parents} setParents={setParents} updateParent={updateParent}
        children={obChildren} setChildren={setObChildren} updateChild={updateObChild} toggleCondition={toggleCondition}
        consents={consents} setConsents={setConsents} canFinishConsent={canFinishConsent}
        finishOnboarding={finishOnboarding} onboardError={onboardError}
      />
    );
  }

  return (
    <div className="min-h-screen bg-stone-50 flex flex-col" style={quicksand}>
      {toast && <div className="fixed top-4 left-1/2 -translate-x-1/2 z-50 bg-slate-800 text-white text-sm font-semibold px-4 py-2 rounded-full shadow-lg">{toast}</div>}

      {profile && profile.data_delete_after && profile.subscription_status !== "active" && profile.subscription_status !== "trialing" && fmtDate(profile.data_delete_after) && (
        <button onClick={() => setShowSecurityPanel(true)} className="w-full bg-amber-50 border-b border-amber-200 text-amber-900 text-xs font-semibold px-4 py-2 text-left">
          Your plan has ended. Your information will be deleted on {fmtDate(profile.data_delete_after)} unless you renew. Tap to renew or download it.
        </button>
      )}

      {showSecurityPanel && (
        <SecurityPanel fredoka={fredoka} onClose={() => setShowSecurityPanel(false)}
          requirePasscode={requirePasscode} setRequirePasscode={setRequirePasscode}
          autoLockOnSwitch={autoLockOnSwitch} setAutoLockOnSwitch={setAutoLockOnSwitch}
          onExport={exportData} onDeleteAll={deleteAll} onDeleteAccount={deleteWholeAccount}
          profile={profile} onUpgrade={upgradeToTier} onManageBilling={manageBilling}
          onBuildZip={buildAndSaveZip} onCancelled={handleCancel} onResume={handleResume} exporting={exporting} />
      )}

      {children.length > 1 && tab !== "vault" && (
        <div className="bg-white border-b border-stone-200 px-4 py-2 flex gap-2 overflow-x-auto flex-shrink-0">
          {children.map((c, i) => (
            <button key={c.id} onClick={() => setActiveChild(i)} className={`text-xs font-bold px-3 py-1.5 rounded-full whitespace-nowrap transition-colors ${activeChild === i ? "bg-orange-500 text-white" : "bg-stone-100 text-slate-500"}`}>
              {c.name}
            </button>
          ))}
        </div>
      )}

      {!currentChild ? (
        <div className="flex-1 flex items-center justify-center px-6 text-center">
          <p className="text-sm text-slate-400">No children on this account yet.</p>
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto pb-24">
          {tab === "home" && <HomeTab fredoka={fredoka} child={currentChild} vault={vault} actions={actions} goToChat={() => setTab("chat")} goToActions={() => setTab("actions")} goToGuide={() => setTab("guide")} onOpenSecurity={() => setShowSecurityPanel(true)} />}
          {tab === "guide" && <GuideTab fredoka={fredoka} onBack={() => setTab("home")} />}
          {tab === "chat" && (
            <ChatTab fredoka={fredoka} child={currentChild} messages={messages} loading={loading} input={input} setInput={setInput}
              pendingImage={pendingImage} setPendingImage={setPendingImage} fileInputRef={fileInputRef} handleFile={handleFile}
              handleSend={handleSend} aiUsage={aiUsage} chatError={chatError} onSeePlans={() => setShowSecurityPanel(true)} saveLastToVault={saveLastToVault} createActionFromChat={createActionFromChat} chatEndRef={chatEndRef} />
          )}
          {tab === "vault" && (
            requirePasscode && vaultLocked
              ? <VaultLockScreen fredoka={fredoka} onUnlock={() => setVaultLocked(false)} />
              : <VaultTab fredoka={fredoka} child={currentChild} vault={vault} openCategory={openCategory} setOpenCategory={setOpenCategory} requirePasscode={requirePasscode} onOpenSecurity={() => setShowSecurityPanel(true)} loading={dataLoading}
                  vaultFileInputRef={vaultFileInputRef} onPickFile={handleVaultFilePick}
                  uploadStep={vaultUploadStep} uploadDraft={vaultUploadDraft} setUploadDraft={setVaultUploadDraft}
                  onConfirmUpload={confirmVaultUpload} onCancelUpload={cancelVaultUpload}
                  onViewFile={viewVaultFile} onDeleteItem={removeVaultItem} />
          )}
          {tab === "journey" && <JourneyTab fredoka={fredoka} stageIndex={currentChild.journey_stage || 0} />}
          {tab === "actions" && <ActionsTab fredoka={fredoka} actions={actions} onToggle={toggleActionDone} />}
        </div>
      )}

      <nav className="fixed bottom-0 left-0 right-0 bg-white border-t border-stone-200 flex justify-around py-2 px-1">
        <NavBtn icon={Home} label="Home" active={tab === "home"} onClick={() => changeTab("home")} />
        <NavBtn icon={MessageCircle} label="Chat" active={tab === "chat"} onClick={() => changeTab("chat")} />
        <NavBtn icon={Lock} label="Vault" active={tab === "vault"} onClick={() => changeTab("vault")} />
        <NavBtn icon={Map} label="Journey" active={tab === "journey"} onClick={() => changeTab("journey")} />
        <NavBtn icon={CheckSquare} label="Actions" active={tab === "actions"} onClick={() => changeTab("actions")} />
      </nav>

      {feedbackModal && (
        <ChatFeedbackModal fredoka={fredoka} onSubmit={submitFeedback} onSkip={skipFeedback} />
      )}
    </div>
  );
}

// ============ ONBOARDING ============

function Onboarding(props) {
  const { fredoka, quicksand, step, setStep, email, setEmail, passcode, setPasscode,
    address, setAddress, postcode, setPostcode, lookupLocalAuthority, laLookupStatus,
    localAuthority, setLocalAuthority,
    parents, setParents, updateParent, children, setChildren, updateChild, toggleCondition,
    consents, setConsents, canFinishConsent, finishOnboarding, onboardError } = props;
  const steps = ["Account", "Parents & carers", "Children", "Consent"];

  return (
    <div className="min-h-screen bg-stone-50 flex flex-col" style={quicksand}>
      <div className="max-w-md mx-auto w-full px-5 pt-8 pb-28 flex-1">
        <div className="flex items-center gap-2 mb-6"><Sparkles size={18} className="text-orange-500" /><p style={fredoka} className="text-lg font-semibold text-slate-800">Everside</p></div>
        <div className="flex gap-1.5 mb-6">{steps.map((s, i) => <div key={s} className={`h-1.5 flex-1 rounded-full ${i <= step ? "bg-orange-500" : "bg-stone-200"}`} />)}</div>

        {step === 0 && (
          <div>
            <h2 style={fredoka} className="text-xl font-semibold text-slate-800 mb-1">Create your account</h2>
            <p className="text-sm text-slate-500 mb-6">We'll email you a sign-in link, no password needed. This also sets your Vault passcode.</p>
            <label className="block text-xs font-bold text-slate-500 mb-1">Email address</label>
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com"
              className="w-full border border-stone-200 rounded-2xl px-4 py-3 text-sm mb-4 outline-none focus:border-orange-300" />
            <label className="block text-xs font-bold text-slate-500 mb-1">Set a 4-digit Vault passcode</label>
            <input type="tel" inputMode="numeric" maxLength={4} value={passcode} onChange={(e) => setPasscode(e.target.value.replace(/\D/g, "").slice(0, 4))}
              placeholder="••••" className="w-full border border-stone-200 rounded-2xl px-4 py-3 text-sm mb-6 outline-none focus:border-orange-300 tracking-[0.5em]" />
            <label className="block text-xs font-bold text-slate-500 mb-1">Postcode</label>
            <input value={postcode} onChange={(e) => setPostcode(e.target.value)} onBlur={lookupLocalAuthority} placeholder="e.g. HA6 1QD"
              className="w-full border border-stone-200 rounded-2xl px-4 py-3 text-sm mb-2 outline-none focus:border-orange-300" />
            <p className="text-xs text-slate-400 mb-4">
              {laLookupStatus === "loading" && "Looking up your council…"}
              {laLookupStatus === "done" && `Detected automatically: ${localAuthority}`}
              {laLookupStatus === "error" && "Couldn't detect this one — you can enter your council below manually."}
              {laLookupStatus === "idle" && "We'll work out your local authority automatically from this."}
            </p>
            <label className="block text-xs font-bold text-slate-500 mb-1">Street and town</label>
            <input value={address} onChange={(e) => setAddress(e.target.value)} placeholder="Street, town"
              className="w-full border border-stone-200 rounded-2xl px-4 py-3 text-sm mb-4 outline-none focus:border-orange-300" />
            <label className="block text-xs font-bold text-slate-500 mb-1">Local authority</label>
            <input value={localAuthority} onChange={(e) => setLocalAuthority(e.target.value)} placeholder="e.g. Hillingdon"
              className="w-full border border-stone-200 rounded-2xl px-4 py-3 text-sm mb-6 outline-none focus:border-orange-300" />
            <button disabled={!email.includes("@") || passcode.length !== 4} onClick={() => setStep(1)}
              className="w-full bg-orange-500 disabled:bg-stone-300 text-white font-bold py-3 rounded-2xl transition-colors">Continue</button>
          </div>
        )}

        {step === 1 && (
          <div>
            <h2 style={fredoka} className="text-xl font-semibold text-slate-800 mb-1">Who's using Everside?</h2>
            <p className="text-sm text-slate-500 mb-6">Add yourself, and anyone else who helps care for your child or children.</p>
            <div className="space-y-4 mb-4">
              {parents.map((p, i) => (
                <div key={i} className="bg-white border border-stone-200 rounded-2xl p-4">
                  <div className="flex items-center justify-between mb-2">
                    <p className="text-xs font-bold text-slate-400 uppercase">{i === 0 ? "You" : `Parent/carer ${i + 1}`}</p>
                    {i > 0 && <button onClick={() => setParents((prev) => prev.filter((_, idx) => idx !== i))} className="text-rose-400"><X size={14} /></button>}
                  </div>
                  <input value={p.name} onChange={(e) => updateParent(i, "name", e.target.value)} placeholder="Full name"
                    className="w-full border border-stone-200 rounded-xl px-3 py-2 text-sm mb-2 outline-none focus:border-orange-300" />
                  <select value={p.relationship} onChange={(e) => updateParent(i, "relationship", e.target.value)}
                    className="w-full border border-stone-200 rounded-xl px-3 py-2 text-sm outline-none focus:border-orange-300 bg-white mb-2">
                    {RELATIONSHIP_OPTIONS.map((r) => <option key={r} value={r}>{r}</option>)}
                  </select>
                  <input type="tel" value={p.phone} onChange={(e) => updateParent(i, "phone", e.target.value)} placeholder="Mobile number (optional)"
                    className="w-full border border-stone-200 rounded-xl px-3 py-2 text-sm outline-none focus:border-orange-300" />
                </div>
              ))}
            </div>
            <button onClick={() => setParents((prev) => [...prev, emptyParent()])} className="w-full flex items-center justify-center gap-1.5 text-sm font-bold text-orange-600 bg-orange-50 py-2.5 rounded-2xl mb-6"><UserPlus size={15} /> Add another parent or carer</button>
            <div className="flex gap-2">
              <button onClick={() => setStep(0)} className="px-4 py-3 rounded-2xl border border-stone-200 text-slate-500 font-bold text-sm">Back</button>
              <button disabled={!parents[0]?.name} onClick={() => setStep(2)} className="flex-1 bg-orange-500 disabled:bg-stone-300 text-white font-bold py-3 rounded-2xl">Continue</button>
            </div>
          </div>
        )}

        {step === 2 && (
          <div>
            <h2 style={fredoka} className="text-xl font-semibold text-slate-800 mb-1">Tell us about your child</h2>
            <p className="text-sm text-slate-500 mb-6">Add each child you'd like help with.</p>
            <div className="space-y-5 mb-4">
              {children.map((c, i) => (
                <div key={i} className="bg-white border border-stone-200 rounded-2xl p-4">
                  <div className="flex items-center justify-between mb-2">
                    <p className="text-xs font-bold text-slate-400 uppercase">Child {i + 1}</p>
                    {i > 0 && <button onClick={() => setChildren((prev) => prev.filter((_, idx) => idx !== i))} className="text-rose-400"><X size={14} /></button>}
                  </div>
                  <input value={c.name} onChange={(e) => updateChild(i, "name", e.target.value)} placeholder="Child's first name" className="w-full border border-stone-200 rounded-xl px-3 py-2 text-sm mb-2 outline-none focus:border-orange-300" />
                  <input type="number" value={c.age} onChange={(e) => updateChild(i, "age", e.target.value)} placeholder="Age" className="w-full border border-stone-200 rounded-xl px-3 py-2 text-sm mb-2 outline-none focus:border-orange-300" />
                  <input value={c.schoolName} onChange={(e) => updateChild(i, "schoolName", e.target.value)} placeholder="School name (optional)" className="w-full border border-stone-200 rounded-xl px-3 py-2 text-sm mb-2 outline-none focus:border-orange-300" />
                  <select value={c.yearGroup} onChange={(e) => updateChild(i, "yearGroup", e.target.value)} className="w-full border border-stone-200 rounded-xl px-3 py-2 text-sm mb-3 outline-none focus:border-orange-300 bg-white">
                    <option value="">Year group (optional)</option>
                    {YEAR_GROUPS.map((y) => <option key={y} value={y}>{y}</option>)}
                  </select>
                  <label className="block text-xs font-bold text-slate-500 mb-1">Where are things right now?</label>
                  <select value={c.currentStage} onChange={(e) => updateChild(i, "currentStage", e.target.value)} className="w-full border border-stone-200 rounded-xl px-3 py-2 text-sm mb-3 outline-none focus:border-orange-300 bg-white">
                    {STAGES.map((s, idx) => <option key={s.title} value={idx}>{s.title}</option>)}
                  </select>
                  <p className="text-xs font-bold text-slate-500 mb-2">Areas of need (select all that apply)</p>
                  <div className="space-y-1.5 mb-2">
                    {CONDITION_OPTIONS.map((opt) => (
                      <label key={opt} className="flex items-start gap-2 text-sm text-slate-600">
                        <input type="checkbox" checked={c.conditions.includes(opt)} onChange={() => toggleCondition(i, opt)} className="mt-0.5 flex-shrink-0" />{opt}
                      </label>
                    ))}
                  </div>
                  <input value={c.conditionOther} onChange={(e) => updateChild(i, "conditionOther", e.target.value)} placeholder="Other (optional)" className="w-full border border-stone-200 rounded-xl px-3 py-2 text-sm outline-none focus:border-orange-300" />
                </div>
              ))}
            </div>
            <button onClick={() => setChildren((prev) => [...prev, emptyChild()])} className="w-full flex items-center justify-center gap-1.5 text-sm font-bold text-orange-600 bg-orange-50 py-2.5 rounded-2xl mb-6"><Plus size={15} /> Add another child</button>
            <div className="flex gap-2">
              <button onClick={() => setStep(1)} className="px-4 py-3 rounded-2xl border border-stone-200 text-slate-500 font-bold text-sm">Back</button>
              <button disabled={!children[0]?.name} onClick={() => setStep(3)} className="flex-1 bg-orange-500 disabled:bg-stone-300 text-white font-bold py-3 rounded-2xl">Continue</button>
            </div>
          </div>
        )}

        {step === 3 && (
          <div>
            <h2 style={fredoka} className="text-xl font-semibold text-slate-800 mb-1">Before we begin</h2>
            <p className="text-sm text-slate-500 mb-5">Please confirm the following for each child on your account.</p>
            <div className="space-y-3 mb-5">
              <ConsentRow checked={consents.responsibility} onChange={(v) => setConsents((p) => ({ ...p, responsibility: v }))}>I am at least 18 years old, and I am the parent of, or hold parental responsibility for, each child I've added.</ConsentRow>
              <ConsentRow checked={consents.specialCategory} onChange={(v) => setConsents((p) => ({ ...p, specialCategory: v }))}>I consent to Everside processing special category data about my child or children.</ConsentRow>
              <ConsentRow checked={consents.aiProcessing} onChange={(v) => setConsents((p) => ({ ...p, aiProcessing: v }))}>I understand messages and documents I share with the Navigator are processed by a third-party AI provider.</ConsentRow>
              <ConsentRow checked={consents.aiLimits} onChange={(v) => setConsents((p) => ({ ...p, aiLimits: v }))}>I understand the Navigator is an AI, not a solicitor, doctor, or local authority officer.</ConsentRow>
              <ConsentRow checked={consents.humanReview} onChange={(v) => setConsents((p) => ({ ...p, humanReview: v }))}>I understand a member of the Everside team may read an escalated conversation to help me.</ConsentRow>
            </div>
            <div className="flex gap-2">
              <button onClick={() => setStep(2)} className="px-4 py-3 rounded-2xl border border-stone-200 text-slate-500 font-bold text-sm">Back</button>
              <button disabled={!canFinishConsent} onClick={finishOnboarding} className="flex-1 bg-orange-500 disabled:bg-stone-300 text-white font-bold py-3 rounded-2xl">Send my sign-in link</button>
            </div>
            {onboardError && (
              <div className="mt-3 bg-rose-50 border border-rose-200 rounded-2xl p-3 text-xs text-rose-700 font-semibold">{onboardError}</div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function ConsentRow({ checked, onChange, children }) {
  return (
    <label className="flex items-start gap-3 bg-white border border-stone-200 rounded-2xl p-3.5 cursor-pointer">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="mt-0.5 flex-shrink-0" />
      <span className="text-sm text-slate-600 leading-snug">{children}</span>
    </label>
  );
}

// ============ MAIN APP COMPONENTS ============

function NavBtn({ icon: Icon, label, active, onClick }) {
  return (
    <button onClick={onClick} className="flex flex-col items-center gap-0.5 px-3 py-1.5 rounded-xl transition-colors" style={{ color: active ? "#EA580C" : "#94A3B8" }}>
      <Icon size={22} strokeWidth={active ? 2.4 : 2} /><span className="text-[11px] font-semibold">{label}</span>
    </button>
  );
}

function SafetyNote() {
  return (
    <div className="flex items-start gap-2 bg-sky-50 border border-sky-100 rounded-2xl px-4 py-3 text-xs text-slate-500">
      <Info size={15} className="mt-0.5 flex-shrink-0" /><span>Everside helps you understand and organise information. It doesn't replace legal, medical, educational or professional advice.</span>
    </div>
  );
}

function Toggle({ on, onChange }) {
  return (
    <button onClick={() => onChange(!on)} className={`w-11 h-6 rounded-full transition-colors relative flex-shrink-0 ${on ? "bg-emerald-400" : "bg-stone-300"}`}>
      <span className={`absolute top-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${on ? "translate-x-5" : "translate-x-0.5"}`} />
    </button>
  );
}

function VaultLockScreen({ fredoka, onUnlock }) {
  const [pin, setPin] = useState("");
  const [verifying, setVerifying] = useState(false);
  const [wrong, setWrong] = useState(false);

  useEffect(() => {
    if (pin.length === 4) {
      setVerifying(true);
      (async () => {
        const { correct } = await checkVaultPasscode(pin);
        if (correct) { onUnlock(); }
        else { setWrong(true); setVerifying(false); setTimeout(() => { setPin(""); setWrong(false); }, 700); }
      })();
    }
  }, [pin]);

  function press(d) { if (verifying || pin.length >= 4) return; setPin(pin + d); }
  function backspace() { if (verifying) return; setPin(pin.slice(0, -1)); }
  const keys = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "", "0", "⌫"];

  return (
    <div className="max-w-md mx-auto px-6 pt-14 flex flex-col items-center text-center">
      <div className="relative mb-6">
        <div className="absolute inset-0 rounded-full bg-orange-200 blur-2xl opacity-40 scale-150" />
        <div className="relative w-20 h-20 rounded-full bg-white border-2 border-orange-200 flex items-center justify-center shadow-sm"><Lock size={28} className="text-orange-500" /></div>
      </div>
      <h2 style={fredoka} className="text-xl font-semibold text-slate-800 mb-1">Unlock your Vault</h2>
      <p className="text-sm text-slate-500 mb-8">Enter your 4-digit passcode to continue.</p>
      <div className="flex gap-3 mb-8">{[0, 1, 2, 3].map((i) => <span key={i} className={`w-3 h-3 rounded-full border-2 transition-colors ${wrong ? "bg-rose-400 border-rose-400" : i < pin.length ? "bg-orange-500 border-orange-500" : "border-stone-300"}`} />)}</div>
      {verifying ? <p className="text-xs font-bold text-emerald-600 mb-6">Verifying…</p>
        : wrong ? <p className="text-xs font-bold text-rose-500 mb-6">Incorrect passcode, try again</p>
        : <div className="grid grid-cols-3 gap-3 w-56">{keys.map((d, i) => d === "" ? <div key={i} /> : <button key={i} onClick={() => (d === "⌫" ? backspace() : press(d))} className="h-14 rounded-2xl bg-white border border-stone-200 text-lg font-bold text-slate-700 hover:bg-stone-50 active:scale-95 transition-transform">{d}</button>)}</div>}
      <p className="text-xs text-slate-400 mt-8 flex items-center gap-1.5"><ShieldCheck size={13} /> This is the passcode you set when you created your account</p>
    </div>
  );
}

function ChatFeedbackModal({ fredoka, onSubmit, onSkip }) {
  const [rating, setRating] = useState(0);
  const [hoverRating, setHoverRating] = useState(0);
  const [comment, setComment] = useState("");
  const [sending, setSending] = useState(false);
  const showComment = rating > 0 && rating < 4;

  async function send() {
    setSending(true);
    await onSubmit(rating, comment.trim());
  }

  return (
    <div className="fixed inset-0 bg-slate-900/40 z-40 flex items-end sm:items-center justify-center">
      <div className="bg-white rounded-t-3xl sm:rounded-3xl w-full max-w-sm p-6">
        <h3 style={fredoka} className="text-lg font-semibold text-slate-800 mb-1">How did that go?</h3>
        <p className="text-sm text-slate-500 mb-5">Your rating helps us make the Navigator more useful.</p>

        <div className="flex justify-center gap-2 mb-2">
          {[1, 2, 3, 4, 5].map((n) => (
            <button
              key={n}
              type="button"
              onClick={() => setRating(n)}
              onMouseEnter={() => setHoverRating(n)}
              onMouseLeave={() => setHoverRating(0)}
              aria-label={`${n} star${n > 1 ? "s" : ""}`}
              className="p-1"
            >
              <Star
                size={30}
                className={(hoverRating || rating) >= n ? "text-amber-400" : "text-stone-300"}
                fill={(hoverRating || rating) >= n ? "currentColor" : "none"}
              />
            </button>
          ))}
        </div>

        {showComment && (
          <div className="mt-4">
            <label className="text-xs font-bold text-slate-600 mb-1.5 block">What went wrong? (optional, but it helps)</label>
            <textarea
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              rows={3}
              placeholder="e.g. it didn't quite understand my situation, or the answer was too vague…"
              className="w-full text-sm border border-stone-200 rounded-2xl p-3 outline-none focus:border-orange-300 resize-none"
            />
          </div>
        )}

        <div className="flex gap-2 mt-5">
          <button onClick={onSkip} disabled={sending} className="flex-1 text-sm font-bold py-3 rounded-2xl bg-stone-100 text-slate-500 disabled:opacity-50">Skip</button>
          <button
            onClick={send}
            disabled={rating === 0 || sending}
            className="flex-1 text-sm font-bold py-3 rounded-2xl bg-orange-500 text-white disabled:opacity-40 flex items-center justify-center gap-2"
          >
            {sending ? <Loader2 size={16} className="animate-spin" /> : "Send"}
          </button>
        </div>
      </div>
    </div>
  );
}

const CANCEL_REASONS = [
  ["too_expensive", "It costs too much"],
  ["got_what_i_needed", "I've got what I needed"],
  ["not_using_enough", "I'm not using it enough"],
  ["answers_not_helpful", "The answers weren't helpful enough"],
  ["missing_feature", "It's missing something I need"],
  ["privacy_concern", "I'm concerned about my family's privacy"],
  ["technical_problems", "It didn't work well for me"],
  ["other", "Something else"],
  ["prefer_not_to_say", "I'd rather not say"],
];

function fmtDate(iso) {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
}
function addSixMonths(iso) {
  if (!iso) return null;
  const d = new Date(iso); if (Number.isNaN(d.getTime())) return null;
  d.setMonth(d.getMonth() + 6); return d.toISOString();
}

// Asks why they are leaving, then what should happen to their information, then does it.
function CancelFlow({ fredoka, profile, planName, onClose, onBuildZip, onCancelled }) {
  const [step, setStep] = useState("reason");
  const [reason, setReason] = useState("");
  const [comment, setComment] = useState("");
  const [choice, setChoice] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [zip, setZip] = useState(null);           // { filesAdded, chatFiles, missing, bytes }
  const [progress, setProgress] = useState(null);
  const [ackMissing, setAckMissing] = useState(false);
  const [ackDelete, setAckDelete] = useState(false);
  const [result, setResult] = useState(null);
  const endsOn = fmtDate(profile?.current_period_end);
  const deleteOn = fmtDate(addSixMonths(profile?.current_period_end));

  async function makeZip() {
    setBusy(true); setError("");
    try {
      const out = await onBuildZip((p) => setProgress(p));
      setZip({ filesAdded: out.filesAdded, chatFiles: out.chatFiles, missing: out.missing, bytes: out.bytes });
    } catch (e) { setError("We couldn't make your zip file. Nothing has been deleted. Please try again."); }
    setBusy(false);
  }
  async function submit() {
    setBusy(true); setError("");
    const out = await onCancelled({ reason, comment, choice, confirmed: choice === "export_delete" });
    setBusy(false);
    if (out?.error) { setError(out.error); return; }
    setResult(out); setStep("done");
  }
  const canDelete = zip && (!zip.missing.length || ackMissing) && ackDelete;
  const size = zip ? (zip.bytes >= 1048576 ? `${(zip.bytes / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(zip.bytes / 1024))} KB`) : "";

  return (
    <div className="fixed inset-0 bg-slate-900/50 z-50 flex items-end sm:items-center justify-center" role="dialog" aria-modal="true" aria-label="Cancel my plan">
      <div className="bg-white rounded-t-3xl sm:rounded-3xl w-full max-w-md p-6 max-h-[90vh] overflow-y-auto">
        {step === "reason" && (
          <div>
            <h3 style={fredoka} className="text-lg font-semibold text-slate-800 mb-1">Before you go</h3>
            <p className="text-sm text-slate-500 mb-4">What's the main reason you're cancelling? It really helps us improve.</p>
            <div role="radiogroup" aria-label="Reason for cancelling" className="space-y-2 mb-4">
              {CANCEL_REASONS.map(([id, label]) => (
                <button key={id} role="radio" aria-checked={reason === id} onClick={() => setReason(id)}
                  className={`w-full text-left text-sm font-semibold px-4 py-3 rounded-2xl border transition-colors ${reason === id ? "bg-orange-50 border-orange-400 text-slate-800" : "bg-white border-stone-200 text-slate-600 hover:bg-stone-50"}`}>{label}</button>
              ))}
            </div>
            <label className="block text-xs font-bold text-slate-500 mb-1" htmlFor="cancel-comment">Anything we could have done better? (optional)</label>
            <textarea id="cancel-comment" value={comment} onChange={(e) => setComment(e.target.value.slice(0, 1000))} rows={3} className="w-full border border-stone-200 rounded-2xl p-3 text-sm mb-1 focus:outline-none focus:border-orange-400" />
            <p className="text-xs text-slate-400 mb-5">Please don't include your child's name or other personal details.</p>
            <div className="flex gap-2">
              <button onClick={onClose} className="flex-1 text-sm font-bold py-3 rounded-2xl bg-stone-100 text-slate-700">Keep my plan</button>
              <button disabled={!reason} onClick={() => setStep("choice")} className="flex-1 text-sm font-bold py-3 rounded-2xl bg-orange-500 text-white disabled:opacity-40">Continue</button>
            </div>
          </div>
        )}

        {step === "choice" && (
          <div>
            <h3 style={fredoka} className="text-lg font-semibold text-slate-800 mb-1">What should happen to your information?</h3>
            <p className="text-sm text-slate-500 mb-4">Your children's details, Vault documents and actions are yours. You decide.</p>
            <div role="radiogroup" aria-label="What to do with your information" className="space-y-3 mb-4">
              <button role="radio" aria-checked={choice === "keep"} onClick={() => setChoice("keep")} className={`w-full text-left p-4 rounded-2xl border transition-colors ${choice === "keep" ? "bg-orange-50 border-orange-400" : "bg-white border-stone-200 hover:bg-stone-50"}`}>
                <p className="text-sm font-bold text-slate-800 mb-1">Keep my information</p>
                <p className="text-xs text-slate-500 leading-relaxed">You keep your plan until {endsOn || "the end of the period you've paid for"}. After that we hold your information for 6 months so you can come back to it. If you haven't renewed by then, it is deleted automatically. You can download or delete it yourself at any time.</p>
              </button>
              <button role="radio" aria-checked={choice === "export_delete"} onClick={() => setChoice("export_delete")} className={`w-full text-left p-4 rounded-2xl border transition-colors ${choice === "export_delete" ? "bg-orange-50 border-orange-400" : "bg-white border-stone-200 hover:bg-stone-50"}`}>
                <p className="text-sm font-bold text-slate-800 mb-1">Give me a zip file and delete everything</p>
                <p className="text-xs text-slate-500 leading-relaxed">We make a zip of your documents and details for you to save. Then we delete everything from our servers, including your account, and cancel your plan straight away, so there are no more payments. This can't be undone.</p>
              </button>
            </div>
            <p className="text-xs text-slate-400 mb-5">Everside doesn't store your chats. The zip includes any Navigator conversation that is open right now.</p>
            <div className="flex gap-2">
              <button onClick={() => setStep("reason")} className="flex-1 text-sm font-bold py-3 rounded-2xl bg-stone-100 text-slate-700">Back</button>
              <button disabled={!choice} onClick={() => setStep("confirm")} className="flex-1 text-sm font-bold py-3 rounded-2xl bg-orange-500 text-white disabled:opacity-40">Continue</button>
            </div>
          </div>
        )}

        {step === "confirm" && choice === "keep" && (
          <div>
            <h3 style={fredoka} className="text-lg font-semibold text-slate-800 mb-3">Confirm cancellation</h3>
            <ul className="text-sm text-slate-600 space-y-2 mb-5 list-disc pl-5">
              <li>Your {planName || "plan"} stays active until {endsOn || "the end of the period you've paid for"}. You won't be charged again.</li>
              <li>After that, your information is kept for 6 months{deleteOn ? `, until ${deleteOn}` : ""}. If you haven't renewed by then, it is deleted automatically.</li>
              <li>You can come back and renew, download your files, or delete everything yourself whenever you like.</li>
            </ul>
            {error && <p role="alert" className="text-sm text-rose-600 font-semibold mb-3">{error}</p>}
            <div className="flex gap-2">
              <button onClick={() => setStep("choice")} disabled={busy} className="flex-1 text-sm font-bold py-3 rounded-2xl bg-stone-100 text-slate-700">Back</button>
              <button onClick={submit} disabled={busy} className="flex-1 text-sm font-bold py-3 rounded-2xl bg-rose-500 text-white disabled:opacity-50">{busy ? "Cancelling…" : "Cancel my plan"}</button>
            </div>
          </div>
        )}

        {step === "confirm" && choice === "export_delete" && (
          <div>
            <h3 style={fredoka} className="text-lg font-semibold text-slate-800 mb-3">Save your files, then delete</h3>
            <p className="text-sm font-bold text-slate-700 mb-1">Step 1. Make your zip</p>
            {!zip ? (
              <button onClick={makeZip} disabled={busy} className="w-full flex items-center gap-2 justify-center bg-orange-500 text-white font-bold text-sm py-3 rounded-2xl mb-4 disabled:opacity-60"><Download size={16} />{busy ? (progress && progress.total ? `Collecting ${progress.done} of ${progress.total} documents…` : "Collecting your files…") : "Make and download my zip"}</button>
            ) : (
              <div className="bg-emerald-50 border border-emerald-100 rounded-2xl p-3 text-sm text-slate-700 mb-4">
                <p className="font-bold">Your zip has been downloaded ({size}).</p>
                <p className="text-xs text-slate-500">{zip.filesAdded} document{zip.filesAdded === 1 ? "" : "s"}{zip.chatFiles ? `, ${zip.chatFiles} conversation${zip.chatFiles === 1 ? "" : "s"}` : ""} and your details. Check that it opened and is saved somewhere safe before you continue.</p>
                {zip.missing.length > 0 && (
                  <div className="mt-2">
                    <p className="text-xs text-rose-700 font-semibold">{zip.missing.length} file{zip.missing.length === 1 ? "" : "s"} could not be included.</p>
                    <label className="flex items-start gap-2 text-xs text-slate-600 mt-1"><input type="checkbox" checked={ackMissing} onChange={(e) => setAckMissing(e.target.checked)} className="mt-0.5" /> I understand {zip.missing.length === 1 ? "it" : "they"} will be deleted without being saved.</label>
                  </div>
                )}
                <button onClick={makeZip} disabled={busy} className="text-xs font-bold text-emerald-700 mt-2">Make it again</button>
              </div>
            )}
            <p className="text-sm font-bold text-slate-700 mb-1">Step 2. Delete everything and cancel</p>
            <p className="text-xs text-slate-500 mb-2">This deletes your account, children, Vault documents and actions, and cancels your plan today with no refund. It can't be undone.</p>
            <label className="flex items-start gap-2 text-xs text-slate-600 mb-4"><input type="checkbox" checked={ackDelete} disabled={!zip} onChange={(e) => setAckDelete(e.target.checked)} className="mt-0.5" /> I have saved my zip and want everything deleted.</label>
            {error && <p role="alert" className="text-sm text-rose-600 font-semibold mb-3">{error}</p>}
            <div className="flex gap-2">
              <button onClick={() => setStep("choice")} disabled={busy} className="flex-1 text-sm font-bold py-3 rounded-2xl bg-stone-100 text-slate-700">Back</button>
              <button onClick={submit} disabled={busy || !canDelete} className="flex-1 text-sm font-bold py-3 rounded-2xl bg-rose-500 text-white disabled:opacity-40">{busy ? "Deleting…" : "Delete everything"}</button>
            </div>
          </div>
        )}

        {step === "done" && result?.deleted && (
          <div className="text-center">
            <h3 style={fredoka} className="text-lg font-semibold text-slate-800 mb-2">Everything has been deleted</h3>
            <p className="text-sm text-slate-500 mb-5">Your plan is cancelled, you won't be charged again, and your information is gone from Everside. Thank you for trying us, and good luck with everything.</p>
            <button onClick={async () => { try { await supabase.auth.signOut(); } catch {} window.location.href = "/"; }} className="w-full text-sm font-bold py-3 rounded-2xl bg-orange-500 text-white">Done</button>
          </div>
        )}
        {step === "done" && !result?.deleted && (
          <div className="text-center">
            <h3 style={fredoka} className="text-lg font-semibold text-slate-800 mb-2">Your plan is cancelled</h3>
            <p className="text-sm text-slate-500 mb-2">You can keep using {planName || "your plan"} until {fmtDate(result?.ends_on) || endsOn || "the end of the period you've paid for"}.</p>
            <p className="text-sm text-slate-500 mb-5">We'll keep your information for 6 months after that{fmtDate(result?.delete_after) ? `, until ${fmtDate(result.delete_after)}` : ""}, then delete it automatically unless you renew. We'll email you before it happens.</p>
            <button onClick={onClose} className="w-full text-sm font-bold py-3 rounded-2xl bg-orange-500 text-white">Done</button>
          </div>
        )}
      </div>
    </div>
  );
}

function SecurityPanel({ fredoka, onClose, requirePasscode, setRequirePasscode, autoLockOnSwitch, setAutoLockOnSwitch, onExport, onDeleteAll, onDeleteAccount, profile, onUpgrade, onManageBilling, onBuildZip, onCancelled, onResume, exporting }) {
  const [confirming, setConfirming] = useState(false);
  const [confirmingAccount, setConfirmingAccount] = useState(false);
  const [interval, setInterval_] = useState("year");
  const [cancelling, setCancelling] = useState(false);
  const isActive = profile?.subscription_status === "active" || profile?.subscription_status === "trialing";
  const currentTier = SUBSCRIPTION_TIERS.find((t) => t.id === profile?.subscription_tier);
  const endingOn = fmtDate(profile?.current_period_end);
  const deletionDate = fmtDate(profile?.data_delete_after);
  return (
    <div className="fixed inset-0 bg-slate-900/40 z-40 flex items-end sm:items-center justify-center" onClick={onClose}>
      <div className="bg-white rounded-t-3xl sm:rounded-3xl w-full max-w-md p-6 max-h-[85vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h3 style={fredoka} className="text-lg font-semibold text-slate-800 flex items-center gap-2"><ShieldCheck size={19} className="text-emerald-500" /> Privacy &amp; security</h3>
          <button onClick={onClose} className="text-slate-400" aria-label="Close"><X size={20} /></button>
        </div>

        <div className="mb-5">
          <p className="text-xs font-bold text-slate-500 uppercase tracking-wide mb-2">Your plan</p>
          {isActive ? (
            <div className="bg-emerald-50 border border-emerald-100 rounded-2xl p-4">
              <p className="text-sm font-bold text-slate-700">{currentTier?.name || "Subscribed"}{profile?.billing_interval ? `, billed ${profile.billing_interval === "year" ? "yearly" : "monthly"}` : ""}</p>
              <p className="text-xs text-slate-500 mb-3">
                {profile?.cancel_at_period_end
                  ? `Ends on ${endingOn || "the end of this period"}. We keep your information for 6 months after that, then delete it automatically unless you renew.`
                  : profile?.subscription_status === "trialing" ? "Free trial active" : `Renews on ${endingOn || "your next billing date"}`}
              </p>
              <div className="flex flex-wrap gap-2">
                <button onClick={onManageBilling} className="text-xs font-bold text-emerald-700 bg-white border border-emerald-200 px-3 py-1.5 rounded-full">Payment details</button>
                {profile?.cancel_at_period_end
                  ? <button onClick={onResume} className="text-xs font-bold text-emerald-700 bg-white border border-emerald-200 px-3 py-1.5 rounded-full">Keep my plan</button>
                  : <button onClick={() => setCancelling(true)} className="text-xs font-bold text-slate-500 bg-white border border-stone-200 px-3 py-1.5 rounded-full">Cancel plan</button>}
              </div>
            </div>
          ) : (
            <div>
              {deletionDate && (
                <div className="bg-amber-50 border border-amber-200 rounded-2xl p-3 text-xs text-amber-900 mb-3 leading-relaxed">Your plan has ended. Your information will be deleted automatically on <span className="font-bold">{deletionDate}</span> unless you start a plan again before then. You can download everything below at any time.</div>
              )}
              <div role="radiogroup" aria-label="Billing period" className="grid grid-cols-2 gap-1 bg-stone-100 rounded-full p-1 mb-3">
                {[["month", "Monthly"], ["year", "Yearly"]].map(([id, label]) => (
                  <button key={id} role="radio" aria-checked={interval === id} onClick={() => setInterval_(id)} className={`text-xs font-bold py-2 rounded-full transition-colors ${interval === id ? "bg-white text-slate-800 shadow-sm" : "text-slate-500"}`}>{label}</button>
                ))}
              </div>
              <div className="space-y-2">
                {SUBSCRIPTION_TIERS.map((tier) => (
                  <button key={tier.id} onClick={() => onUpgrade(tier.id, interval)} className="w-full text-left bg-orange-50 border border-orange-100 hover:bg-orange-100 rounded-2xl p-4 transition-colors">
                    <p className="text-sm font-bold text-slate-700">{tier.name}{PRICES[tier.id]?.[interval] ? <span className="font-semibold text-slate-500">, {PRICES[tier.id][interval]}</span> : null}</p>
                    <p className="text-xs text-slate-500">{tier.blurb}</p>
                  </button>
                ))}
              </div>
              <p className="text-xs text-slate-400 mt-2">Cancel any time. If you leave, we keep your information for 6 months, then delete it automatically unless you renew.</p>
            </div>
          )}
        </div>

        <div className="bg-sky-50 border border-sky-100 rounded-2xl p-4 text-xs text-slate-500 mb-5 leading-relaxed">Your data is stored in a real database, scoped to your account only. Documents and messages you share with the Navigator are also processed by our AI provider to generate a reply. If your plan ends and you don't renew, or you have no plan and don't open Everside for 6 months, your information is deleted automatically (we email you first).</div>
        <div className="space-y-4 mb-5">
          <div className="flex items-center justify-between gap-3"><div><p className="text-sm font-bold text-slate-700">Require passcode for Vault</p><p className="text-xs text-slate-400">Ask for your 4-digit code before opening it</p></div><Toggle on={requirePasscode} onChange={setRequirePasscode} /></div>
          <div className="flex items-center justify-between gap-3"><div><p className="text-sm font-bold text-slate-700">Auto-lock when I switch tabs</p><p className="text-xs text-slate-400">Re-lock the Vault every time you leave it</p></div><Toggle on={autoLockOnSwitch} onChange={setAutoLockOnSwitch} /></div>
        </div>
        <div className="space-y-2">
          <button onClick={onExport} disabled={exporting} className="w-full flex items-center gap-2 justify-center bg-stone-100 hover:bg-stone-200 text-slate-700 font-bold text-sm py-3 rounded-2xl transition-colors disabled:opacity-60"><Download size={16} /> {exporting ? "Preparing your zip…" : "Download all my files (zip)"}</button>
          {!confirming ? (
            <button onClick={() => setConfirming(true)} className="w-full flex items-center gap-2 justify-center bg-rose-50 hover:bg-rose-100 text-rose-600 font-bold text-sm py-3 rounded-2xl transition-colors"><Trash2 size={16} /> Delete this child's data</button>
          ) : (
            <div className="bg-rose-50 border border-rose-200 rounded-2xl p-3 text-center">
              <p className="text-xs text-rose-700 font-semibold mb-2">This permanently deletes this child's Vault and actions from the database.</p>
              <div className="flex gap-2">
                <button onClick={() => setConfirming(false)} className="flex-1 text-xs font-bold py-2 rounded-xl bg-white text-slate-600 border border-stone-200">Cancel</button>
                <button onClick={() => { onDeleteAll(); setConfirming(false); onClose(); }} className="flex-1 text-xs font-bold py-2 rounded-xl bg-rose-500 text-white">Yes, delete</button>
              </div>
            </div>
          )}
          {!confirmingAccount ? (
            <button onClick={() => setConfirmingAccount(true)} className="w-full flex items-center gap-2 justify-center bg-white hover:bg-rose-50 text-rose-600 border border-rose-200 font-bold text-sm py-3 rounded-2xl transition-colors"><Trash2 size={16} /> Delete my account and everything in it</button>
          ) : (
            <div className="bg-rose-50 border border-rose-200 rounded-2xl p-3 text-center">
              <p className="text-xs text-rose-700 font-semibold mb-2">This permanently deletes your sign-in, every child, every action and every uploaded document, and cancels any plan you have. It cannot be undone. Download your files first if you want a copy.</p>
              <div className="flex gap-2">
                <button onClick={() => setConfirmingAccount(false)} className="flex-1 text-xs font-bold py-2 rounded-xl bg-white text-slate-600 border border-stone-200">Cancel</button>
                <button onClick={() => { onDeleteAccount(); setConfirmingAccount(false); }} className="flex-1 text-xs font-bold py-2 rounded-xl bg-rose-500 text-white">Yes, delete everything</button>
              </div>
            </div>
          )}
        </div>
      </div>
      {cancelling && (
        <div onClick={(e) => e.stopPropagation()}>
          <CancelFlow fredoka={fredoka} profile={profile} planName={currentTier?.name} onClose={() => setCancelling(false)} onBuildZip={onBuildZip} onCancelled={onCancelled} />
        </div>
      )}
    </div>
  );
}

function HomeTab({ fredoka, child, vault, actions, goToChat, goToActions, goToGuide, onOpenSecurity }) {
  const dueSoon = actions.find((a) => a.status === "due");
  const vaultCount = Object.values(vault).reduce((n, arr) => n + arr.length, 0);
  return (
    <div className="max-w-md mx-auto px-5 pt-8 space-y-6">
      <h1 style={fredoka} className="text-2xl font-semibold text-slate-800">What would you like help with for {child.name} today?</h1>
      <button onClick={goToChat} className="w-full text-left bg-white border border-stone-200 rounded-3xl px-5 py-4 flex items-center gap-3 shadow-sm hover:shadow-md transition-shadow">
        <Sparkles size={20} className="text-orange-500 flex-shrink-0" /><span className="text-slate-400 font-semibold flex-1">Tell me what's happening…</span><ChevronRight size={18} className="text-slate-300" />
      </button>
      <button onClick={goToGuide} className="w-full text-left bg-sky-50 border border-sky-100 rounded-3xl px-5 py-4 flex items-center gap-3 hover:shadow-sm transition-shadow">
        <BookOpen size={20} className="text-sky-600 flex-shrink-0" /><span className="text-sky-700 font-semibold flex-1">Read the EHCP &amp; SEND guide</span><ChevronRight size={18} className="text-sky-300" />
      </button>
      <div className="bg-emerald-50 border border-emerald-100 rounded-3xl p-5">
        <p className="text-xs font-bold uppercase tracking-wide text-emerald-700 mb-3">{child.name}'s journey</p>
        <p style={fredoka} className="text-lg font-semibold text-slate-800 mb-1">{STAGES[child.journey_stage || 0].title}</p>
        <p className="text-sm text-slate-500">{STAGES[child.journey_stage || 0].blurb}</p>
      </div>
      {dueSoon && (
        <div className="bg-rose-50 border border-rose-100 rounded-3xl p-5">
          <p className="text-xs font-bold uppercase tracking-wide text-rose-600 mb-2">Your next best step</p>
          <p style={fredoka} className="text-lg font-semibold text-slate-800 mb-1">{dueSoon.title}</p>
          <p className="text-sm text-slate-500 mb-3">Due {dueSoon.due_date}</p>
          <button onClick={goToActions} className="bg-rose-400 hover:bg-rose-500 text-white text-sm font-bold px-4 py-2 rounded-full transition-colors">Prepare now</button>
        </div>
      )}
      <div className="bg-white border border-stone-200 rounded-3xl p-5 flex items-center justify-between gap-3">
        <div><p className="text-xs font-bold uppercase tracking-wide text-slate-400 mb-2">Progress</p><p className="text-sm text-slate-600">You've organised <span className="font-bold text-slate-800">{vaultCount} piece{vaultCount === 1 ? "" : "s"}</span> of information in your Vault.</p></div>
        <ShieldCheck size={22} className="text-emerald-400 flex-shrink-0" />
      </div>
      <button onClick={onOpenSecurity} className="w-full flex items-center justify-center gap-2 text-sm font-bold text-slate-600 bg-white border border-stone-200 hover:bg-stone-50 rounded-2xl py-3 transition-colors"><ShieldCheck size={16} className="text-emerald-500" /> Plan, privacy and your data</button>
      <SafetyNote />
    </div>
  );
}

function UsageMeter({ usage, onSeePlans }) {
  if (!usage) return null;
  const msgLeft = Math.max(usage.messages_limit - usage.messages_used, 0);
  const docLeft = Math.max(usage.doc_reads_limit - usage.doc_reads_used, 0);
  const todayLeft = Math.max(usage.messages_per_day - usage.messages_today, 0);
  const isFree = usage.tier === "free";
  const low = msgLeft <= Math.ceil(usage.messages_limit * 0.1) || docLeft === 0;
  const resets = usage.resets_on ? new Date(usage.resets_on + "T00:00:00Z").toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" }) : null;
  return (
    <div className={`text-xs rounded-2xl px-3 py-2 mb-2 flex items-center justify-between gap-2 flex-wrap ${low ? "bg-amber-50 text-amber-800 border border-amber-200" : "bg-stone-100 text-slate-500"}`} role="status">
      <span>
        <b>{msgLeft}</b> of {usage.messages_limit} {isFree ? "free messages left" : "messages left this month"}
        {" · "}<b>{docLeft}</b> of {usage.doc_reads_limit} document {usage.doc_reads_limit === 1 ? "read" : "reads"}
        {todayLeft <= 3 && todayLeft < msgLeft ? ` · ${todayLeft} left today` : ""}
        {resets && !isFree ? ` · resets ${resets}` : ""}
      </span>
      {(isFree || low) && <button onClick={onSeePlans} className="font-bold underline">See plans</button>}
    </div>
  );
}

function ChatTab({ fredoka, child, messages, loading, input, setInput, pendingImage, setPendingImage, fileInputRef, handleFile, handleSend, aiUsage, chatError, onSeePlans, saveLastToVault, createActionFromChat, chatEndRef }) {
  const lastIsAssistant = messages.length > 0 && messages[messages.length - 1].role === "assistant";
  const msgsUsedUp = !!aiUsage && (aiUsage.messages_used >= aiUsage.messages_limit || aiUsage.messages_today >= aiUsage.messages_per_day);
  const docsUsedUp = !!aiUsage && aiUsage.doc_reads_used >= aiUsage.doc_reads_limit;
  return (
    <div className="max-w-md mx-auto px-4 pt-6 flex flex-col h-[calc(100vh-96px)]">
      <h2 style={fredoka} className="text-lg font-semibold text-slate-800 mb-3 px-1">Everside Navigator · {child.name}</h2>
      <div className="flex-1 overflow-y-auto space-y-3 pb-3">
        {messages.map((m, i) => (
          <div key={i} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
            <div className={`max-w-[85%] rounded-3xl px-4 py-3 text-sm ${m.role === "user" ? "bg-orange-500 text-white rounded-br-lg" : "bg-white border border-stone-200 text-slate-700 rounded-bl-lg"}`}>
              {m.image && (m.image.kind === "pdf"
                ? <p className="flex items-center gap-1.5 text-xs font-bold mb-2 opacity-90"><Paperclip size={13} /> {m.image.name || "PDF"}</p>
                : <img src={m.image.preview} alt="uploaded document" className="rounded-xl mb-2 max-h-40 object-cover" />)}
              <p className="whitespace-pre-wrap leading-relaxed">{m.text}</p>
            </div>
          </div>
        ))}
        {loading && <div className="flex justify-start"><div className="bg-white border border-stone-200 rounded-3xl rounded-bl-lg px-4 py-3 text-sm text-slate-400">Thinking…</div></div>}
        {lastIsAssistant && !loading && messages.length > 1 && (
          <div className="flex gap-2 flex-wrap px-1">
            <button onClick={saveLastToVault} className="text-xs font-bold bg-emerald-100 text-emerald-700 px-3 py-1.5 rounded-full hover:bg-emerald-200 transition-colors">Save to Vault</button>
            <button onClick={createActionFromChat} className="text-xs font-bold bg-sky-100 text-sky-700 px-3 py-1.5 rounded-full hover:bg-sky-200 transition-colors">Create an action</button>
          </div>
        )}
        <div ref={chatEndRef} />
      </div>
      {chatError && <p className="text-xs font-semibold text-rose-600 bg-rose-50 border border-rose-100 rounded-2xl px-3 py-2 mb-2" role="alert">{chatError.text}</p>}
      <UsageMeter usage={aiUsage} onSeePlans={onSeePlans} />
      {pendingImage && <div className="relative inline-block mb-2">{pendingImage.kind === "pdf" ? <span className="inline-flex items-center gap-1.5 text-xs font-bold bg-white border border-stone-200 rounded-xl px-3 py-2 text-slate-600 max-w-[16rem] truncate"><Paperclip size={13} /> {pendingImage.name}</span> : <img src={pendingImage.preview} alt="attached" className="h-16 rounded-xl border border-stone-200" />}<button onClick={() => setPendingImage(null)} className="absolute -top-2 -right-2 bg-slate-700 text-white rounded-full p-0.5"><X size={12} /></button></div>}
      <div className="bg-white border border-stone-200 rounded-full flex items-center gap-1 px-2 py-1.5 shadow-sm mb-3">
        <input ref={fileInputRef} type="file" accept="image/jpeg,image/png,image/webp,application/pdf" onChange={handleFile} className="hidden" />
        <button onClick={() => fileInputRef.current?.click()} disabled={docsUsedUp || msgsUsedUp} title={docsUsedUp ? "No document reads left" : "Attach a photo or PDF"} className="p-2 text-slate-400 hover:text-orange-500 transition-colors flex-shrink-0 disabled:opacity-40 disabled:hover:text-slate-400"><Paperclip size={18} /></button>
        <input value={input} disabled={msgsUsedUp} onChange={(e) => setInput(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && !msgsUsedUp) handleSend(); }} placeholder={msgsUsedUp ? "You have used your messages for now" : "Tell me what's happening…"} className="flex-1 outline-none text-sm text-slate-700 bg-transparent min-w-0 disabled:opacity-60" />
        <button onClick={handleSend} disabled={msgsUsedUp} className="bg-orange-500 hover:bg-orange-600 text-white rounded-full p-2 flex-shrink-0 transition-colors disabled:opacity-40"><Send size={16} /></button>
      </div>
      <p className="text-[11px] text-slate-400 text-center -mt-1 mb-2">Everside only answers questions about your child's SEND journey. Photos and PDFs up to {aiUsage?.max_attachment_mb || 4} MB{aiUsage ? `, ${aiUsage.max_pdf_pages} pages` : ""}.</p>
    </div>
  );
}

function VaultTab({ fredoka, child, vault, openCategory, setOpenCategory, requirePasscode, onOpenSecurity, loading, vaultFileInputRef, onPickFile, uploadStep, uploadDraft, setUploadDraft, onConfirmUpload, onCancelUpload, onViewFile, onDeleteItem }) {
  const fileInput = <input ref={vaultFileInputRef} type="file" accept="image/*,.pdf,.doc,.docx" onChange={onPickFile} className="hidden" />;

  const uploadModal = uploadStep !== "idle" && (
    <div className="fixed inset-0 bg-slate-900/40 flex items-center justify-center p-5 z-50">
      <div className="bg-white rounded-3xl p-5 max-w-sm w-full">
        {uploadStep === "reading" && (
          <div className="flex flex-col items-center py-6 text-center">
            <Loader2 size={28} className="text-orange-500 animate-spin mb-3" />
            <p className="text-sm font-bold text-slate-700">Reading your document…</p>
            <p className="text-xs text-slate-400 mt-1">Working out which folder it belongs in.</p>
          </div>
        )}
        {uploadStep === "saving" && (
          <div className="flex flex-col items-center py-6 text-center">
            <Loader2 size={28} className="text-orange-500 animate-spin mb-3" />
            <p className="text-sm font-bold text-slate-700">Saving to your Vault…</p>
          </div>
        )}
        {uploadStep === "confirm" && (
          <>
            <h3 style={fredoka} className="text-lg font-semibold text-slate-800 mb-1">Save this document</h3>
            <p className="text-xs text-slate-400 mb-4">Check the folder and title, then save. You can always move it later.</p>
            <label className="block text-xs font-bold text-slate-500 mb-1">Folder</label>
            <select value={uploadDraft.category} onChange={(e) => setUploadDraft((p) => ({ ...p, category: e.target.value }))} className="w-full border border-stone-200 rounded-xl px-3 py-2 text-sm mb-3 bg-white">
              {VAULT_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
            <label className="block text-xs font-bold text-slate-500 mb-1">Title</label>
            <input value={uploadDraft.title} onChange={(e) => setUploadDraft((p) => ({ ...p, title: e.target.value }))} className="w-full border border-stone-200 rounded-xl px-3 py-2 text-sm mb-3" placeholder="e.g. EP report, March 2026" />
            <label className="block text-xs font-bold text-slate-500 mb-1">Date</label>
            <input value={uploadDraft.item_date} onChange={(e) => setUploadDraft((p) => ({ ...p, item_date: e.target.value }))} className="w-full border border-stone-200 rounded-xl px-3 py-2 text-sm mb-4" />
            <div className="flex gap-2">
              <button onClick={onCancelUpload} className="flex-1 py-2.5 rounded-full font-bold text-sm text-slate-500 bg-stone-100">Cancel</button>
              <button onClick={onConfirmUpload} className="flex-1 py-2.5 rounded-full font-bold text-sm text-white bg-orange-500">Save</button>
            </div>
          </>
        )}
      </div>
    </div>
  );

  if (openCategory) {
    const items = vault[openCategory];
    return (
      <div className="max-w-md mx-auto px-5 pt-6">
        {fileInput}
        <button onClick={() => setOpenCategory(null)} className="flex items-center gap-1 text-sm font-bold text-slate-500 mb-4"><ArrowLeft size={16} /> My Vault</button>
        <div className="flex items-center justify-between mb-4">
          <h2 style={fredoka} className="text-xl font-semibold text-slate-800">{openCategory}</h2>
          <button onClick={() => vaultFileInputRef.current?.click()} className="flex items-center gap-1 text-xs font-bold text-orange-600 bg-orange-50 rounded-full px-3 py-1.5"><Upload size={13} /> Add</button>
        </div>
        <div className="space-y-3">
          {items.length === 0 && <p className="text-sm text-slate-400">Nothing here yet.</p>}
          {items.map((it) => (
            <div key={it.id} className="bg-white border border-stone-200 rounded-2xl p-4">
              <div className="flex items-start gap-3">
                <FileText size={18} className="text-slate-300 flex-shrink-0 mt-0.5" />
                <div className="flex-1 min-w-0">
                  <p className="font-bold text-sm text-slate-800">{it.title}</p>
                  <p className="text-xs text-slate-400 mb-1">{it.item_date}</p>
                  {it.description && <p className="text-sm text-slate-500">{it.description}</p>}
                </div>
                {it.file_path && (
                  <button onClick={() => onViewFile(it)} className="flex-shrink-0 p-1.5 text-slate-400 hover:text-orange-500 transition-colors" title="View document"><Eye size={16} /></button>
                )}
                <button onClick={() => onDeleteItem(it)} className="flex-shrink-0 p-1.5 text-slate-300 hover:text-rose-500 transition-colors" title="Remove"><Trash2 size={16} /></button>
              </div>
            </div>
          ))}
        </div>
        {uploadModal}
      </div>
    );
  }
  const palette = ["bg-sky-100", "bg-orange-100", "bg-emerald-100", "bg-rose-100", "bg-amber-100", "bg-violet-100"];
  return (
    <div className="max-w-md mx-auto px-5 pt-6">
      {fileInput}
      <div className="flex items-start justify-between mb-1">
        <h2 style={fredoka} className="text-xl font-semibold text-slate-800">{child.name}'s Vault</h2>
        <button onClick={onOpenSecurity} className="p-2 rounded-full bg-emerald-50 hover:bg-emerald-100 text-emerald-600 transition-colors"><ShieldCheck size={18} /></button>
      </div>
      <p className="text-sm text-slate-500 mb-3">Everything you may need, organised in one place.</p>
      <div className="flex flex-wrap items-center gap-2 mb-5">
        <div className="inline-flex items-center gap-1.5 text-xs font-bold text-emerald-600 bg-emerald-50 border border-emerald-100 rounded-full px-3 py-1"><Lock size={11} /> {requirePasscode ? "Passcode protected · stored in your account" : "Stored in your account"}</div>
        <button onClick={() => vaultFileInputRef.current?.click()} className="inline-flex items-center gap-1.5 text-xs font-bold text-white bg-orange-500 rounded-full px-3 py-1.5"><Upload size={12} /> Add a document</button>
      </div>
      {loading ? <p className="text-sm text-slate-400">Loading…</p> : (
        <div className="grid grid-cols-2 gap-3">
          {Object.entries(vault).map(([cat, items], i) => (
            <button key={cat} onClick={() => setOpenCategory(cat)} className={`${palette[i % palette.length]} rounded-2xl p-4 text-left relative border border-white/70 shadow-sm hover:shadow-md transition-shadow`}>
              <Lock size={12} className="absolute top-3 right-3 text-slate-500/40" /><p className="font-bold text-sm text-slate-800 mb-1 pr-4">{cat}</p><p className="text-xs text-slate-500">{items.length} item{items.length === 1 ? "" : "s"}</p>
            </button>
          ))}
        </div>
      )}
      {uploadModal}
    </div>
  );
}

function JourneyTab({ fredoka, stageIndex }) {
  return (
    <div className="max-w-md mx-auto px-5 pt-6">
      <h2 style={fredoka} className="text-xl font-semibold text-slate-800 mb-1">Your journey</h2>
      <p className="text-sm text-slate-500 mb-6">An EHCP is years of reviews, not a one-off form.</p>
      <div className="space-y-0">
        {STAGES.map((s, i) => {
          const done = i < stageIndex; const current = i === stageIndex;
          return (
            <div key={s.title} className="flex gap-3">
              <div className="flex flex-col items-center">
                <div className={`w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0 ${current ? "bg-orange-500" : done ? "bg-emerald-400" : "bg-stone-200"}`}>{done ? <CheckCircle2 size={15} className="text-white" /> : <span className="text-white text-xs font-bold">{i + 1}</span>}</div>
                {i < STAGES.length - 1 && <div className={`w-0.5 flex-1 min-h-[28px] ${done ? "bg-emerald-300" : "bg-stone-200"}`} />}
              </div>
              <div className={`pb-6 ${current ? "" : "opacity-70"}`}><p className={`font-bold text-sm ${current ? "text-orange-600" : "text-slate-700"}`}>{s.title}</p><p className="text-xs text-slate-400 mt-0.5">{s.blurb}</p></div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function GuideTab({ fredoka, onBack }) {
  const Section = ({ title, children }) => (
    <div className="mb-6">
      <h3 style={fredoka} className="text-base font-semibold text-slate-800 mb-2">{title}</h3>
      <div className="space-y-2">{children}</div>
    </div>
  );
  const Term = ({ b, children }) => (
    <div className="bg-white border border-stone-200 rounded-2xl p-3.5">
      <p className="text-sm text-slate-600"><span className="font-bold text-slate-800">{b}</span> — {children}</p>
    </div>
  );

  return (
    <div className="max-w-md mx-auto px-5 pt-6">
      <button onClick={onBack} className="flex items-center gap-1 text-sm font-bold text-slate-500 mb-4"><ArrowLeft size={16} /> Home</button>
      <h2 style={fredoka} className="text-xl font-semibold text-slate-800 mb-1">EHCP &amp; SEND guide</h2>
      <p className="text-sm text-slate-500 mb-6">Not legal advice — the plain-English version of things that come up again and again, checked against official guidance.</p>

      <Section title="Key terms">
        <Term b="Section F">the legally enforceable part of an EHCP — what the school must actually deliver.</Term>
        <Term b="Section I">where the school is named — a high-stakes, often hard-to-reverse choice.</Term>
        <Term b="EBSA">Emotionally Based School Avoidance — official terminology, taken seriously as a sign something isn't working.</Term>
        <Term b="Masking">coping at school, then falling apart at home — very common, easy for a school to miss.</Term>
        <Term b="Resourced provision">a specialist unit attached to mainstream. It has to be named specifically, not just the school, or the place secured may only be a mainstream one.</Term>
        <Term b="OAP">Ordinarily Available Provision, the support a school gives all children without extra funding. Some schools treat it as a hurdle to clear before an assessment request, though it isn't a fixed legal precondition on its own.</Term>
        <Term b="EOTAS">Education Otherwise Than At School, used when no available placement can meet a child's needs. Often delivered through a personal budget managed via a support organisation.</Term>
      </Section>

      <Section title="Fixed deadlines">
        <Term b="20 weeks">the overall statutory timeline for an EHC needs assessment, start to finish.</Term>
        <Term b="15 February">the phase-transfer EHCP deadline for children in Year 6.</Term>
      </Section>

      <Section title="Myths worth knowing are false">
        <Term b="“Not severe enough”">not how eligibility works.</Term>
        <Term b="“School must try X first”">not a legal requirement before requesting an assessment.</Term>
        <Term b="“Only for certain conditions”">eligibility depends on need, not diagnosis.</Term>
        <Term b="“Rules differ by council”">the same Code of Practice applies across all of England.</Term>
        <Term b="“Must be on the SEN register”">not a legal precondition — though worth confirming with IPSEA or SENDIASS if a council pushes back.</Term>
      </Section>

      <Section title="What counts as evidence">
        <Term b="Specific, not vague">"20 minutes of 1:1 support, 3x a week" holds up. "Extra help" doesn't.</Term>
        <Term b="A provision map">ask the school for one if you can't tell whether agreed support is happening, or if a plan only describes "funding equivalent to hours" rather than a real timetable.</Term>
        <Term b="Attendance & EBSA">valid evidence on their own, even if the school reports no concerns.</Term>
        <Term b="Private reports">if the LA won't put a private OT, SALT, or EP report into Section F, that's a common point of disagreement, worth raising and worth checking with IPSEA or SENDIASS.</Term>
      </Section>

      <Section title="Rights often missed">
        <Term b="LA-commissioned assessments">you can ask the council to commission an EP, OT, or SALT report.</Term>
        <Term b="Right to Choose">an NHS right to request a faster or different provider for a long diagnostic wait.</Term>
        <Term b="Transport issues">raise with the LA's transport team, not the taxi company.</Term>
      </Section>

      <Section title="When to get a real person">
        <Term b="Tribunal, mediation, appeal">worth SENDIASS, IPSEA, or a solicitor.</Term>
        <Term b="Section I decisions">genuinely high-stakes — worth independent advice before finalising.</Term>
        <Term b="Placement collapsing, or badly overdue">ask about an emergency annual review, or a faster "paper hearing" for a tribunal, through SENDIASS or IPSEA.</Term>
      </Section>

      <div className="bg-rose-50 border border-rose-200 rounded-2xl p-4 mb-6">
        <p className="text-sm font-bold text-rose-700 mb-1">Safety at school is different</p>
        <p className="text-sm text-rose-600">Unexplained injuries, physical restraint by staff, or exclusion deserve more than guidance. If a child is in immediate danger, call <span className="font-bold">999</span>. Otherwise: your local authority's Children's Social Care team, or the <span className="font-bold">NSPCC on 0808 800 5000</span>.</p>
      </div>
    </div>
  );
}

function ActionsTab({ fredoka, actions, onToggle }) {
  const groups = [{ key: "due", label: "Due soon" }, { key: "upcoming", label: "Upcoming" }, { key: "done", label: "Completed" }];
  return (
    <div className="max-w-md mx-auto px-5 pt-6">
      <h2 style={fredoka} className="text-xl font-semibold text-slate-800 mb-5">Your actions</h2>
      {actions.length === 0 && <p className="text-sm text-slate-400">Nothing here yet — actions you create from chat will show up here.</p>}
      {groups.map((g) => {
        const items = actions.filter((a) => a.status === g.key);
        if (items.length === 0) return null;
        const s = statusStyles[g.key];
        return (
          <div key={g.key} className="mb-6">
            <p className={`text-xs font-bold uppercase tracking-wide mb-2 ${s.text}`}>{g.label}</p>
            <div className="space-y-2">
              {items.map((a) => (
                <button key={a.id} onClick={() => onToggle(a)} className="w-full text-left bg-white border border-stone-200 rounded-2xl p-4 flex items-center gap-3 hover:shadow-sm transition-shadow">
                  <span className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${s.dot}`} />
                  <div className="flex-1"><p className={`text-sm font-bold ${a.status === "done" ? "text-slate-400 line-through" : "text-slate-800"}`}>{a.title}</p><p className="text-xs text-slate-400">{a.due_date}</p></div>
                </button>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}
