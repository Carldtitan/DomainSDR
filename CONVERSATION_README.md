# DomainSDR Conversation README

This file summarizes the product pivots, implementation decisions, and decision rationale from the DomainSDR build conversation. It is not a secrets file and does not include API keys, webhook secrets, or private account values.

## Original Product Idea

DomainSDR started as a hackathon MVP for turning an owned domain into a targeted sales campaign.

The core hypothesis was:

- Domain sales are illiquid because owners do not know the best end buyers.
- Owners also do not have time to research buyers, write personalized outbound, follow up, negotiate, and track the sale.
- An AI SDR/BDR for owned domains could increase domain-sale liquidity by doing that work carefully and at low volume.

The first scope was a simple full-stack web app with:

- Domain intake.
- Buyer research.
- Outreach review.
- Campaign dashboard.
- Conversation and negotiation view.
- AgentMail email sending and reply handling.
- Apify buyer discovery and enrichment.
- Gemini for analysis, scoring, emails, and reply classification.
- Supermemory for campaign memory.
- Local storage first, then a real database later.

## Early MVP Direction

The first build direction prioritized a working demo over a large production system.

The planned workflow was:

1. User enters a domain and seller rules.
2. The app analyzes likely use cases and buyer categories.
3. The app finds a small list of high-fit buyers.
4. The app scores and ranks those buyers.
5. The app generates concise personalized emails.
6. The user reviews and sends selected emails.
7. AgentMail receives replies.
8. The app classifies replies and generates negotiation responses.
9. The app requests a deposit link when appropriate.
10. The dashboard tracks leads, emails, replies, offers, and deposits.

At this point, the app still looked too much like a SaaS workflow with buttons and pages.

## Demo Data Pivot

The original request included a demo mode with fake leads and buyer simulations for reliability.

That was later reversed.

The product direction changed to:

- Remove demo data from the real product path.
- Use real Apify/web research.
- Route email sends to the controlled inbox `carl@uni.minerva.edu` for hackathon safety.
- Route phone behavior to the controlled number `6284887063`.
- Keep controlled routing as a deployment configuration, not fake buyer data in the app.

The rationale was straightforward: fake data made the demo feel less credible. The product needed to prove it could work on real companies and real contacts, even if outbound was safely routed to controlled destinations.

## Buyer Discovery Pivot

A major failure signal was that `cars.ai` returned no buyers.

That exposed a product risk:

- If discovery fails on an obvious, valuable category domain, the app does not prove the core hypothesis.
- The buyer research could not be random or generic.
- Each lead needed a specific reason the company might value the domain.

The system was pushed toward:

- Apify-backed search and scraping.
- Broader query generation.
- Contact enrichment.
- Public email extraction.
- Contact form extraction.
- Public phone extraction.
- Founder, growth, business, or decision-maker hints where public.
- Fit scoring based on category match, domain weakness, commercial relevance, ability to pay, timing signal, and contactability.

## Contact Enrichment Pivot

The initial buyer discovery could find companies, but contacts were often blank or only guessed with `/contact`.

The product direction changed to require real enrichment:

- Extract public emails from discovered pages.
- Extract contact forms.
- Extract public phone numbers where available.
- Store contact source URLs.
- Prefer relevant decision-makers where public.
- Avoid invented emails and invented people.

The rationale was that outbound is not useful if it cannot reach someone real. Guessing contacts would also create trust and compliance problems.

## AgentMail Reply Matching Pivot

Initial reply matching worked for controlled test threads but was weak for real inbox usage.

The matching model was expanded to consider:

- AgentMail thread id.
- `in_reply_to`.
- Original AgentMail message id.
- Recipient.
- Subject.
- Lead and campaign metadata.
- Reply body identity hints.

The rationale was that a broker agent must not respond to the wrong buyer or wrong campaign. Matching errors are high-risk because they can send incorrect pricing, reveal negotiation context, or mishandle opt-outs.

## Send Confirmation Pivot

Manual sends were made safer with explicit confirmation.

Before any manual AgentMail send, the app shows:

- Recipient.
- Subject.
- Body.
- Campaign.
- Buyer.
- A warning that the send is a real email to the controlled inbox.

The rationale was that manual override is still useful, but real email sends need a deliberate confirmation step.

## Storage Pivot: JSON to Hosted DB

The app started with simple local storage for speed.

That was not enough for a real deployed demo because JSON can corrupt under concurrent writes and does not behave well across serverless instances.

The storage direction changed to:

- Use Neon Postgres when `DATABASE_URL` is present.
- Keep SQLite as a local fallback.
- Keep Supermemory as memory, not the transactional database.

Supermemory is used for:

- Campaign thesis.
- Buyer research.
- Outreach history.
- Buyer objections.
- Negotiation history.
- Portfolio recommendations.
- Workspace snapshots.

