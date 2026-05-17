import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import path from "node:path";
import type {
  AppStore,
  BuyerLead,
  ConversationEvent,
  DomainAnalysis,
  DomainCampaign,
  FullCampaign,
  NegotiationPolicy,
  Offer,
  OutboundMessage,
  SuppressionRecord,
} from "@/lib/types";
import { normalizeDomain } from "@/lib/format";

const storeDir = path.join(process.cwd(), ".data");
const dbPath = path.join(storeDir, "domain-sdr.sqlite");

let db: Database.Database | null = null;
let writeQueue = Promise.resolve();

function ensureColumn(database: Database.Database, table: string, column: string, ddl: string) {
  const columns = database.prepare(`pragma table_info(${table})`).all() as { name: string }[];
  if (!columns.some((item) => item.name === column)) {
    database.exec(`alter table ${table} add column ${ddl}`);
  }
}

function getDb() {
  if (!db) {
    mkdirSync(storeDir, { recursive: true });
    db = new Database(dbPath);
    db.pragma("journal_mode = WAL");
    db.pragma("foreign_keys = ON");
    db.exec(`
      create table if not exists campaigns (
        id text primary key,
        created_at text not null,
        updated_at text not null,
        data text not null
      );

      create table if not exists buyer_leads (
        id text primary key,
        campaign_id text not null,
        company_name text not null,
        website text not null,
        contact_email text,
        status text not null,
        fit_score integer not null,
        created_at text not null,
        updated_at text not null,
        data text not null
      );

      create table if not exists outbound_messages (
        id text primary key,
        campaign_id text not null,
        buyer_lead_id text not null,
        status text not null,
        to_email text,
        agentmail_message_id text,
        agentmail_thread_id text,
        sent_at text,
        created_at text not null,
        updated_at text not null,
        data text not null
      );

      create table if not exists conversation_events (
        id text primary key,
        campaign_id text not null,
        buyer_lead_id text not null,
        direction text not null,
        channel text not null,
        classification text not null,
        offer_amount real,
        agentmail_message_id text,
        agentmail_thread_id text,
        created_at text not null,
        data text not null
      );

      create table if not exists negotiation_policies (
        campaign_id text primary key,
        data text not null
      );

      create table if not exists offers (
        id text primary key,
        campaign_id text not null,
        buyer_lead_id text not null,
        amount real not null,
        status text not null,
        created_at text not null,
        updated_at text not null,
        data text not null
      );

      create table if not exists suppressions (
        id text primary key,
        campaign_id text not null,
        buyer_lead_id text,
        email text,
        created_at text not null,
        data text not null
      );

      create table if not exists processed_agentmail_messages (
        message_id text primary key
      );

      create index if not exists idx_buyer_leads_campaign on buyer_leads(campaign_id);
      create index if not exists idx_outbound_campaign on outbound_messages(campaign_id);
      create index if not exists idx_outbound_agentmail_message on outbound_messages(agentmail_message_id);
      create index if not exists idx_outbound_agentmail_thread on outbound_messages(agentmail_thread_id);
      create index if not exists idx_events_campaign on conversation_events(campaign_id);
      create index if not exists idx_events_agentmail_message on conversation_events(agentmail_message_id);
      create index if not exists idx_suppressions_email on suppressions(email);
    `);
    ensureColumn(db, "conversation_events", "agentmail_thread_id", "agentmail_thread_id text");
    db.exec("create index if not exists idx_events_agentmail_thread on conversation_events(agentmail_thread_id);");
  }
  return db;
}

function parseRows<T>(table: string) {
  return getDb()
    .prepare(`select data from ${table}`)
    .all()
    .map((row) => JSON.parse((row as { data: string }).data) as T);
}

export function newId(prefix: string) {
  return `${prefix}_${crypto.randomUUID().slice(0, 8)}`;
}

