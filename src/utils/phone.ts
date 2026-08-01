/**
 * Phone normalization to E.164, tuned for Morocco (+212) but generic.
 * Returns null when the input can't be made into a plausible number.
 */
const DEFAULT_CC = '212'; // Morocco

export function normalizePhone(raw: string, defaultCc = DEFAULT_CC): string | null {
  if (!raw) return null;
  let s = String(raw).trim();

  // keep a leading +, strip everything else non-digit
  const hasPlus = s.startsWith('+') || s.startsWith('00');
  s = s.replace(/^00/, '+').replace(/[^\d+]/g, '');
  const plus = s.startsWith('+');
  let digits = s.replace(/\D/g, '');
  if (!digits) return null;

  if (plus || hasPlus) {
    // already international
  } else if (digits.startsWith(defaultCc)) {
    // e.g. 2126… typed without +
  } else if (digits.startsWith('0')) {
    // national trunk 0 → +CC (0612… → +212612…)
    digits = defaultCc + digits.slice(1);
  } else if (defaultCc === '212' && /^[5-7]\d{8}$/.test(digits)) {
    // bare Moroccan mobile/landline without the 0 (612345678)
    digits = defaultCc + digits;
  } else {
    // assume it already carries a country code
  }

  // basic sanity: 8–15 digits (E.164)
  if (digits.length < 8 || digits.length > 15) return null;
  return '+' + digits;
}

/** Group a list, returning the normalized value + which raw inputs failed. */
export function normalizeMany(list: string[], defaultCc = DEFAULT_CC) {
  const ok: string[] = [];
  const failed: string[] = [];
  const seen = new Set<string>();
  for (const raw of list) {
    const n = normalizePhone(raw, defaultCc);
    if (!n) { failed.push(raw); continue; }
    if (seen.has(n)) continue;
    seen.add(n);
    ok.push(n);
  }
  return { ok, failed, duplicates: list.length - ok.length - failed.length };
}
