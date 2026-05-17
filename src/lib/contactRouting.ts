export function outboundEmailRecipient(leadEmail?: string) {
  return (
    process.env.CONTACT_OVERRIDE_EMAIL ||
    leadEmail ||
    "REDACTED"
  ).trim();
}

export function outboundPhoneRecipient() {
  return (
    process.env.CONTACT_OVERRIDE_PHONE ||
    "6284887063"
  ).trim();
}
