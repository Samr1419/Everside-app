# Plans, allowances and what they cost

Status: a proposal for you to decide. Nothing here is published as a final price. The pricing page says "Price confirmed at launch" and shows the allowances only.

## 1. The allowances (what the code enforces today)

| | Free taster | Guided | Full Support |
|---|---|---|---|
| Period | once only (lifetime) | resets each calendar month | resets each calendar month |
| Navigator questions | 10 | 120 | 250 |
| Cap per day | 5 | 25 | 40 |
| Document and photo reads | 1 | 20 | 50 |
| Longest PDF | 5 pages | 25 pages | 50 pages |
| Largest file | 4 MB | 5 MB | 5 MB |

Rules that apply to everyone:
* A photo or PDF shared in the chat, or read to suggest a Vault folder, uses one document read. Filing uses a read but not a question.
* A file is sent to the AI only with the message it belongs to. Later messages do not resend it, so one document does not cost again on every turn.
* Questions that are not about SEND and EHCP are refused with a polite message, give the allowance back, and count as a strike. Ten strikes in a day pauses chat until tomorrow. Safety messages are never refused.
* The parent sees what is left inside the app ("96 of 120 messages left this month, 17 of 20 document reads, resets 1 Nov"). It turns amber when low, and the message box explains plainly when an allowance is used up.
* Only an active or trialing subscription with a known plan counts as paid. Anything else is treated as the free taster, so a cancelled or failed payment cannot keep paid allowances.

## 2. What the AI costs (read this with the caveats)

Prices used: Sonnet 5 at $2 per million input tokens, $10 per million output tokens, $0.20 per million for cached input. These come from a third party price tracker, not from Anthropic's own page, so check them in the Anthropic Console before relying on them. Exchange rate assumed: £1 = $1.30. A PDF page is assumed to be about 2,250 tokens.

Per use, in US dollars:
* Typical question: about $0.013 (the child context is cached, answers are a few hundred tokens). Longest possible question: about $0.03.
* Typical document read (5 pages): about $0.035. A 25 page PDF: about $0.12. A 50 page PDF: about $0.31.

Per person per year, in pounds:

| | Typical use (about 30% of allowance) | Heavy (uses all of it, typical length) | Absolute worst (all of it, longest everything) |
|---|---|---|---|
| Guided | £6 | £21 | £56 |
| Full Support | £14 | £46 | £178 (£136 if PDFs are capped at 30 pages) |
| Free taster, one off | about 12p | about 17p | about 33p |

The absolute worst column needs someone to send the longest possible question and a maximum length PDF, every time, all month, every month. It is shown so you know the ceiling, not because it will happen.

## 3. Does £99 a year work for Guided?

Using your idea of £99 a year (about £8.25 a month):
* Stripe fees on a UK card are 1.5% plus 20p, plus 0.7% if you use Stripe Billing for subscriptions, about £2.38 on £99.
* Heavy user: £99 less £1.68 less £21 leaves about £76 before your other costs.
* Absolute worst user: still about £41 left.
* So the price covers the AI cost with a wide margin even if people use it fully. The limits mean it cannot go negative on AI alone.
* Not included above: Supabase and any other fixed costs, your time, refunds, and VAT if you are or become VAT registered (if so, £99 including VAT is about £82.50 to you).

To reach £3,000 a month (£36,000 a year) before costs you would need about 364 Guided subscribers at £99. That is revenue before fees and tax, so plan for more. A mix with some Full Support lowers the number.

## 4. Full Support: a suggestion, not a decision
The pricing page offers a second plan but you have not named its price. At £199 a year (my suggestion, your call):
* Heavy user: about £46 of AI cost, leaving about £148 after Stripe fees.
* Absolute worst: about £178, which leaves about £18. Thin, but positive.
* If you want a bigger cushion, change the longest PDF for Full Support from 50 pages to 30 (one line, see section 6). The worst case drops to about £136.

## 5. Annual billing: points to settle
* Stripe needs an annual recurring price for each plan. Put those price ids in the `STRIPE_PRICE_GUIDED` and `STRIPE_PRICE_FULL_SUPPORT` variables. Allowances still reset monthly, which the code already does, so an annual subscriber cannot use twelve months of allowance in month one.
* You receive the cash upfront but the AI cost arrives monthly. Keep the annual revenue as a reserve for refunds and later months.
* Refund and cooling off wording belongs in `terms.html`. Have it checked by someone qualified before you take payment.
* The pricing page currently shows no period or price. When you confirm, change "Price confirmed at launch" on both cards to the real price and "per year", and update the meta description if you want to mention it.

## 6. How to change a number
1. Edit the row in Supabase (SQL editor):
   `update plan_limits set doc_reads_per_period = 30, max_pdf_pages = 30 where tier = 'full_support';`
   The change is live immediately for everyone on that plan. No deploy is needed.