Postgres is used for:

- Campaigns.
- Leads.
- Outbound messages.
- Conversation events.
- Negotiation policies.
- Offers.
- Suppression records.
- Webhook and dashboard state.

The rationale was that Supermemory is valuable for agent memory and learning, but the app still needs an exact transactional source of truth.

## Ownership Proof Pivot

The product needed more than payment links and email replies. It needed a clear proof-of-ownership path.

The product direction added ownership proof instructions:

- TXT record verification value.
- Landing page verification text.
- Escrow or trusted marketplace route.

The rationale was that a serious buyer will ask whether the seller actually owns the domain. The agent should answer this safely without making unsupported claims.

## Payments Pivot: Stripe Deposit, Not Domain Transfer

Stripe was added for deposit collection.

Important clarification:

- Stripe only collects a deposit or intent payment.
- Stripe does not transfer the domain.
- Domain transfer should still go through escrow, marketplace transfer, registrar push, or another trusted domain-transfer workflow.

The Stripe implementation includes:

- Checkout Session creation.
- Mock checkout fallback when Stripe is not configured.
- Stripe webhook receiver.
- `checkout.session.completed` handling.
- Offer status update to `deposit_paid`.

The rationale was that collecting a small deposit is useful for serious intent, but the app must not imply that payment itself transfers ownership.

## Vercel and Webhook Pivot

The app was deployed to Vercel and connected to hosted services.

Key deployed behavior:

- Production alias: `https://domainsdr.vercel.app`.
- Stripe webhook: `/api/stripe/webhook`.
- AgentMail webhook: `/api/agentmail/webhook`.
- Agent tick route: `/api/agent/tick`.
- Health route: `/api/health`.
- Neon/Postgres as the hosted database.

The rationale was that a broker agent needs to be reachable by external services. Local polling is not enough for replies and payment events.

## Agentic Pivot

The biggest product critique was that the app still felt like a SaaS dashboard:

- The user had to click "Find Buyers".
- The user had to click "Generate Top 5".
- The user had to decide when to research.
- The user had to decide when to send.
- The user had to keep pushing the workflow forward.

The product direction changed from "workflow tool" to "continuously working broker agent."

The broker should:

- Watch active campaigns.
- Research buyers when lead count is low.
- Draft outreach automatically.
- Send a small capped first-touch batch automatically.
- Poll and receive replies.
- Classify replies.
- Negotiate inside seller rules.
- Send one guarded follow-up when due.
- Suppress opt-outs.
- Escalate serious or sensitive offers.
- Generate proof-of-ownership instructions.
- Track portfolio recommendations.
- Store learning and history in Supermemory.

The rationale was that an SDR does not wait for a manager to press every button. A real broker agent needs a work loop, wake triggers, guardrails, and clear escalation rules.

## Final UI Pivot

The final frustration was that the user still had to press too many buttons.

The app was changed so:

- Creating a campaign launches the broker immediately.
- The user lands on the Broker Console, not the research page.
- The old "Find Buyers" and "Generate Top 5" main path was removed.
- Buyer Pipeline became a visibility screen.
- Draft Queue became a manual override screen.
- Console actions are now "Sync Replies" and "Wake Broker", not required workflow steps.
- Navigation labels changed from SaaS-like labels to clearer operational labels:
  - Launch.
  - Buyers.
  - Drafts.
  - Console.

The rationale was that the primary product should feel like hiring a broker, not operating a CRM.

## Current Product Behavior

As of the latest implementation:

1. The user launches a domain broker from `/`.
2. The backend creates the campaign and analyzes the domain.
3. The backend immediately runs a campaign-scoped broker tick.
4. The broker researches buyers if needed.
5. The broker enriches contacts.
6. The broker drafts outreach.
7. The broker sends a capped first-touch batch when allowed.
8. AgentMail webhooks wake the broker on inbound replies.
9. The broker classifies replies and negotiates within policy.
10. The broker creates a Stripe deposit link when appropriate.
11. The Stripe webhook marks offers as `deposit_paid`.
12. The dashboard updates from Postgres.
13. Supermemory stores research, objections, history, and recommendations.

## Current Guardrails

The broker is intentionally constrained:

- Low-volume only.
- Capped first-touch sends.
- Capped follow-ups.
- One polite follow-up by default.
- Opt-out suppression.
- No claims about traffic or revenue unless provided.
- No trademark safety guarantees.
- No floor price disclosure by default.
- No offers below floor.
- Serious or sensitive negotiations can escalate to the owner.
- Deposit is intent only; actual transfer should use escrow or a marketplace.

## Current Phone Position

AgentPhone is integrated but outbound call autopilot is disabled by default.

The current production health state shows phone services configured, but:

- `callAutopilot` is false.
- `phoneOutboundExternal` is false.

The rationale is compliance and demo safety. Cold calling requires much stricter consent, routing, scripts, throttling, audit logs, and legal review than email. For the hackathon demo, inbound or controlled phone behavior is safer.

## What "Agentic" Means Here

Agentic does not mean uncontrolled mass outbound.

For this product, agentic means:

- The broker has a goal: sell the domain or progress the campaign.
- The broker has tools: research, enrichment, email, reply handling, payments, memory.
- The broker has wake triggers: campaign launch, reply webhook, page heartbeat, cron.
- The broker has policies: price floor, send caps, opt-out handling, proof-of-ownership, escalation.
- The broker can choose the next step without a human pressing every workflow button.
- The broker records what it did and why in the dashboard and memory.

## Wake Model

The broker wakes from:

- Campaign launch.
- AgentMail reply webhook.
- Stripe payment webhook.
- Browser heartbeat while a user has the app open.
- Vercel cron.
- Manual "Wake Broker" override.

Important limitation:

- Vercel Hobby supports limited scheduled frequency, so unattended scheduled wakes are daily in the current setup.
- For hourly or near-real-time unattended work, use Vercel Pro cron, QStash, Trigger.dev, Inngest, or another durable scheduler/queue.

## Sponsor Tool Fit

The strongest sponsor-tool fit is:

- Gemini: reasoning, scoring, email generation, classification, negotiation.
- Apify: buyer discovery, scraping, contact enrichment.
- AgentMail: outbound email and reply webhooks.
- Supermemory: long-term campaign memory and learning.
- AgentPhone: optional inbound or tightly controlled phone broker layer.

Other infrastructure:

- Neon: hosted Postgres source of truth.
- Vercel: hosting, API routes, deployment, cron.
- Stripe: deposit collection and payment webhook state.

## Remaining Product Gaps

The app is much more agentic now, but a production-grade domain broker still needs:

- User authentication and account isolation.
- Owner approval settings per campaign.
- Clear deliverability setup: sender domain, DKIM/SPF/DMARC, warmup, bounce handling.
- Better unsubscribe and suppression management.
- Durable job queue for long-running research and follow-ups.
- More robust scheduler for hourly autonomous work.
- Phone compliance before enabling autonomous outbound calls.
- Marketplace or escrow integration for real domain transfer.
- Registrar ownership verification and transfer status tracking.
- CRM import/export only where needed, not a general CRM.
- Better analytics on response rate by buyer category, email angle, price, and domain type.
- Portfolio-level recommendations for pricing down, relisting, parking, or pausing.
- Monitoring, logs, alerts, and replayable webhook processing.

## Product-Market Fit Notes

The product is strongest if it stays focused on domain owners who have valuable but illiquid domains and do not want to run outbound themselves.

The sharp wedge is:

- "Give me a domain and seller rules. I will find likely end buyers, contact them carefully, negotiate inside your limits, and bring serious offers back."

The product is weaker if it becomes:

- A generic CRM.
- A mass cold-email platform.
- A fake buyer demo.
- A domain marketplace without transfer infrastructure.
- A tool where the owner still clicks through every step.

## Integration and Partnership Opportunities

The app should avoid reinventing:

- Escrow: integrate Escrow.com or a domain marketplace checkout path.
- Transfer: integrate with registrars or marketplace transfer flows.
- Email deliverability: integrate a sender-domain onboarding provider or transactional/cold email compliance tooling.
- Enrichment: continue using Apify and potentially add Clearbit/Apollo-style enrichment if available and compliant.
- Scheduling and workflow durability: use a durable queue/workflow service instead of relying only on serverless requests.

## Latest Production State

Latest production deployment:

- Production URL: `https://domainsdr.vercel.app`
- Latest pushed commit at the time of this file: `68300ef Make campaign launch broker autonomously`
- Production health after that deploy showed:
  - Gemini configured.
  - Apify configured.
  - AgentMail configured.
  - AgentPhone configured.
  - Supermemory configured.
  - Stripe configured.
  - Stripe webhook configured.
  - AgentMail webhook configured.
  - Storage: Postgres.
  - Research autopilot enabled.
  - First-touch autopilot enabled.
  - Negotiation autopilot enabled.
  - Follow-up autopilot enabled.
  - Call autopilot disabled.

## Summary

The conversation moved DomainSDR from a hackathon SaaS workflow into a broker-agent architecture.

The key shift was this:

- Before: the user operated buttons to research, draft, send, and follow up.
- After: launching a campaign starts a guarded broker loop that works the campaign, wakes on events, follows up on timing, handles replies, and escalates when needed.

That is the correct direction for the product. The next major step is durable always-on execution: hourly scheduling, queues, better observability, and safe phone/escrow integrations.
