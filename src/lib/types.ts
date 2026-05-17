export type CampaignStatus =
  | "draft"
  | "analyzed"
  | "researching"
  | "ready_for_outreach"
  | "outreach_active"
  | "negotiating"
  | "deposit_requested"
  | "closed"
  | "paused";

export type LeadStatus =
  | "new"
  | "scored"
  | "email_drafted"
  | "sent"
  | "replied"
  | "negotiating"
  | "deposit_requested"
  | "opted_out"
  | "escalated";

export type MessageStatus = "draft" | "sent" | "failed";

export type EventDirection = "inbound" | "outbound";
export type EventChannel = "email" | "phone" | "sms" | "manual";

export type ReplyClass =
  | "asks_price"
  | "interested"
  | "lowball_offer"
  | "not_interested"
  | "opt_out"
  | "asks_proof"
  | "asks_payment_plan"
  | "asks_escrow"
  | "legal_concern"
  | "confused"
  | "other";

export type OfferStatus =
  | "proposed"
  | "countered"
  | "accepted"
  | "rejected"
  | "deposit_requested"
  | "deposit_paid";

export type DomainAnalysis = {
  likely_use_cases: string[];
  buyer_categories: string[];
  positioning_statement: string;
  risks: string[];
  suggested_search_queries: string[];
  outbound_recommended: boolean;
};

export type DomainCampaign = {
  id: string;
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
  status: CampaignStatus;
  analysis?: DomainAnalysis;
  created_at: string;
  updated_at: string;
};

export type BuyerLead = {
  id: string;
  campaign_id: string;
  company_name: string;
  website: string;
  current_domain: string;
  buyer_category: string;
  fit_score: number;
  reason_fit: string;
  current_domain_weakness: string;
  contact_email: string;
  contact_url: string;
  decision_maker_name: string;
  decision_maker_role: string;
  source_url: string;
  outreach_angle?: string;
  next_action?: string;
  status: LeadStatus;
  created_at: string;
  updated_at: string;
};

export type OutboundMessage = {
  id: string;
  campaign_id: string;
  buyer_lead_id: string;
  subject: string;
  body: string;
  status: MessageStatus;
  to_email?: string;
  agentmail_message_id?: string;
  agentmail_thread_id?: string;
  sent_at?: string;
  error?: string;
  created_at: string;
  updated_at: string;
};

export type ConversationEvent = {
  id: string;
  campaign_id: string;
  buyer_lead_id: string;
  channel: EventChannel;
  direction: EventDirection;
  body: string;
  classification: ReplyClass | "sent_email" | "system_note";
  offer_amount?: number;
  urgency?: string;
  next_action?: string;
  suggested_response?: string;
  agentmail_message_id?: string;
  agentmail_thread_id?: string;
  external_message_id?: string;
  external_conversation_id?: string;
  external_call_id?: string;
  created_at: string;
};

export type NegotiationPolicy = {
  campaign_id: string;
  ask_price: number;
  floor_price: number;
  deposit_amount: number;
  max_discount_percent: number;
  escalation_threshold: number;
  allow_payment_plan: boolean;
  allow_lease_to_own: boolean;
  forbidden_claims: string[];
};

export type Offer = {
  id: string;
  campaign_id: string;
  buyer_lead_id: string;
  amount: number;
  status: OfferStatus;
  payment_link: string;
  created_at: string;
  updated_at: string;
};

export type SuppressionRecord = {
  id: string;
  campaign_id: string;
  buyer_lead_id?: string;
  email?: string;
  reason: string;
  created_at: string;
};

export type ReplyClassification = {
  classification: ReplyClass;
  offer_amount?: number;
  urgency: "low" | "medium" | "high";
  next_action: string;
  explanation: string;
};

export type FullCampaign = {
  campaign: DomainCampaign;
  policy?: NegotiationPolicy;
  leads: BuyerLead[];
  messages: OutboundMessage[];
  events: ConversationEvent[];
  offers: Offer[];
};

export type AppStore = {
  campaigns: DomainCampaign[];
  buyerLeads: BuyerLead[];
  outboundMessages: OutboundMessage[];
  conversationEvents: ConversationEvent[];
  negotiationPolicies: NegotiationPolicy[];
  offers: Offer[];
  suppressions: SuppressionRecord[];
  processedAgentmailMessageIds: string[];
  processedWebhookEventIds: string[];
};
