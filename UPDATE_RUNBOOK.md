# Everside security update: run order

Time needed: about 60 minutes. Do staging first if you have a second Supabase project (free tier is fine). If you do not, do the same steps on production but take the backup in step 1.

## 0. Today, 2 minutes
In the Anthropic console, set a monthly spend limit on the API key. This is the single most useful protection until the new chat function is live. `PLANS_AND_LIMITS.md` suggests a figure (section 7); $50 a month is plenty at launch.

## 1. Look and back up (Supabase dashboard)
1. Database, Backups: confirm a recent backup exists (or Database, Backups, Create backup if your plan allows).
2. SQL Editor: paste `00_check_current_state.sql`, run it, and save the results. It changes nothing. Send me the output if anything looks odd, especially the last query (it shows which tables delete their rows when a user is deleted).

## 2. Run part 1
SQL Editor: paste all of `01_security_fixes_part1.sql` and run. It also creates the feedback table, the billing columns and the Stripe webhook table if your project never ran the older "update 4" schema file, and it stops with a plain message if a core table such as `children` is missing. It is safe to run before the new app is live and safe to run twice. Then run `03_verify_after.sql`. The first rows must say OK, including the check that `plan_limits` holds three plans. The profile lock rows will say FAIL until step 5. That is expected.

This part also creates the plan and usage tables (`plan_limits`, `ai_usage`) and the functions that count questions and document reads. The allowances are in `plan_limits`; read `PLANS_AND_LIMITS.md` and change any number you disagree with before real families use it.

## 3. Stripe and Cloudflare setup
**In Stripe** (use test mode first):
1. Create two products, Guided and Full Support. Give each two recurring prices: one monthly and one yearly. That is four prices. Copy each price id (starts with `price_`).
2. Developers, Webhooks: the endpoint is `https://YOUR-APP-DOMAIN/api/stripe-webhook`. It must receive at least `checkout.session.completed`, `customer.subscription.created`, `customer.subscription.updated` and `customer.subscription.deleted`.
3. Settings, Billing, Customer portal: create a configuration with **cancellation switched off** and payment method updates and invoice history switched on. Copy its id (starts with `bpc_`). This makes the in-app cancel flow the only way to cancel, so the feedback question and the data choice cannot be skipped.

**In Cloudflare** (app project, Settings, Variables and Secrets; mark the secret ones Encrypted):
* `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` (encrypted, server only)
* `ANTHROPIC_API_KEY` (already there)
* `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` (already there)
* `STRIPE_PRICE_GUIDED_MONTHLY`, `STRIPE_PRICE_GUIDED_ANNUAL`, `STRIPE_PRICE_FULL_SUPPORT_MONTHLY`, `STRIPE_PRICE_FULL_SUPPORT_ANNUAL` (these replace the old `STRIPE_PRICE_GUIDED` and `STRIPE_PRICE_FULL_SUPPORT`)
* `STRIPE_PORTAL_CONFIGURATION` (the `bpc_` id above)
* `CRON_SECRET`: a long random string you make up (30 or more characters). Keep a copy for step 7.
* `APP_URL`: your app address, for example `https://app.ever-side.co.uk`
* `RESEND_API_KEY` and `MAIL_FROM` (for example `Everside <hello@ever-side.co.uk>`): needed to send the 30 day and 7 day deletion warnings. Create a free Resend account and verify your sending domain. The warnings cannot be sent without them, and the daily job will keep retrying until they are set. The first deletion cannot happen until 6 months after the first plan ends, so you have time.

## 4. Deploy the new app
Upload the contents of `everside-app-secured` as your app build (same way you deployed before: build with `npm install` then `npm run build`, with your two `VITE_SUPABASE_*` variables set, and the `functions` folder at the project root). Then, on the deployed app:
* Sign in with a test email. You should reach the app normally.
* Send a Navigator message. It should answer.
* Open the Vault and upload a photo of a letter, then a short PDF. The suggested folder and title should appear.
* Look at the line under the Navigator box: it should say how many questions and document reads are left. It should drop by one after each message.
* Ask the Navigator something unrelated (a recipe, say). It should politely decline, and the count should not go down.
* Attach a PDF to a message. It should read it and use up one document read.
If the Navigator says it is unavailable, check the Cloudflare function logs and the variables in step 3.

## 5. Run part 2
Only when step 4 works: paste `02_lock_down_profiles_part2.sql` and run. Run `03_verify_after.sql` again: every row must say OK. Reload the app and sign in again to confirm it still loads. If the app now fails to load a profile, the old app is still deployed: redeploy the new one. (To undo part 2: `grant select, insert, update on public.profiles to authenticated;`)

## 6. Test billing in Stripe test mode
Use card 4242 4242 4242 4242. Check: (a) subscribing monthly and yearly each lands the right plan name and billing period in Privacy and security; (b) Cancel plan asks why, then the data choice; (c) choosing Keep ends the plan at the period end and shows the dates; (d) choosing zip and delete downloads a zip you can open, then removes the account; (e) in Supabase, `cancellation_feedback` has your answers and `profiles.data_delete_after` is set about 6 months after a plan really ends.

## 7. Switch on the daily clean up
Supabase: Database, Extensions, enable `pg_cron` and `pg_net`. Edit `04_schedule_deletion.sql`: put in your app address and the same `CRON_SECRET`, then run it. Next morning, `select * from cron.job_run_details order by start_time desc limit 5;` should show a successful run. You can also test it by hand: `curl -X POST https://YOUR-APP-DOMAIN/api/purge-expired -H "x-cron-secret: YOUR-SECRET"` returns counts such as `{"deleted":0,"failed":0,"warned_30":0,"warned_7":0}`.

