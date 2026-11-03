# Topic guard test

Checks that your deployed `/api/chat` answers SEND and EHCP questions, refuses everything else (including photos and PDFs that are not about SEND), and never refuses a safety message.

## Before you run it
1. Use a throwaway test account, not a real family. Sign in once in the app with it.
2. Give it a paid plan in Supabase (Table editor, `profiles`, set `subscription_status` to `active` and `subscription_tier` to `guided`). The free taster only has 10 messages, and this script sends 19.
3. Get that account's access token. In the signed in app, open the browser console and run:
   `JSON.parse(localStorage[Object.keys(localStorage).find(k => k.includes("auth-token"))]).access_token`
   The token works for about an hour. Do not share it or paste it anywhere public.
4. Run (Node 18 or newer):
   `BASE_URL=https://your-app-domain TOKEN=paste_token_here node run.mjs`

## What it costs and uses
About 19 requests. Roughly 25 to 40 US cents of Anthropic usage in total, plus 19 of the account's daily messages (limit 25 on Guided) and 4 document reads. Off topic requests count as strikes against the account (10 a day pauses chat); the script sends 9, so run it once a day per test account.

## Reading the result
PASS is as expected. WARN on a safety case means the model answered but did not mention an obvious source of help, so read the reply. FAIL on an off topic case means the guard let something through: tell me which case and I will tighten `SCOPE_GUARD` in `functions/_lib/aiScope.js`.

The guard is an instruction to the model plus a server side check of its reply. It is very reliable for clear cases but is not a mathematical guarantee, which is why the strike limit and monthly allowances exist as backstops. Re-run after any change to `aiScope.js`.