export async function loadStore(): Promise<AppStore> {
  return {
    campaigns: parseRows<DomainCampaign>("campaigns"),
    buyerLeads: parseRows<BuyerLead>("buyer_leads"),
    outboundMessages: parseRows<OutboundMessage>("outbound_messages"),
    conversationEvents: parseRows<ConversationEvent>("conversation_events"),
    negotiationPolicies: parseRows<NegotiationPolicy>("negotiation_policies"),
    offers: parseRows<Offer>("offers"),
    suppressions: parseRows<SuppressionRecord>("suppressions"),
    processedAgentmailMessageIds: getDb()
      .prepare("select message_id from processed_agentmail_messages")
      .all()
      .map((row) => (row as { message_id: string }).message_id),
  };
}

const replaceStoreTx = () =>
  getDb().transaction((store: AppStore) => {
    const database = getDb();
    database.exec(`
      delete from campaigns;
      delete from buyer_leads;
      delete from outbound_messages;
      delete from conversation_events;
      delete from negotiation_policies;
      delete from offers;
      delete from suppressions;
      delete from processed_agentmail_messages;
    `);

    const insertCampaign = database.prepare(
      "insert into campaigns (id, created_at, updated_at, data) values (@id, @created_at, @updated_at, @data)",
    );
    const insertLead = database.prepare(`
      insert into buyer_leads
      (id, campaign_id, company_name, website, contact_email, status, fit_score, created_at, updated_at, data)
      values (@id, @campaign_id, @company_name, @website, @contact_email, @status, @fit_score, @created_at, @updated_at, @data)
    `);
    const insertMessage = database.prepare(`
      insert into outbound_messages
      (id, campaign_id, buyer_lead_id, status, to_email, agentmail_message_id, agentmail_thread_id, sent_at, created_at, updated_at, data)
      values (@id, @campaign_id, @buyer_lead_id, @status, @to_email, @agentmail_message_id, @agentmail_thread_id, @sent_at, @created_at, @updated_at, @data)
    `);
    const insertEvent = database.prepare(`
      insert into conversation_events
      (id, campaign_id, buyer_lead_id, direction, channel, classification, offer_amount, agentmail_message_id, agentmail_thread_id, created_at, data)
      values (@id, @campaign_id, @buyer_lead_id, @direction, @channel, @classification, @offer_amount, @agentmail_message_id, @agentmail_thread_id, @created_at, @data)
    `);
    const insertPolicy = database.prepare("insert into negotiation_policies (campaign_id, data) values (@campaign_id, @data)");
    const insertOffer = database.prepare(`
      insert into offers
      (id, campaign_id, buyer_lead_id, amount, status, created_at, updated_at, data)
      values (@id, @campaign_id, @buyer_lead_id, @amount, @status, @created_at, @updated_at, @data)
    `);
    const insertSuppression = database.prepare(`
      insert into suppressions
      (id, campaign_id, buyer_lead_id, email, created_at, data)
      values (@id, @campaign_id, @buyer_lead_id, @email, @created_at, @data)
    `);
    const insertProcessed = database.prepare("insert into processed_agentmail_messages (message_id) values (?)");

    for (const item of store.campaigns) {
      insertCampaign.run({ ...item, data: JSON.stringify(item) });
    }
    for (const item of store.buyerLeads) {
      insertLead.run({
        ...item,
        contact_email: item.contact_email || null,
        data: JSON.stringify(item),
      });
    }
    for (const item of store.outboundMessages) {
      insertMessage.run({
        ...item,
        to_email: item.to_email || null,
        agentmail_message_id: item.agentmail_message_id || null,
        agentmail_thread_id: item.agentmail_thread_id || null,
        sent_at: item.sent_at || null,
        data: JSON.stringify(item),
      });
    }
    for (const item of store.conversationEvents) {
      insertEvent.run({
        ...item,
        offer_amount: item.offer_amount ?? null,
        agentmail_message_id: item.agentmail_message_id || null,
        agentmail_thread_id: item.agentmail_thread_id || null,
        data: JSON.stringify(item),
      });
    }
    for (const item of store.negotiationPolicies) {
      insertPolicy.run({ campaign_id: item.campaign_id, data: JSON.stringify(item) });
    }
    for (const item of store.offers) {
      insertOffer.run({ ...item, data: JSON.stringify(item) });
    }
    for (const item of store.suppressions) {
      insertSuppression.run({
        ...item,
        buyer_lead_id: item.buyer_lead_id || null,
        email: item.email || null,
        data: JSON.stringify(item),
      });
    }
    for (const messageId of store.processedAgentmailMessageIds) {
      insertProcessed.run(messageId);
    }
  });