## 8. Supabase dashboard settings (no SQL)
* Authentication, URL Configuration: Site URL is your real app address. Redirect URLs contain only real app addresses, no wildcards and no localhost.
* Authentication, Emails or Providers: set up custom SMTP (Resend, Postmark or similar) so sign in emails arrive and look trustworthy.
* Authentication, Rate limits and email OTP expiry: expiry 3600 seconds or less.
* Dashboard, Advisors (Security): open it and send me anything it flags.
* Turn on multi factor sign in for your own Supabase, Cloudflare, Stripe and Anthropic accounts.

## 9. Website
Upload `site-deploy-v3.zip` to the marketing Pages project as before. Then check headers with `curl -I https://www.ever-side.co.uk` and open the home page, the three tools and the video. Watch the browser console for "Content Security Policy" report messages for a week before turning the policy from Report Only into enforced.

## 10. Test the topic guard and as an attacker (20 minutes)
Run `everside-app-secured/tools/scope-test` (its README explains the setup). It sends 19 on topic, safety and off topic messages, including a recipe photo and an unrelated PDF, to your deployed Navigator.

### Test as an attacker
Make two test accounts and run TEST_PLAN.md sections 1 to 3 and 5 from the audit pack. I ran the equivalent against a copy of your schema in a test database, and results are in the summary below.

### What I tested here (local Postgres with Supabase style roles, your four schema files loaded)
* Before: a normal user could set their own subscription to active (confirmed). After part 2: permission denied.
* Before: anyone with the public key could query the webhook table. After: permission denied for anon and signed in users.
* After: passcode hash cannot be read; `select *` on profiles fails (so the app must use explicit columns, which the new app does).
* After: passcode locks for 15 minutes after 5 wrong attempts, even if the right code is then entered; non digit passcodes rejected.
* After: user B cannot see or change user A's child, cannot move a row to A, cannot attach a vault item to A's child, cannot write consent for A.
* Part 1 ran twice without error; part 2 ran after it without error.
* New user flow (set passcode, then save address and local authority) works for a signed in user.
* Billing and deletion (local Postgres): new billing columns and the private feedback table; parents cannot change their own plan, billing period or deletion date, or read or write feedback; bad reasons, long comments and bad billing periods are rejected; feedback can be unlinked from a deleted user.
* Billing and deletion functions (57 checks with Stripe and Supabase stand ins): each of the four prices is charged for the right plan and period and the browser cannot choose its own; cancel keeps data (plan ends at the period end) or exports and deletes (billing stops first, then files, rows, profile and sign in go, feedback is unlinked); a Stripe failure deletes nothing; the webhook records plan and period, starts the 6 month clock when a plan ends and clears it on renewal; the daily job deletes lapsed accounts past their date and accounts with no plan unused for 6 months, never touches paying, trialing or past due accounts, sends each warning once (a different message for unused accounts), skips renewed accounts, retries when email is not set up, and carries on past one failure. In the database: a parent can only refresh their own last opened time, anonymous callers cannot, and a warning for an ended plan is not cleared by signing in.
* Billing screens in a browser (30 checks): monthly and yearly choice, the cancel questions, both data choices and the 6 month wording, the zip contents (documents by child and folder, data file, README, missing file handling), delete locked until the zip is made and acknowledged.
* Plans and usage (local Postgres): free taster lifetime cap, Guided and Full Support monthly caps, daily cap, separate document read cap, file size and PDF page limits, refunds when the AI fails or a question is off topic, lapsed subscriptions fall back to the free taster, and ordinary users cannot call the counting functions.
* Chat function with a mocked upstream (25 checks): no token gives 401; a bad role, file type or oversized message gives 400; model and token limits ignored; history trimmed to 20; only the newest message keeps its file; fake files (wrong first bytes) refused; each limit gives 429 with a plain explanation; an `OFF_TOPIC` reply is swapped for a polite refusal and the allowance is given back.
* The app in a browser: usage meter, limit state with disabled box, free taster, PDF attach chip.
* The app builds cleanly.
Not tested here: real Stripe checkout and webhooks, the pg_cron schedule, real Resend emails, whether the real model reliably calls off topic requests (that is what the scope test is for), your real Supabase project, real Stripe, real Anthropic calls, the deployed Cloudflare environment, delete-account against real storage. Test those on staging with a synthetic account.

## Known gaps after this update
* Terms section 8 and the privacy page now describe the cancel choices, the 6 month deletion and no refund when someone asks for immediate deletion. These are legal documents: have them checked before you take payment. I have not decided the refund policy for you.
* Free accounts unused for 6 months are deleted automatically, with warning emails. Check the wording on the privacy page and FAQ suits you, and note that the app now records when it was last opened.
* The 4 digit passcode is still stored briefly in the browser between pressing Continue and clicking the email link (changing that needs a screen redesign; I can do it next). It is also still only a screen lock.
* The staff console `everside-console.jsx` calls the Navigator without signing in, so it will now be refused. It is a prototype; do not deploy it.
* The website FAQ and pricing page now describe the allowances and whole account deletion. They are in `site-deploy-v3`. The site is still a waitlist and describes the product at launch, so it is fine to upload now.
* The numbers in the app's plan descriptions (`SUBSCRIPTION_TIERS` in `src/App.jsx`) and on `pricing.html` are typed by hand. If you change `plan_limits`, change those too. The meter inside the app always reads the database.
* The off topic guard is an instruction to the model, checked on the server. It is reliable for clear cases but not a guarantee. The daily strike limit and the monthly allowances are the backstop.
* Privacy policy placeholders (legal entity, privacy email, ICO number) still need filling.
