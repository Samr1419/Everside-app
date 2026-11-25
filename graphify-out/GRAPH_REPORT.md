# Graph Report - everside-app  (2026-11-25)

## Corpus Check
- Corpus is ~27,697 words - fits in a single context window. You may not need a graph.

## Summary
- 323 nodes · 633 edges · 26 communities (17 shown, 9 thin omitted)
- Extraction: 96% EXTRACTED · 4% INFERRED · 0% AMBIGUOUS · INFERRED: 27 edges (avg confidence: 0.85)
- Token cost: 0 input · 0 output

## Community Hubs (Navigation)
- App Shell, Dependencies and Staff Console
- Plans, Pricing and AI Costs
- Stripe Billing and Account API
- Main App Screen
- App Tabs and Settings
- Data Deletion and Purge Job
- Navigator Chat Endpoint and Topic Guard
- Sign Up, Sign In and Vault Lock
- Family Data Layer
- Upgrade, Cancel and Billing Actions
- Stripe Prices and Cloudflare Secrets
- Navigator Chat UI
- Data Export Zip
- Cancel Flow and Security Panel
- On Topic Test Letter
- Conversation Feedback
- Off Topic Test Recipe
- Apple Touch Icon
- PWA Icon 512
- Chat Feedback Modal
- Delete Account
- Security Headers and Marketing Site
- PWA Icon 192
- Supabase Auth Settings

## God Nodes (most connected - your core abstractions)
1. `EversideApp()` - 79 edges
2. `adminHeaders()` - 12 edges
3. `onRequestPost()` - 12 edges
4. `getSupabaseUser()` - 11 edges
5. `handleAuthenticated()` - 11 edges
6. `getProfileByUserId()` - 10 edges
7. `onRequestPost()` - 9 edges
8. `onRequestPost()` - 9 edges
9. `loadChildData()` - 9 edges
10. `Topic guard test (scope-test)` - 9 edges

## Surprising Connections (you probably didn't know these)
- `Off topic guard` --semantically_similar_to--> `SCOPE_GUARD`  [INFERRED] [semantically similar]
  UPDATE_RUNBOOK.md → tools/scope-test/README.md
- `Off topic sample PDF: Garden Landscaping invoice 1042` --conceptually_related_to--> `Topic guard test (scope-test)`  [INFERRED]
  tools/scope-test/samples/offtopic-invoice.pdf → tools/scope-test/README.md
- `On topic sample PDF: EHCP Section F extract` --conceptually_related_to--> `Topic guard test (scope-test)`  [INFERRED]
  tools/scope-test/samples/ontopic-ehcp-extract.pdf → tools/scope-test/README.md
- `Throwaway test account with paid plan and access token` --conceptually_related_to--> `Guided plan`  [EXTRACTED]
  tools/scope-test/README.md → PLANS_AND_LIMITS.md
- `Safety messages never refused (WARN check)` --conceptually_related_to--> `Off topic refusal and strike limit`  [INFERRED]
  tools/scope-test/README.md → PLANS_AND_LIMITS.md

## Import Cycles
- None detected.

## Hyperedges (group relationships)
- **Off topic defence in depth (guard, server check, strikes, allowances)** — tools_scope_test_readme_scope_guard, update_runbook_off_topic_guard, update_runbook_chat_function_checks, plans_and_limits_off_topic_strikes, plans_and_limits_plan_limits_table [EXTRACTED 1.00]
- **Security update SQL run order** — update_runbook_check_current_state_sql, update_runbook_security_fixes_part1_sql, update_runbook_verify_after_sql, update_runbook_lock_down_profiles_part2_sql, update_runbook_schedule_deletion_sql [EXTRACTED 1.00]
- **Account cancellation and deletion lifecycle** — update_runbook_customer_portal_config, update_runbook_cancel_flow, update_runbook_stripe_webhook, update_runbook_six_month_deletion, update_runbook_purge_expired, update_runbook_deletion_warnings [INFERRED 0.85]

## Communities (26 total, 9 thin omitted)

### Community 0 - "App Shell, Dependencies and Staff Console"
Cohesion: 0.06
Nodes (40): index.html app shell, dependencies, jszip@^3.10.1, lucide-react@^0.383.0, react@^18.3.1, react-dom@^18.3.1, @supabase/supabase-js@^2.45.0, devDependencies (+32 more)

### Community 1 - "Plans, Pricing and AI Costs"
Cohesion: 0.05
Nodes (33): AI cost model (Sonnet 5 token pricing), Document and photo reads allowance, Free help alternatives (IPSEA, SENDIASS), Free taster plan, Full Support plan, Guided plan, £3,000 a month income target, plan_limits table (+25 more)

### Community 2 - "Stripe Billing and Account API"
Cohesion: 0.16
Nodes (30): json(), onRequestPost(), REASONS, saveFeedback(), onRequestPost(), onRequestPost(), json(), onRequestPost() (+22 more)

### Community 3 - "Main App Screen"
Cohesion: 0.14
Nodes (20): EversideApp(), cancelVaultUpload(), confirmVaultUpload(), createActionFromChat(), deleteAll(), loadChildData(), removeVaultItem(), saveLastToVault() (+12 more)

