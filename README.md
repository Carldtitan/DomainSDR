# DomainSDR

DomainSDR is an agentic domain broker MVP. It turns one owned domain into a low-volume buyer campaign, finds likely end buyers, drafts and sends careful outreach, polls replies, negotiates inside seller rules, requests deposits, and records campaign memory.

## What Runs

- Next.js App Router frontend and API routes.
- Hosted Postgres when `DATABASE_URL` is present, with SQLite fallback at `.data/domain-sdr.sqlite` for local development.
- Gemini for domain analysis, scoring, email generation, reply classification, and follow-ups.
- Apify for buyer discovery and contact enrichment.
- AgentMail for email send/reply handling.
- AgentPhone for guarded outbound calls and phone/SMS webhooks.
- Supermemory for cross-campaign memory, learning, and workspace snapshots.
- Stripe Checkout when `STRIPE_SECRET_KEY` is present; otherwise local mock checkout links.
- Light-first agent UI with dark mode, clear boundaries, and overflow-safe activity logs.

## Broker Loop

Creating a campaign launches the broker immediately for that domain. The same broker loop is available at `POST /api/agent/tick` for scheduled wakes, reply webhooks, and manual overrides.

Each tick:

1. Polls AgentMail replies.
2. Reconciles buyer identity from reply text and thread metadata.
3. Researches and enriches buyers when the campaign needs more leads.
4. Extracts public emails, contact pages, decision-maker hints, and public phone numbers.
5. Drafts top email outreach only for leads with public emails.
6. Calls the controlled phone recipient for leads that have public phone numbers when the live agent run wakes.
7. Advances unanswered inbound replies with a guarded negotiation response.
8. Creates deposit links when a buyer asks how to buy or makes an acceptable offer.
9. Sends one guarded follow-up to leads with no reply after the configured delay.
10. Writes recommendations and a workspace snapshot to Supermemory.

The app also runs a lightweight heartbeat every minute while a page is open. `vercel.json` schedules `/api/agent/tick` daily on Vercel Hobby; use Vercel Pro or an external scheduler for hourly unattended wakes.

## Required Environment

```bash
GEMINI_API_KEY=
APIFY_TOKEN=
ALLOW_APIFY_LIVE_RUN=true
ALLOW_APIFY_CONTACT_ENRICHMENT=true
AGENTMAIL_API_KEY=
AGENTMAIL_INBOX_ID=
AGENTMAIL_WEBHOOK_SECRET=
ALLOW_REAL_EMAIL_SEND=true
SUPERMEMORY_API_KEY=

# Controlled routing for hackathon demos
CONTACT_OVERRIDE_EMAIL=carl@uni.minerva.edu
CONTACT_OVERRIDE_PHONE=6284887063

# Hosted database. Use Neon Postgres on Vercel for production.
DATABASE_URL=

# Public deployed base URL for deposit links and webhooks
APP_BASE_URL=https://your-domain.example
```

## Optional Environment

```bash
STRIPE_SECRET_KEY=
STRIPE_WEBHOOK_SECRET=

AGENTPHONE_API_KEY=
AGENTPHONE_AGENT_ID=
AGENTPHONE_WEBHOOK_SECRET=
ALLOW_EXTERNAL_PHONE_OUTBOUND=false

AGENT_AUTOPILOT_NEGOTIATION_REPLIES=true
AGENT_AUTOPILOT_FOLLOWUPS=true
AGENT_AUTOPILOT_RESEARCH=true
AGENT_AUTOPILOT_FIRST_TOUCH_EMAILS=true
AGENT_AUTOPILOT_CALLS=false
AGENT_RESEARCH_MIN_HOURS=6
AGENT_MIN_LEADS_PER_CAMPAIGN=8
AGENT_FOLLOWUP_MIN_HOURS=72
AGENT_FIRST_TOUCH_MAX_SENDS_PER_TICK=2
AGENT_FOLLOWUP_MAX_SENDS_PER_TICK=3
AGENT_CALL_MAX_PER_TICK=1
AGENT_FOLLOWUP_MAX_DAILY_SENDS=5
AGENT_NEGOTIATION_MAX_SENDS_PER_TICK=5
AGENT_NEGOTIATION_MAX_DAILY_SENDS=20
AGENT_MAX_DRAFTS_PER_TICK=5
```

## Supermemory vs Database

Supermemory is used as agent memory, not as the primary transactional database. It stores research, buyer objections, outreach history, negotiation turns, recommendations, and a workspace snapshot. The app still needs a transactional store for campaigns, leads, offers, suppression, idempotency, and exact agent state.

Production storage is now automatic: set `DATABASE_URL` and the app uses hosted Postgres. Leave `DATABASE_URL` blank and it uses local SQLite.

## Stripe

When `STRIPE_SECRET_KEY` is configured, deposit requests create real Stripe Checkout Sessions. Without Stripe, the app uses the local mock checkout route.

Configure a Stripe webhook for:

```bash
POST https://your-vercel-domain.vercel.app/api/stripe/webhook
```

Required event:

```bash
checkout.session.completed
```

Set the webhook signing secret as `STRIPE_WEBHOOK_SECRET`. The webhook marks the offer as `deposit_paid`, updates the conversation, and stores the payment event in Supermemory.

## Vercel Hosting

Recommended setup:

```bash
npx vercel login
npx vercel link
npx vercel integration add neon
npx vercel env add DATABASE_URL production
npx vercel env add GEMINI_API_KEY production
npx vercel env add APIFY_TOKEN production
npx vercel env add AGENTMAIL_API_KEY production
npx vercel env add AGENTMAIL_INBOX_ID production
npx vercel env add SUPERMEMORY_API_KEY production
npx vercel env add CONTACT_OVERRIDE_EMAIL production
npx vercel env add CONTACT_OVERRIDE_PHONE production
npx vercel env add STRIPE_SECRET_KEY production
npx vercel env add STRIPE_WEBHOOK_SECRET production
npx vercel --prod
```

After deployment, set `APP_BASE_URL` to the production URL and redeploy. The included `vercel.json` schedules `/api/agent/tick` daily so it works on Vercel Hobby. Change the cron back to hourly on Vercel Pro if you want the broker working without the browser open.

## Key Routes

- `/` broker launch
- `/campaign/:id/agent` live broker run
- `/campaign/:id/research` redirects to the live broker run
- `/campaign/:id/outreach` redirects to the live broker run
- `/campaign/:id/dashboard` redirects to the live broker run
- `/campaign/:id/conversation/:leadId` negotiation thread
- `/api/agent/tick` broker work loop
- `/api/agentmail/webhook` realtime AgentMail reply webhook receiver
- `/api/agentphone/call` guarded AgentPhone outbound call
- `/api/agentphone/webhook` AgentPhone webhook receiver
- `/api/stripe/webhook` Stripe Checkout webhook receiver
- `/api/health` service/config health check

## Development

```bash
npm install
npm run dev
npm run lint
npm run build
```

## AgentMail Realtime Replies

Polling still works, but production should use AgentMail webhooks so the broker wakes up as soon as a buyer replies.

Create an AgentMail webhook for:

```bash
POST https://domainsdr.vercel.app/api/agentmail/webhook
```

Event:

```bash
message.received
```

Store the returned signing secret as:

```bash
AGENTMAIL_WEBHOOK_SECRET=whsec_...
```

The webhook processes the inbound reply, classifies it, runs the broker loop, and sends a guarded response when policy allows.
