export function outboundEmailRecipient(leadEmail?: string) {
  return (
    process.env.CONTACT_OVERRIDE_EMAIL ||
    leadEmail ||
    "carl@uni.minerva.edu"
  ).trim();
}

function normalizeUsPhone(value: string) {
  const trimmed = value.trim();
  const digits = trimmed.replace(/\D/g, "");
  if (!digits) return trimmed;
  if (trimmed.startsWith("+")) return `+${digits}`;
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  return trimmed;
}

export function outboundPhoneRecipient() {
  return normalizeUsPhone(
    process.env.CONTACT_OVERRIDE_PHONE ||
    "6284887063"
  );
}