### Community 4 - "App Tabs and Settings"
Cohesion: 0.11
Nodes (23): ActionsTab(), ATTACH_TYPES, CANCEL_REASONS, ChatTab(), CONDITION_OPTIONS, ConsentRow(), emptyChild(), emptyParent() (+15 more)

### Community 5 - "Data Deletion and Purge Job"
Cohesion: 0.13
Nodes (17): addMonths(), deletionPlan(), json(), onRequestPost(), PAYING, sameSecret(), warningText(), sendEmail() (+9 more)

### Community 6 - "Navigator Chat Endpoint and Topic Guard"
Cohesion: 0.23
Nodes (15): bad(), cleanBlock(), headBytes(), IMAGE_TYPES, isFile(), json(), looksLike(), onRequestPost() (+7 more)

### Community 7 - "Sign Up, Sign In and Vault Lock"
Cohesion: 0.16
Nodes (12): finishOnboarding(), SignIn(), email(), social(), VaultLockScreen(), checkVaultPasscode(), getCurrentUser(), onAuthStateChange() (+4 more)

### Community 8 - "Family Data Layer"
Cohesion: 0.22
Nodes (10): handleAuthenticated(), setVaultPasscode(), addChild(), addParent(), fetchAiUsage(), fetchChildren(), hasConsents(), recordConsents() (+2 more)

### Community 9 - "Upgrade, Cancel and Billing Actions"
Cohesion: 0.20
Nodes (11): handleCancel(), handleResume(), manageBilling(), refreshProfile(), upgradeToTier(), authHeader(), cancelPlan(), fetchProfile() (+3 more)

### Community 10 - "Stripe Prices and Cloudflare Secrets"
Cohesion: 0.25
Nodes (9): Annual billing, Stripe UK fees, STRIPE_PRICE_GUIDED / STRIPE_PRICE_FULL_SUPPORT, tierForPriceId, Cloudflare variables and secrets, CRON_SECRET, pg_cron and pg_net extensions, 04_schedule_deletion.sql (+1 more)

### Community 11 - "Navigator Chat UI"
Cohesion: 0.25
Nodes (9): attachmentBlock(), buildSystemPrompt(), callClaude(), handleFile(), handleSend(), handleVaultFilePick(), setMessages(), fileToBase64() (+1 more)

### Community 12 - "Data Export Zip"
Cohesion: 0.36
Nodes (8): buildAndSaveZip(), exportData(), exportFamilyData(), fetchParents(), buildExportZip(), downloadBlob(), extOf(), safe()

### Community 13 - "Cancel Flow and Security Panel"
Cohesion: 0.33
Nodes (5): addSixMonths(), CancelFlow(), fmtDate(), SecurityPanel(), Toggle()

### Community 14 - "On Topic Test Letter"
Cohesion: 0.50
Nodes (5): EHC needs assessment, Local Authority SEN Team, On-topic scope-check test sample, Refusal to assess decision letter, SEND Tribunal (right of appeal)

### Community 15 - "Conversation Feedback"
Cohesion: 0.50
Nodes (4): markExchangeHandled(), skipFeedback(), submitFeedback(), submitConversationFeedback()

### Community 16 - "Off Topic Test Recipe"
Cohesion: 1.00
Nodes (3): Chocolate Cake Recipe (off-topic scope test sample), Off-topic document (non SEND/EHCP content), Scope check (SEND/EHCP relevance classifier)

## Ambiguous Edges - Review These
- `Everside-app README` → `index.html app shell`  [AMBIGUOUS]
  README.md · relation: conceptually_related_to

## Knowledge Gaps
- **21 isolated node(s):** `In-app usage meter`, `Stripe UK fees`, `Supabase Pro`, `ICO data protection fee`, `Free help alternatives (IPSEA, SENDIASS)` (+16 more)
  These have ≤1 connection - possible missing edges or undocumented components. (Counts symbols only; 82 node(s) total have ≤1 connection when file, concept and rationale nodes are included.)
- **9 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `SUBSCRIPTION_TIERS (src/App.jsx)` connect `Plans, Pricing and AI Costs` to `App Tabs and Settings`?**
  _High betweenness centrality (0.228) - this node is a cross-community bridge._
- **What connects `In-app usage meter`, `Stripe UK fees`, `Supabase Pro` to the rest of the system?**
  _21 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `App Shell, Dependencies and Staff Console` be split into smaller, more focused modules?**
  _Cohesion score 0.05585106382978723 - nodes in this community are weakly interconnected._
- **Why does `stripe` connect `Stripe Billing and Account API` to `App Shell, Dependencies and Staff Console`?**
  _High betweenness centrality (0.208) - this node is a cross-community bridge._
- **Should `Plans, Pricing and AI Costs` be split into smaller, more focused modules?**
  _Cohesion score 0.0545790934320074 - nodes in this community are weakly interconnected._
- **Should `Main App Screen` be split into smaller, more focused modules?**
  _Cohesion score 0.13666666666666666 - nodes in this community are weakly interconnected._

### Low-confidence Hints
_AMBIGUOUS edges — the extractor was unsure. Verify before acting on these._

- **What is the exact relationship between `Everside-app README` and `index.html app shell`?**
  _Edge tagged AMBIGUOUS (relation: conceptually_related_to) - confidence is low._