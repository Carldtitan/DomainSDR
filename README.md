# DomainSDR

DomainSDR is an agentic domain broker MVP. It turns one owned domain into a low-volume buyer campaign, finds likely end buyers, drafts and sends careful outreach, polls replies, negotiates inside seller rules, requests deposits, and records campaign memory.

## What Runs

- Next.js App Router frontend and API routes.
- SQLite local store at `.data/domain-sdr.sqlite`.
- Gemini for domain analysis, scoring, email generation, reply classification, and follow-ups.
- Apify for buyer discovery and contact enrichment.
- AgentMail for email send/reply handling.
- AgentPhone for guarded outbound calls and phone/SMS webhooks.
- Supermemory for cross-campaign memory, learning, and workspace snapshots.
- Stripe Checkout when `STRIPE_SECRET_KEY` is present; otherwise local mock checkout links.

## Agent Loop

The broker loop is `POST /api/agent/tick`.

Each tick:

1. Polls AgentMail replies.
2. Reconciles buyer identity from reply text and thread metadata.
3. Drafts top outreach for leads that do not have a message yet.
4. Advances unanswered inbound replies with a guarded negotiation response.
5. Creates deposit links when a buyer asks how to buy or makes an acceptable offer.
6. Sends one guarded follow-up to leads with no reply after the configured delay.
7. Writes recommendations and a workspace snapshot to Supermemory.

The app also runs a lightweight heartbeat every minute while a page is open, and `vercel.json` schedules `/api/agent/tick` hourly.

## Required Environment

```bash
GEMINI_API_KEY=
APIFY_TOKEN=
AGENTMAIL_API_KEY=
AGENTMAIL_INBOX_ID=
SUPERMEMORY_API_KEY=

# Controlled routing for hackathon demos
CONTACT_OVERRIDE_EMAIL=carl@uni.minerva.edu
CONTACT_OVERRIDE_PHONE=6284887063

# Public deployed base URL for deposit links and webhooks
APP_BASE_URL=https://your-domain.example
```

## Optional Environment

```bash
STRIPE_SECRET_KEY=

AGENTPHONE_API_KEY=
AGENTPHONE_AGENT_ID=
AGENTPHONE_WEBHOOK_SECRET=
ALLOW_EXTERNAL_PHONE_OUTBOUND=false

AGENT_AUTOPILOT_NEGOTIATION_REPLIES=true
AGENT_AUTOPILOT_FOLLOWUPS=true
AGENT_FOLLOWUP_MIN_HOURS=72
AGENT_FOLLOWUP_MAX_SENDS_PER_TICK=3
AGENT_FOLLOWUP_MAX_DAILY_SENDS=5
AGENT_NEGOTIATION_MAX_SENDS_PER_TICK=5
AGENT_NEGOTIATION_MAX_DAILY_SENDS=20
AGENT_MAX_DRAFTS_PER_TICK=5
```

## Supermemory vs Database

Supermemory is used as agent memory, not as the primary transactional database. It stores research, buyer objections, outreach history, negotiation turns, recommendations, and a workspace snapshot. The app still needs a real transactional store for campaigns, leads, offers, suppression, idempotency, and exact dashboard state.

For production, replace the local SQLite layer with hosted Postgres/Neon or another transactional DB. Keep Supermemory as the agent memory and retrieval layer.

## Key Routes

- `/` domain intake
- `/campaign/:id/research` buyer research
- `/campaign/:id/outreach` email review/send
- `/campaign/:id/dashboard` campaign dashboard
- `/campaign/:id/conversation/:leadId` negotiation thread
- `/api/agent/tick` broker work loop
- `/api/agentphone/call` guarded AgentPhone outbound call
- `/api/agentphone/webhook` AgentPhone webhook receiver
- `/api/health` service/config health check

## Development

```bash
npm install
npm run dev
npm run lint
npm run build
```
