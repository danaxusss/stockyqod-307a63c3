/**
 * Which quotes belong to a salesperson: those they created (`created_by`, the
 * username) and those naming them as seller (`customer_info.salesPerson`, the
 * seller name chosen in the quote editor: their custom seller name, else the
 * username). Matching ignores case and surrounding spaces. Junior and senior
 * salespeople see only these; the rule lives here so every screen agrees.
 */
export interface QuoteOwner {
  username: string;
  sellerName: string;
}

export function quoteOwnerOf(user: { username?: string | null; custom_seller_name?: string | null } | null | undefined): QuoteOwner | null {
  const username = (user?.username || '').trim();
  if (!username) return null;
  return { username, sellerName: (user?.custom_seller_name || '').trim() || username };
}

const same = (a: string | null | undefined, b: string) => !!a && a.trim().toLowerCase() === b.trim().toLowerCase();

export function isQuoteOwnedBy(
  quote: { createdBy?: string | null; customer?: { salesPerson?: string | null } | null },
  owner: QuoteOwner | null,
): boolean {
  if (!owner) return false;
  return same(quote.createdBy, owner.username) || same(quote.customer?.salesPerson, owner.sellerName);
}

/**
 * An exact, case-insensitive `ilike` value: `%`, `_` and `\` are escaped, and
 * the characters that would end a PostgREST `or()` condition become `_` (one
 * character), so a name holding a comma or parenthesis still matches itself.
 */
function exactPattern(value: string): string {
  return value.trim().replace(/[%_\\]/g, m => `\\${m}`).replace(/[,()"]/g, '_');
}

/** PostgREST `or()` condition for the quotes of `owner`. */
export function ownedQuotesFilter(owner: QuoteOwner): string {
  return `created_by.ilike.${exactPattern(owner.username)},customer_info->>salesPerson.ilike.${exactPattern(owner.sellerName)}`;
}
