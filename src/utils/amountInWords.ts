// Amounts written out in French on invoices ("Arrêté la présente facture à la
// somme de …"). Traditional spelling (hyphens only below one hundred, "et"
// for 21, 31 … 71), with the agreement rules a reader checks first:
// - "cent" takes an s when multiplied and last ("deux cents") but not when
//   another number follows ("deux cent un", "deux cent mille");
// - "quatre-vingts" likewise ("quatre-vingt-un", "quatre-vingt mille");
// - "mille" never varies; "million(s)" and "milliard(s)" are nouns: they take
//   an s, and "cents" / "quatre-vingts" before them keep theirs.

const UNITS = ['', 'UN', 'DEUX', 'TROIS', 'QUATRE', 'CINQ', 'SIX', 'SEPT', 'HUIT', 'NEUF',
  'DIX', 'ONZE', 'DOUZE', 'TREIZE', 'QUATORZE', 'QUINZE', 'SEIZE', 'DIX-SEPT', 'DIX-HUIT', 'DIX-NEUF'];
const TENS = ['', 'DIX', 'VINGT', 'TRENTE', 'QUARANTE', 'CINQUANTE', 'SOIXANTE'];

/** 0–99. `last`: nothing follows, so "quatre-vingts" keeps its s. */
function below100(n: number, last: boolean): string {
  if (n < 20) return UNITS[n];
  const t = Math.floor(n / 10);
  const u = n % 10;
  if (t <= 6) {
    if (u === 0) return TENS[t];
    if (u === 1) return `${TENS[t]} ET UN`;
    return `${TENS[t]}-${UNITS[u]}`;
  }
  if (t === 7) return u === 1 ? 'SOIXANTE ET ONZE' : `SOIXANTE-${UNITS[10 + u]}`;
  if (t === 8) return u === 0 ? (last ? 'QUATRE-VINGTS' : 'QUATRE-VINGT') : `QUATRE-VINGT-${UNITS[u]}`;
  return `QUATRE-VINGT-${UNITS[10 + u]}`;
}

/** 1–999. `last`: no other number word follows (end, or a noun like "millions"). */
function below1000(n: number, last: boolean): string {
  const h = Math.floor(n / 100);
  const rest = n % 100;
  if (h === 0) return below100(rest, last);
  const hundreds = h === 1 ? 'CENT' : `${UNITS[h]} ${rest === 0 && last ? 'CENTS' : 'CENT'}`;
  return rest === 0 ? hundreds : `${hundreds} ${below100(rest, last)}`;
}

/** A whole number in words, upper case: 2 300 400 → "DEUX MILLIONS TROIS CENT MILLE QUATRE CENTS". */
export function numberToWordsFr(value: number): string {
  const n = Math.floor(Math.abs(value));
  if (n === 0) return 'ZÉRO';
  const billions = Math.floor(n / 1_000_000_000);
  const millions = Math.floor((n % 1_000_000_000) / 1_000_000);
  const thousands = Math.floor((n % 1_000_000) / 1000);
  const below = n % 1000;
  const parts: string[] = [];
  // Million and milliard are nouns: the number before them is "last".
  if (billions > 0) parts.push(billions === 1 ? 'UN MILLIARD' : `${numberToWordsFr(billions)} MILLIARDS`);
  if (millions > 0) parts.push(millions === 1 ? 'UN MILLION' : `${below1000(millions, true)} MILLIONS`);
  // "Mille" is a number word: what comes before it is not last.
  if (thousands > 0) parts.push(thousands === 1 ? 'MILLE' : `${below1000(thousands, false)} MILLE`);
  if (below > 0) parts.push(below1000(below, true));
  return parts.join(' ');
}

/**
 * An amount in dirhams and centimes: 1 250,50 → "MILLE DEUX CENT CINQUANTE
 * DIRHAMS ET CINQUANTE CENTIMES". "De" before the currency after a round
 * million ("UN MILLION DE DIRHAMS").
 */
export function amountInWordsFr(amount: number): string {
  const totalCents = Math.round(Math.abs(Number(amount) || 0) * 100);
  const dh = Math.floor(totalCents / 100);
  const ct = totalCents % 100;
  const roundMillion = dh >= 1_000_000 && dh % 1_000_000 === 0;
  let out = `${numberToWordsFr(dh)} ${roundMillion ? 'DE ' : ''}DIRHAM${dh > 1 ? 'S' : ''}`;
  if (ct > 0) out += ` ET ${numberToWordsFr(ct)} CENTIME${ct > 1 ? 'S' : ''}`;
  return out;
}