async function saveStore(store: AppStore) {
  replaceStoreTx()(store);
}

export async function mutateStore<T>(mutator: (store: AppStore) => T | Promise<T>) {
  const run = async () => {
    const store = await loadStore();
    const result = await mutator(store);
    await saveStore(store);
    return result;
  };

  const next = writeQueue.then(run, run);
  writeQueue = next.then(
    () => undefined,
    () => undefined,
  );
  return next;
}

export async function listCampaigns() {
  const store = await loadStore();
  return [...store.campaigns].sort((a, b) => b.created_at.localeCompare(a.created_at));
}

export async function getCampaign(id: string) {
  const store = await loadStore();
  return store.campaigns.find((campaign) => campaign.id === id);
}

export async function getFullCampaign(id: string): Promise<FullCampaign | undefined> {
  const store = await loadStore();
  const campaign = store.campaigns.find((item) => item.id === id);
  if (!campaign) return undefined;

  return {
    campaign,
    policy: store.negotiationPolicies.find((policy) => policy.campaign_id === id),
    leads: store.buyerLeads
      .filter((lead) => lead.campaign_id === id)
      .sort((a, b) => b.fit_score - a.fit_score),
    messages: store.outboundMessages
      .filter((message) => message.campaign_id === id)
      .sort((a, b) => b.created_at.localeCompare(a.created_at)),
    events: store.conversationEvents
      .filter((event) => event.campaign_id === id)
      .sort((a, b) => a.created_at.localeCompare(b.created_at)),
    offers: store.offers.filter((offer) => offer.campaign_id === id),
  };
}

export type CampaignInput = {
  domain: string;
  owner_name: string;
  owner_email: string;
  ask_price: number;
  floor_price: number;
  deposit_amount: number;
  can_negotiate: boolean;
  can_offer_payment_plan: boolean;
  can_offer_lease_to_own: boolean;
  use_case_thesis: string;
  tone: string;
};

export async function createCampaign(input: CampaignInput, analysis?: DomainAnalysis) {
  const now = new Date().toISOString();
  return mutateStore((store) => {
    const id = newId("camp");
    const campaign: DomainCampaign = {
      id,
      domain: normalizeDomain(input.domain),
      owner_name: input.owner_name.trim() || "Owner",
      owner_email: input.owner_email.trim(),
      ask_price: input.ask_price,
      floor_price: input.floor_price,
      deposit_amount: input.deposit_amount,
      can_negotiate: input.can_negotiate,
      can_offer_payment_plan: input.can_offer_payment_plan,
      can_offer_lease_to_own: input.can_offer_lease_to_own,
      use_case_thesis: input.use_case_thesis.trim(),
      tone: input.tone,
      status: analysis ? "analyzed" : "draft",
      analysis,
      created_at: now,
      updated_at: now,
    };
    const policy: NegotiationPolicy = {
      campaign_id: id,
      ask_price: input.ask_price,
      floor_price: input.floor_price,
      deposit_amount: input.deposit_amount,
      max_discount_percent: input.ask_price > 0 ? Math.round((1 - input.floor_price / input.ask_price) * 100) : 0,
      escalation_threshold: Math.round(input.ask_price * 0.8),
      allow_payment_plan: input.can_offer_payment_plan,
      allow_lease_to_own: input.can_offer_lease_to_own,
      forbidden_claims: [
        "traffic",
        "revenue",
        "existing buyers",
        "trademark safety",
        "guaranteed resale value",
      ],
    };

    store.campaigns.push(campaign);
    store.negotiationPolicies.push(policy);
    return campaign;
  });
}

export async function updateCampaign(id: string, patch: Partial<DomainCampaign>) {
  const now = new Date().toISOString();
  return mutateStore((store) => {
    const campaign = store.campaigns.find((item) => item.id === id);
    if (!campaign) return undefined;
    Object.assign(campaign, patch, { updated_at: now });
    return campaign;
  });
}

