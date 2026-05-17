export function outboundEmailRecipient(leadEmail?: string) {
  return (
    process.env.CONTACT_OVERRIDE_EMAIL ||
    leadEmail ||
    "carl@uni.minerva.edu"
  ).trim();
}

export function outboundPhoneRecipient() {
  return (
    process.env.CONTACT_OVERRIDE_PHONE ||
    "6284887063"
  ).trim();
}
