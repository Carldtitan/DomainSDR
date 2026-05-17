import { createHash } from "node:crypto";
import type { BuyerLead, DomainCampaign } from "@/lib/types";

export type OwnershipProof = {
  txt_record_name: string;
  txt_record_value: string;
  landing_page_path: string;
  landing_page_text: string;
  escrow_route: string[];
};

export function createOwnershipProof(campaign: DomainCampaign, lead: BuyerLead): OwnershipProof {
  const token = createHash("sha256")
    .update(`${campaign.id}:${lead.id}:${campaign.domain}`)
    .digest("hex")
    .slice(0, 24);

  return {
    txt_record_name: `_domainsdr.${campaign.domain}`,
    txt_record_value: `domainsdr-verification=${token}`,
    landing_page_path: `https://${campaign.domain}/domainsdr-verify`,
    landing_page_text: `DomainSDR verification: ${campaign.owner_name} controls ${campaign.domain} for discussion with ${lead.company_name}. Verification token: ${token}. This does not make legal, trademark, traffic, or revenue claims.`,
    escrow_route: [
      "Buyer and seller agree on price and basic terms.",
      "Seller verifies ownership with TXT record or landing page text.",
      "Buyer and seller open Escrow.com, Dan.com, Afternic, Sedo, or another trusted marketplace transaction.",
      "Deposit only confirms intent; the real domain transfer happens through the trusted escrow or marketplace workflow.",
    ],
  };
}
