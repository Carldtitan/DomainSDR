export function outboundEmailRecipient() {
  return (
    process.env.CONTACT_OVERRIDE_EMAIL ||
    "REDACTED"
  ).trim();
}

export function outboundPhoneRecipient() {
  return (
    process.env.CONTACT_OVERRIDE_PHONE ||
    "6284887063"
  ).trim();
}
