export function outboundEmailRecipient() {
  return (
    process.env.CONTACT_OVERRIDE_EMAIL ||
    "carl@uni.minerva.edu"
  ).trim();
}

export function outboundPhoneRecipient() {
  return (
    process.env.CONTACT_OVERRIDE_PHONE ||
    "6284887063"
  ).trim();
}