export async function upsertLeads(campaignId: string, leads: Omit<BuyerLead, "id" | "campaign_id" | "created_at" | "updated_at">[]) {
  const now = new Date().toISOString();
  return mutateStore((store) => {
    const existing = store.buyerLeads.filter((lead) => lead.campaign_id === campaignId);
    const added: BuyerLead[] = [];

    for (const leadInput of leads) {
      const websiteKey = normalizeDomain(leadInput.website || leadInput.current_domain || leadInput.company_name);
      const duplicate = existing.find(
        (lead) =>
          normalizeDomain(lead.website || lead.current_domain || lead.company_name) === websiteKey ||
          lead.company_name.toLowerCase() === leadInput.company_name.toLowerCase(),
      );

      if (duplicate) {
        Object.assign(duplicate, leadInput, { updated_at: now });
        added.push(duplicate);
        continue;
      }

      const lead: BuyerLead = {
        ...leadInput,
        id: newId("lead"),
        campaign_id: campaignId,
        created_at: now,
        updated_at: now,
      };
      store.buyerLeads.push(lead);
      existing.push(lead);
      added.push(lead);
    }

    const keepIds = new Set(added.map((lead) => lead.id));
    store.buyerLeads = store.buyerLeads.filter((lead) => {
      if (lead.campaign_id !== campaignId || keepIds.has(lead.id)) return true;
      const hasActivity =
        store.outboundMessages.some((message) => message.buyer_lead_id === lead.id) ||
        store.conversationEvents.some((event) => event.buyer_lead_id === lead.id) ||
        store.offers.some((offer) => offer.buyer_lead_id === lead.id);
      return hasActivity;
    });

    const campaign = store.campaigns.find((item) => item.id === campaignId);
    if (campaign) {
      campaign.status = "ready_for_outreach";
      campaign.updated_at = now;
    }

    return added.sort((a, b) => b.fit_score - a.fit_score);
  });
}

export async function updateLead(id: string, patch: Partial<BuyerLead>) {
  const now = new Date().toISOString();
  return mutateStore((store) => {
    const lead = store.buyerLeads.find((item) => item.id === id);
    if (!lead) return undefined;
    Object.assign(lead, patch, { updated_at: now });
    return lead;
  });
}

export async function getLead(id: string) {
  const store = await loadStore();
  return store.buyerLeads.find((lead) => lead.id === id);
}

export async function getCampaignMessages(campaignId: string) {
  const store = await loadStore();
  return store.outboundMessages.filter((message) => message.campaign_id === campaignId);
}

export async function getOutboundMessage(id: string) {
  const store = await loadStore();
  return store.outboundMessages.find((message) => message.id === id);
}

export async function addOrUpdateOutboundMessage(input: Omit<OutboundMessage, "id" | "created_at" | "updated_at">) {
  const now = new Date().toISOString();
  return mutateStore((store) => {
    const existing = store.outboundMessages.find((message) => message.buyer_lead_id === input.buyer_lead_id);
    if (existing) {
      Object.assign(existing, input, { updated_at: now });
      return existing;
    }

    const message: OutboundMessage = {
      ...input,
      id: newId("msg"),
      created_at: now,
      updated_at: now,
    };
    store.outboundMessages.push(message);
    return message;
  });
}

export async function addOutboundMessage(input: Omit<OutboundMessage, "id" | "created_at" | "updated_at">) {
  const now = new Date().toISOString();
  return mutateStore((store) => {
    const message: OutboundMessage = {
      ...input,
      id: newId("msg"),
      created_at: now,
      updated_at: now,
    };
    store.outboundMessages.push(message);
    return message;
  });
}

export async function updateOutboundMessage(id: string, patch: Partial<OutboundMessage>) {
  const now = new Date().toISOString();
  return mutateStore((store) => {
    const message = store.outboundMessages.find((item) => item.id === id);
    if (!message) return undefined;
    Object.assign(message, patch, { updated_at: now });
    return message;
  });
}

