import { loadStore, storageBackend } from "@/lib/campaignStore";

function flag(name: string) {
  return Boolean(process.env[name]);
}

export async function GET() {
  const store = await loadStore();
  return Response.json({
    ok: true,
    services: {
      gemini: flag("GEMINI_API_KEY"),
      apify: flag("APIFY_TOKEN"),
      agentMail: flag("AGENTMAIL_API_KEY") && flag("AGENTMAIL_INBOX_ID"),
      agentPhone: flag("AGENTPHONE_API_KEY"),
      ownerSms: flag("AGENTPHONE_API_KEY"),
      browserUse: flag("BROWSER_USE_API_KEY"),
      supermemory: flag("SUPERMEMORY_API_KEY"),
      stripe: flag("STRIPE_SECRET_KEY"),
      stripeWebhook: flag("STRIPE_WEBHOOK_SECRET"),
      agentMailWebhook: flag("AGENTMAIL_WEBHOOK_SECRET"),
    },
    storage: storageBackend(),
    data: {
      campaigns: store.campaigns.length,
      leads: store.buyerLeads.length,
      messages: store.outboundMessages.length,
      events: store.conversationEvents.length,
      offers: store.offers.length,
    },
    agent: {
      negotiationAutopilot: process.env.AGENT_AUTOPILOT_NEGOTIATION_REPLIES !== "false",
      followUpAutopilot: process.env.AGENT_AUTOPILOT_FOLLOWUPS !== "false",
      researchAutopilot: process.env.AGENT_AUTOPILOT_RESEARCH !== "false",
      firstTouchAutopilot: process.env.AGENT_AUTOPILOT_FIRST_TOUCH_EMAILS !== "false",
      callAutopilot: process.env.AGENT_AUTOPILOT_CALLS === "true",
      phoneOutboundExternal: process.env.ALLOW_EXTERNAL_PHONE_OUTBOUND === "true",
      browserUseContactFallback: process.env.ALLOW_BROWSER_USE_CONTACT_FALLBACK !== "false",
    },
  });
}