2. Keep the words in step. The numbers appear in three places that are not read from the database: `SUBSCRIPTION_TIERS` in `src/App.jsx`, the two cards on `pricing.html`, and the FAQ answer about limits (which deliberately gives no numbers, so it needs no change).
3. The usage meter inside the app is read from the database, so it is always right even if the blurbs are late.

## 7. Spend limit at Anthropic (your safety net)
Set the monthly limit in the Console as described earlier. A rule of thumb for what to set:
* Cap = (paying users x $2.30 + new free signups that month x $0.35) x 1.5.
* At launch with few users, $50 a month is plenty. At 100 Guided subscribers and 200 new signups a month, about $450.
* If you hit the cap the Navigator stops for everyone until the next month or until you raise it. The app shows a plain "temporarily unavailable" message, and allowances are given back when the provider fails, so nobody is charged an allowance for a failed answer. Set an email alert at 50% and 80% of the cap.

## 8. What I could and could not check
* Tested: the SQL (limits, daily cap, monthly cap, document reads, refunds, free taster, lapsed subscriptions) on a local Postgres; the server function with simulated sign in, limits, files and refusals; the app's meter, limit messages and file attach in a browser.
* Not tested: the real Anthropic model deciding what is off topic (use `everside-app-secured/tools/scope-test`), the real Supabase and Stripe, and the real token cost of your actual documents. After a week of real use, look at Anthropic's usage page and compare it with section 2. If the real figures are higher, change the numbers in section 6.

## 9. Running costs and break even (added to help you decide the launch price)

### Fixed monthly costs I know about
| Item | Cost | Source or status |
|---|---|---|
| Supabase Pro | $25 a month, about £19 | Supabase pricing page. Includes one project, daily backups for 7 days, 8 GB database, 100 GB files |
| Resend, sign in emails | free up to 3,000 emails a month and 100 a day; $20 a month beyond that | Resend pricing page. Sign in links count as emails |
| Cloudflare Pages and functions | free at your scale | Not re checked; confirm in your dashboard |
| Domain | about £1 a month | My estimate |
| ICO data protection fee | roughly £60 a year | My estimate; check the current band at ico.org.uk. You will be handling children's data, so register |
| Mailchimp (waitlist) | whatever you pay now | Not known |
| Anthropic | variable, see section 2 | Capped by your spend limit |

That is about £25 a month, or £300 a year, before the AI. Not counted: a one off legal review of terms, privacy policy and refund wording, accounting, insurance, and your time. Budget for the legal review before taking payment.

### Fees per payment
Stripe UK: 1.5% plus 20p (UK cards), 2.5% plus 20p (EEA cards), 3.15% plus 20p (international cards), plus 0.7% for Stripe Billing. Annual billing means one fee a year instead of twelve, which is cheaper per customer.

### Guided, annual price options (UK card, after Stripe fees and AI cost)

| Annual price | Left per customer, typical use | Heavy use | Absolute worst | Customers to cover the fixed costs | Customers for £3,000 a month profit (typical to heavy) |
|---|---|---|---|---|---|
| £79 | £71 | £56 | £21 | 5 | 513 to 646 |
| £99 | £90 | £76 | £41 | 4 | 402 to 479 |
| £129 | £120 | £105 | £70 | 3 | 303 to 346 |
| £149 | £139 | £125 | £90 | 3 | 261 to 291 |

### Full Support, annual price options

| Annual price | Typical | Heavy | Worst (50 page PDFs) | Worst (30 page PDFs) |
|---|---|---|---|---|
| £149 | £132 | £99 | loses £32 | £9 |
| £199 | £181 | £148 | £17 | £58 |
| £249 | £229 | £197 | £66 | £107 |

### Monthly instead of annual (Guided)
At £9.99 a month: £120 a year if they stay twelve months, about £94 to £109 left after fees and AI. At £12.99 a month: £156 a year, about £129 to £144 left. Monthly customers can leave sooner, so plan on fewer than twelve payments each. One Stripe price per tier is all the code supports today; selling both monthly and annual means adding a second price id per tier (small change to `tierForPriceId` and the checkout function).

### What the numbers say
* On cost alone every option is safe for Guided. The AI cost is small next to the price at any of them.
* Your income target, not the cost, decides the price. At £99 you need roughly 400 to 480 paying families to reach £3,000 a month profit; at £129 about 300 to 350.
* Full Support at £149 is not safe against a maximum use customer. £199 or more with a 30 page PDF cap is.
* I have not researched competitor prices or what parents will pay. Free help exists (IPSEA, local SENDIASS services), while private advocates and solicitors charge by the hour. Ask the waitlist before you fix the price; a short pricing survey is the cheapest way to find out.