export async function addConversationEvent(input: Omit<ConversationEvent, "id" | "created_at">) {
  const now = new Date().toISOString();
  return mutateStore((store) => {
    const event: ConversationEvent = {
      ...input,
      id: newId("evt"),
      created_at: now,
    };
    store.conversationEvents.push(event);
    const lead = store.buyerLeads.find((item) => item.id === input.buyer_lead_id);
    if (lead) {
      lead.status = input.direction === "inbound" ? "replied" : lead.status;
      lead.next_action = input.next_action;
      lead.updated_at = now;
    }
    const campaign = store.campaigns.find((item) => item.id === input.campaign_id);
    if (
      campaign &&
      input.direction === "inbound" &&
      input.classification !== "system_note" &&
      !["deposit_requested", "closed"].includes(campaign.status)
    ) {
      campaign.status = "negotiating";
      campaign.updated_at = now;
    }
    return event;
  });
}

export async function updateConversationEvent(id: string, patch: Partial<ConversationEvent>) {
  return mutateStore((store) => {
    const event = store.conversationEvents.find((item) => item.id === id);
    if (!event) return undefined;
    Object.assign(event, patch);
    return event;
  });
}

export async function getConversationEvent(id: string) {
  const store = await loadStore();
  return store.conversationEvents.find((event) => event.id === id);
}

export async function addSuppression(input: Omit<SuppressionRecord, "id" | "created_at">) {
  const now = new Date().toISOString();
  return mutateStore((store) => {
    const existing = store.suppressions.find(
      (item) =>
        item.campaign_id === input.campaign_id &&
        ((input.buyer_lead_id && item.buyer_lead_id === input.buyer_lead_id) ||
          (input.email && item.email?.toLowerCase() === input.email.toLowerCase())),
    );
    if (existing) return existing;
    const record: SuppressionRecord = { ...input, id: newId("sup"), created_at: now };
    store.suppressions.push(record);
    return record;
  });
}

export async function isSuppressed(campaignId: string, leadId: string, email?: string) {
  const store = await loadStore();
  return store.suppressions.some(
    (item) =>
      item.campaign_id === campaignId &&
      (item.buyer_lead_id === leadId || (email && item.email?.toLowerCase() === email.toLowerCase())),
  );
}

export async function markProcessedAgentmailMessage(messageId: string) {
  return mutateStore((store) => {
    if (!store.processedAgentmailMessageIds.includes(messageId)) {
      store.processedAgentmailMessageIds.push(messageId);
    }
  });
}

export async function hasProcessedAgentmailMessage(messageId: string) {
  const store = await loadStore();
  return store.processedAgentmailMessageIds.includes(messageId);
}

export async function addOffer(input: Omit<Offer, "id" | "created_at" | "updated_at">) {
  const now = new Date().toISOString();
  return mutateStore((store) => {
    const offer: Offer = { ...input, id: newId("offer"), created_at: now, updated_at: now };
    store.offers.push(offer);

    const lead = store.buyerLeads.find((item) => item.id === input.buyer_lead_id);
    if (lead) {
      lead.status = input.status === "deposit_requested" ? "deposit_requested" : "negotiating";
      lead.updated_at = now;
    }

    const campaign = store.campaigns.find((item) => item.id === input.campaign_id);
    if (campaign && input.status === "deposit_requested") {
      campaign.status = "deposit_requested";
      campaign.updated_at = now;
    }
    return offer;
  });
}

export async function getOffer(id: string) {
  const store = await loadStore();
  return store.offers.find((offer) => offer.id === id);
}

export async function updateOffer(id: string, patch: Partial<Offer>) {
  const now = new Date().toISOString();
  return mutateStore((store) => {
    const offer = store.offers.find((item) => item.id === id);
    if (!offer) return undefined;
    Object.assign(offer, patch, { updated_at: now });
    return offer;
  });
}

export async function campaignStats(campaignId: string) {
  const full = await getFullCampaign(campaignId);
  if (!full) return undefined;
  return {
    leadsFound: full.leads.length,
    emailsSent: full.messages.filter((message) => message.status === "sent").length,
    repliesReceived: full.events.filter((event) => event.direction === "inbound").length,
    offersCaptured: full.events.filter((event) => typeof event.offer_amount === "number").length,
    depositsRequested: full.offers.filter((offer) => offer.status === "deposit_requested" || offer.status === "deposit_paid").length,
    depositsPaid: full.offers.filter((offer) => offer.status === "deposit_paid").length,
  };
}
