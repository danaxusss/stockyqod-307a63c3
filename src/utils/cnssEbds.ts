// CNSS monthly declaration by file exchange (Damancom "e-BDS"): reading the
// pre-filled file the CNSS publishes ("préétabli", AFFEBDS_…) and writing the
// declaration file (DS_…) from the month's validated payslips.
//
// NO OFFICIAL SPECIFICATION WAS AVAILABLE. The CNSS document ("Cahier des
// spécifications techniques … Mode Echange de Fichiers", v2, February 2006)
// could not be obtained. This layout is the majority reading of secondary
// sources: the Infor Anael Paie manual (2022) and three open-source
// implementations (deepcodesystem/Payroll cnss_bds_generator,
// mhmbello/odoo hr_damancom, rmouwafaq/damankom). Every record is 260
// characters. Where they disagree the choice made is noted next to the field.
// Nothing here may be presented as verified until a real préétabli and a
// Damancom file check have confirmed it.
//
// Pure functions only: the page reads the uploaded file and the payslips.

export const EBDS_RECORD_LENGTH = 260;

/** Situation codes of an insured person (all sources agree); '' = normal. */
export type EbdsSituation = '' | 'SO' | 'DE' | 'IT' | 'IL' | 'AT' | 'CS' | 'MS' | 'MP';

export const EBDS_SITUATIONS: { code: EbdsSituation; label: string; rank: number }[] = [
  { code: '', label: 'Normale', rank: 0 },
  { code: 'SO', label: 'SO – Sortant', rank: 1 },
  { code: 'DE', label: 'DE – Décédé', rank: 2 },
  { code: 'IT', label: 'IT – Maternité', rank: 3 },
  { code: 'IL', label: 'IL – Maladie', rank: 4 },
  { code: 'AT', label: 'AT – Accident du travail', rank: 5 },
  { code: 'CS', label: 'CS – Congé sans solde', rank: 6 },
  { code: 'MS', label: 'MS – Maintenu sans salaire', rank: 7 },
  { code: 'MP', label: 'MP – Maladie professionnelle', rank: 8 },
];

/** Rank of a situation in the line control sum (S_Ctr). */
export function situationRank(s: EbdsSituation): number {
  return EBDS_SITUATIONS.find(x => x.code === s)?.rank ?? 0;
}

const isSituation = (s: string): s is EbdsSituation => EBDS_SITUATIONS.some(x => x.code === s);

// ── Field helpers ───────────────────────────────────────────────────────────

/** Numeric field: right-aligned, zero-padded; a value too long is an error, never truncated. */
export function numField(v: bigint | number, len: number): string {
  const s = (typeof v === 'bigint' ? v : BigInt(Math.round(Number(v) || 0))).toString();
  if (s.startsWith('-')) throw new Error(`Valeur négative impossible dans un champ numérique (${s}).`);
  if (s.length > len) throw new Error(`Valeur ${s} trop longue pour un champ de ${len} chiffres.`);
  return s.padStart(len, '0');
}

/** Alphanumeric field: upper case, ASCII letters, digits and spaces, left-aligned, space-padded. */
export function alphaField(v: string | null | undefined, len: number): string {
  return asciiUpper(v).slice(0, len).padEnd(len, ' ');
}

/** Upper-case ASCII: accents removed, other signs turned into spaces. */
export function asciiUpper(v: string | null | undefined): string {
  return String(v ?? '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toUpperCase().replace(/[^A-Z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
}

/** Amount in centimes, as the file writes them (6 000 MAD = 600000). */
export const centimes = (mad: number) => BigInt(Math.round((Number(mad) || 0) * 100));

/**
 * Check digit of a 9-digit insured number (secondary sources): it starts with
 * 1; u = units digit of (C2+C4+C6+C8)×2 + C3+C5+C7; C9 = 0 if u = 0, else 10 − u.
 */
export function cnssNumberValid(num: string): boolean {
  if (!/^1\d{8}$/.test(num) || num === '100000000') return false;
  const c = num.split('').map(Number);
  const u = ((c[1] + c[3] + c[5] + c[7]) * 2 + c[2] + c[4] + c[6]) % 10;
  return (u === 0 ? 0 : 10 - u) === c[8];
}

/** A CNSS number as stored on an employee: digits only. */
export const cnssDigits = (v: string | null | undefined) => String(v ?? '').replace(/\D/g, '');

// ── Period ──────────────────────────────────────────────────────────────────

export interface EbdsPeriod { year: number; month: number; format: 'AAAAMM' | 'MMAAAA' }

/**
 * The period field of a record. The sources write AAAAMM inside records
 * (deepcode, damankom); the file name uses MMAAAA. Both readings are accepted
 * when unambiguous, and the record is always copied as it came.
 */
export function readPeriod(s: string): EbdsPeriod | null {
  const ok = (y: number, m: number) => y >= 2000 && y <= 2100 && m >= 1 && m <= 12;
  let m = /^(\d{4})(\d{2})$/.exec(s);
  if (m && ok(Number(m[1]), Number(m[2]))) return { year: Number(m[1]), month: Number(m[2]), format: 'AAAAMM' };
  m = /^(\d{2})(\d{4})$/.exec(s);
  if (m && ok(Number(m[2]), Number(m[1]))) return { year: Number(m[2]), month: Number(m[1]), format: 'MMAAAA' };
  return null;
}

// ── Pre-filled file (préétabli) ─────────────────────────────────────────────

export interface PreetabliInsured {
  line: number;
  number: string;
  name: string;
  children: number;
  /** Family allowance amounts, in centimes. */
  afToPay: bigint;
  afToDeduct: bigint;
  afNet: bigint;
  /** The record as read (positions 4-105 are copied into B02). */
  raw: string;
}

export interface Preetabli {
  /** Text encoding the file was read with (written back the same way). */
  encoding: 'latin1' | 'utf-8';
  lineEnding: 'CRLF' | 'LF' | 'CR';
  transferId: string;
  category: string;
  affiliate: string;
  periodField: string;
  period: EbdsPeriod;
  companyName: string;
  activity: string;
  address: string;
  city: string;
  postalCode: string;
  agency: string;
  issueDate: string;
  dueDate: string;
  insured: PreetabliInsured[];
  totals: { count: number; children: bigint; afToPay: bigint; afToDeduct: bigint; afNet: bigint; numberSum: bigint };
  records: { a00: string; a01: string; a03: string };
  warnings: string[];
}

export type PreetabliResult = { ok: true; file: Preetabli } | { ok: false; errors: string[] };

const digits = (s: string) => /^\d+$/.test(s);

/** Splits on CRLF, LF or CR (the sources disagree on line ends); trailing empty lines dropped. */
function splitLines(text: string): { lines: string[]; ending: Preetabli['lineEnding'] } {
  const ending = text.includes('\r\n') ? 'CRLF' : text.includes('\n') ? 'LF' : 'CR';
  const lines = text.split(/\r\n|\n|\r/);
  while (lines.length && lines[lines.length - 1] === '') lines.pop();
  return { lines, ending };
}

function decode(input: string | Uint8Array): { text: string; encoding: Preetabli['encoding'] }[] {
  if (typeof input === 'string') return [{ text: input, encoding: 'utf-8' }];
  // Latin-1 first: one byte = one character, so positions are byte positions.
  const out: { text: string; encoding: Preetabli['encoding'] }[] = [{ text: new TextDecoder('latin1').decode(input), encoding: 'latin1' }];
  try {
    const utf8 = new TextDecoder('utf-8', { fatal: true }).decode(input);
    if (utf8 !== out[0].text) out.push({ text: utf8, encoding: 'utf-8' });
  } catch { /* not UTF-8: Latin-1 only */ }
  return out;
}

/**
 * Reads a préétabli strictly: A00, A01, A02 × n, A03, every record 260
 * characters, numeric fields numeric, affiliate and period the same on every
 * record, and the A03 totals equal to the sums of the A02 records. Any
 * departure is an error (it would mean the layout was misread).
 */
export function parsePreetabli(input: string | Uint8Array): PreetabliResult {
  const attempts = decode(input);
  let firstErrors: string[] | null = null;
  for (const a of attempts) {
    const r = parseText(a.text, a.encoding);
    if ('file' in r) return r;
    firstErrors ??= r.errors;
  }
  return { ok: false, errors: firstErrors || ['Fichier vide.'] };
}

function parseText(text: string, encoding: Preetabli['encoding']): PreetabliResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const { lines, ending } = splitLines(text.replace(/^\uFEFF/, ''));
  if (lines.length === 0) return { ok: false, errors: ['Fichier vide.'] };
  lines.forEach((l, i) => {
    if (l.length !== EBDS_RECORD_LENGTH) errors.push(`Ligne ${i + 1} : ${l.length} caractères au lieu de ${EBDS_RECORD_LENGTH}.`);
  });
  if (errors.length) return { ok: false, errors };

  const types = lines.map(l => l.slice(0, 3));
  types.forEach((t, i) => {
    if (!['A00', 'A01', 'A02', 'A03'].includes(t)) errors.push(`Ligne ${i + 1} : enregistrement « ${t} » inconnu.`);
  });
  if (errors.length) return { ok: false, errors };
  if (types[0] !== 'A00') errors.push('Ligne 1 : l\'enregistrement A00 doit être le premier.');
  if (types[1] !== 'A01') errors.push('Ligne 2 : l\'enregistrement A01 doit suivre A00.');
  if (types[types.length - 1] !== 'A03') errors.push('Dernière ligne : l\'enregistrement A03 doit être le dernier.');
  types.forEach((t, i) => {
    if (i >= 2 && i < types.length - 1 && t !== 'A02') errors.push(`Ligne ${i + 1} : ${t} à cette place, A02 attendu.`);
  });
  if (errors.length) return { ok: false, errors };

  const a00 = lines[0];
  const a01 = lines[1];
  const a03 = lines[lines.length - 1];
  const f = (l: string, from: number, to: number) => l.slice(from - 1, to);

  const transferId = f(a00, 4, 17);
  if (!digits(transferId)) errors.push('A00 : identifiant de transfert (positions 4-17) non numérique.');
  const affiliate = f(a01, 4, 10);
  const periodField = f(a01, 11, 16);
  if (!digits(affiliate)) errors.push('A01 : n° d\'affiliation (positions 4-10) non numérique.');
  const period = readPeriod(periodField);
  if (!period) errors.push(`A01 : période « ${periodField} » illisible (positions 11-16).`);
  const issueDate = f(a01, 245, 252);
  const dueDate = f(a01, 253, 260);
  for (const [label, v] of [['date d\'émission (245-252)', issueDate], ['date d\'exigibilité (253-260)', dueDate]] as const) {
    if (v.trim() && !digits(v)) errors.push(`A01 : ${label} non numérique.`);
  }

  const insured: PreetabliInsured[] = [];
  lines.slice(2, -1).forEach((l, k) => {
    const n = k + 3;
    const at = (from: number, to: number) => f(l, from, to);
    if (at(4, 10) !== affiliate || at(11, 16) !== periodField) errors.push(`Ligne ${n} : n° d'affiliation ou période différent de A01.`);
    const num = at(17, 25);
    if (!/^\d{9}$/.test(num)) errors.push(`Ligne ${n} : n° d'immatriculation « ${num} » non numérique.`);
    const numeric: [string, number, number][] = [['nombre d\'enfants', 86, 87], ['AF à payer', 88, 93], ['AF à déduire', 94, 99], ['AF net à payer', 100, 105]];
    for (const [label, a, b] of numeric) if (!digits(at(a, b))) errors.push(`Ligne ${n} : ${label} (positions ${a}-${b}) non numérique.`);
    if (errors.length) return;
    insured.push({
      line: n, number: num, name: at(26, 85).trim(), children: Number(at(86, 87)),
      afToPay: BigInt(at(88, 93)), afToDeduct: BigInt(at(94, 99)), afNet: BigInt(at(100, 105)), raw: l,
    });
  });
  if (f(a03, 4, 10) !== affiliate || f(a03, 11, 16) !== periodField) errors.push('A03 : n° d\'affiliation ou période différent de A01.');
  const a03Fields: [string, number, number][] = [['nombre de salariés', 17, 22], ['total enfants', 23, 28], ['total AF à payer', 29, 40], ['total AF à déduire', 41, 52], ['total AF net', 53, 64], ['total des immatriculations', 65, 79]];
  for (const [label, a, b] of a03Fields) if (!digits(f(a03, a, b))) errors.push(`A03 : ${label} (positions ${a}-${b}) non numérique.`);
  if (errors.length) return { ok: false, errors };

  const sum = (g: (p: PreetabliInsured) => bigint) => insured.reduce((s, p) => s + g(p), 0n);
  const totals = {
    count: insured.length,
    children: sum(p => BigInt(p.children)),
    afToPay: sum(p => p.afToPay),
    afToDeduct: sum(p => p.afToDeduct),
    afNet: sum(p => p.afNet),
    numberSum: sum(p => BigInt(p.number)),
  };
  const checks: [string, bigint, bigint][] = [
    ['nombre de salariés', BigInt(f(a03, 17, 22)), BigInt(totals.count)],
    ['total enfants', BigInt(f(a03, 23, 28)), totals.children],
    ['total AF à payer', BigInt(f(a03, 29, 40)), totals.afToPay],
    ['total AF à déduire', BigInt(f(a03, 41, 52)), totals.afToDeduct],
    ['total AF net', BigInt(f(a03, 53, 64)), totals.afNet],
    ['total des immatriculations', BigInt(f(a03, 65, 79)), totals.numberSum],
  ];
  for (const [label, read, computed] of checks) {
    if (read !== computed) errors.push(`A03 : ${label} ${read} alors que les lignes A02 donnent ${computed}.`);
  }
  const seen = new Set<string>();
  for (const p of insured) {
    if (seen.has(p.number)) errors.push(`N° d'immatriculation ${p.number} en double.`);
    seen.add(p.number);
  }
  if (errors.length) return { ok: false, errors };

  if (insured.some((p, i) => i > 0 && p.number < insured[i - 1].number)) warnings.push('Les assurés ne sont pas triés par n° d\'immatriculation.');
  for (const p of insured) if (!cnssNumberValid(p.number)) warnings.push(`N° ${p.number} (${p.name}) : clé de contrôle non vérifiée.`);

  return {
    ok: true,
    file: {
      encoding, lineEnding: ending, transferId, category: f(a00, 18, 19), affiliate, periodField, period: period!,
      companyName: f(a01, 17, 56).trim(), activity: f(a01, 57, 96).trim(), address: f(a01, 97, 216).trim(),
      city: f(a01, 217, 236).trim(), postalCode: f(a01, 237, 242).trim(), agency: f(a01, 243, 244).trim(),
      issueDate, dueDate, insured, totals, records: { a00, a01, a03 }, warnings,
    },
  };
}

// ── Matching with employees ─────────────────────────────────────────────────

export interface EbdsEmployee {
  id: string;
  name: string;
  cnss: string;
  cin: string;
  hireDate: string | null;
  exitDate: string | null;
}

export interface EbdsPay {
  employeeId: string;
  /** Days declared on the payslip (cnss_days). */
  days: number;
  /** Uncapped CNSS base of the payslip, in MAD. */
  realSalary: number;
}

export interface EbdsMatch {
  insured: PreetabliInsured;
  employee: EbdsEmployee | null;
  pay: EbdsPay | null;
  /** An employee whose name looks like this person's, when the CNSS number did not match. */
  nameHint: EbdsEmployee | null;
  /** Matched by number but the names look different. */
  nameDiffers: boolean;
}

/** Name comparison key: accents, case and word order ignored. */
export function nameKey(v: string): string {
  return asciiUpper(v).split(' ').filter(Boolean).sort().join(' ');
}

/**
 * Each insured person matched to an employee by CNSS number only (the name
 * is a hint, never a match). Employees with a validated payslip for the month
 * who are not in the file are the entrants.
 */
export function matchPreetabli(file: Preetabli, employees: EbdsEmployee[], pays: EbdsPay[]): { matches: EbdsMatch[]; entrants: { employee: EbdsEmployee; pay: EbdsPay }[] } {
  const byNumber = new Map<string, EbdsEmployee>();
  for (const e of employees) {
    const d = cnssDigits(e.cnss);
    if (d) byNumber.set(d.padStart(9, '0'), e);
  }
  const payOf = new Map(pays.map(p => [p.employeeId, p]));
  const matches = file.insured.map(ins => {
    const employee = byNumber.get(ins.number) || null;
    const key = nameKey(ins.name);
    const nameHint = employee ? null : employees.find(e => nameKey(e.name) === key && !byNumber.has(cnssDigits(e.cnss).padStart(9, '0'))) || null;
    return {
      insured: ins, employee, pay: employee ? payOf.get(employee.id) || null : null, nameHint,
      nameDiffers: !!employee && nameKey(employee.name) !== key,
    };
  });
  const inFile = new Set(matches.filter(m => m.employee).map(m => m.employee!.id));
  const entrants = pays
    .filter(p => !inFile.has(p.employeeId))
    .map(p => ({ employee: employees.find(e => e.id === p.employeeId)!, pay: p }))
    .filter(x => x.employee);
  return { matches, entrants };
}

/**
 * A situation to suggest for a person in the file: normal with a payslip,
 * "sortant" when the employee left before the month ended, otherwise none
 * (the user must choose).
 */
export function suggestedSituation(m: EbdsMatch, period: EbdsPeriod): EbdsSituation | null {
  if (m.pay) return '';
  const end = new Date(Date.UTC(period.year, period.month, 0)).toISOString().slice(0, 10);
  if (m.employee?.exitDate && m.employee.exitDate.slice(0, 10) <= end) return 'SO';
  return null;
}

// ── Declaration file (DS_…) ─────────────────────────────────────────────────

export interface EbdsDeclaredLine {
  insured: PreetabliInsured;
  situation: EbdsSituation;
  days: number;
  /** Real (uncapped) salary in MAD. */
  realSalary: number;
}

export interface EbdsEntrant {
  /** 9-digit number, or empty when the employee has none yet (written 000000000). */
  number: string;
  name: string;
  cin: string;
  days: number;
  realSalary: number;
  /** Hire date (AAAA-MM-JJ), for the "entry in the period" rule. */
  hireDate?: string | null;
}

export interface EbdsOptions {
  /** CNSS salary ceiling in MAD (6 000). */
  cap: number;
  /** Monthly SMIG in MAD, for the minimum-salary warning (0: no check). */
  smigMonthly?: number;
  /** Line end of the file written: LF (majority of sources) or CRLF (Infor). */
  lineEnding?: 'LF' | 'CRLF';
}

export interface EbdsTotals {
  existing: { count: number; numberSum: bigint; afToReturn: bigint; days: bigint; real: bigint; capped: bigint; ctr: bigint };
  entrants: { count: number; numberSum: bigint; days: bigint; real: bigint; capped: bigint; ctr: bigint };
  all: { count: number; numberSum: bigint; days: bigint; real: bigint; capped: bigint; ctr: bigint };
}

export type EbdsResult =
  | { ok: true; content: string; fileName: string; records: string[]; totals: EbdsTotals; warnings: string[] }
  | { ok: false; errors: string[]; warnings: string[] };

/** File name rule (Infor, deepcode): DS_<affiliate on 7 digits>_<MMAAAA>.txt. */
export function ebdsFileName(affiliate: string, period: Pick<EbdsPeriod, 'year' | 'month'>): string {
  return `DS_${affiliate.padStart(7, '0')}_${String(period.month).padStart(2, '0')}${period.year}.txt`;
}

/**
 * The declaration file: B00, B01, one B02 per A02 (same order), B03, the
 * entrants B04 (one blank B04 when there are none), B05, B06.
 * B00 and B01 are A00 and A01 with the record letter changed (as the
 * implementations do); B02 positions 4-105 are A02 positions 4-105.
 */
export function generateEbds(file: Preetabli, lines: EbdsDeclaredLine[], entrants: EbdsEntrant[], opts: EbdsOptions): EbdsResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const capC = centimes(opts.cap);
  const head = file.affiliate + file.periodField; // positions 4-16 of every record

  if (lines.length !== file.insured.length || lines.some((l, i) => l.insured.number !== file.insured[i].number)) {
    errors.push('Chaque personne du préétabli doit être déclarée une fois, dans l\'ordre du fichier.');
  }

  type Line = { number: bigint; afToReturn: bigint; days: bigint; real: bigint; capped: bigint; ctr: bigint };
  const existing: Line[] = [];
  const b02: string[] = [];
  for (const l of lines) {
    const who = `${l.insured.number} ${l.insured.name}`;
    if (!isSituation(l.situation)) { errors.push(`${who} : situation « ${l.situation} » inconnue.`); continue; }
    let days = Math.round(Number(l.days) || 0);
    let real = centimes(l.realSalary);
    if (l.situation === 'CS' || l.situation === 'MS') {
      // Unpaid leave / kept without pay: days and salaries are zero.
      if (days !== 0 || real !== 0n) warnings.push(`${who} : situation ${l.situation}, jours et salaires mis à zéro.`);
      days = 0; real = 0n;
    }
    if (days < 0 || days > 26) errors.push(`${who} : ${days} jours (maximum 26).`);
    if (real < 0n) errors.push(`${who} : salaire négatif.`);
    if (l.situation === '' && (days === 0 || real === 0n)) errors.push(`${who} : situation normale sans jours ni salaire. Choisissez une situation.`);
    if (opts.smigMonthly && l.situation === '' && days > 0 && Number(real) / 100 <= (opts.smigMonthly / 26) * (days - 1)) {
      warnings.push(`${who} : salaire réel bas pour ${days} jours (contrôle SMIG / 26 × (jours − 1)).`);
    }
    const capped = real < capC ? real : capC;
    // Family allowance paid in advance for someone who left or died is returned.
    const afToReturn = l.situation === 'SO' || l.situation === 'DE' ? l.insured.afNet : 0n;
    const number = BigInt(l.insured.number);
    const ctr = number + afToReturn + BigInt(days) + real + capped + BigInt(situationRank(l.situation));
    existing.push({ number, afToReturn, days: BigInt(days), real, capped, ctr });
    try {
      b02.push('B02' + l.insured.raw.slice(3, 105) + numField(afToReturn, 6) + numField(days, 2) + numField(real, 13)
        + numField(capped, 9) + (l.situation || '').padEnd(2, ' ') + numField(ctr, 19) + ' '.repeat(104));
    } catch (e) { errors.push(`${who} : ${(e as Error).message}`); }
  }

  const ent: Line[] = [];
  const b04: string[] = [];
  const seen = new Set(file.insured.map(p => p.number));
  for (const e of entrants) {
    const num = cnssDigits(e.number);
    const who = e.name || '—';
    if (num && !/^\d{9}$/.test(num)) errors.push(`Entrant ${who} : n° CNSS « ${e.number} » de ${num.length} chiffres (9 attendus).`);
    else if (num && seen.has(num)) errors.push(`Entrant ${who} : n° ${num} déjà dans le préétabli.`);
    else if (num && !cnssNumberValid(num)) warnings.push(`Entrant ${who} : clé de contrôle du n° ${num} non vérifiée.`);
    if (num) seen.add(num);
    const days = Math.round(Number(e.days) || 0);
    const real = centimes(e.realSalary);
    if (days <= 0 || days > 26) errors.push(`Entrant ${who} : ${days} jours (1 à 26).`);
    if (real <= 0n) errors.push(`Entrant ${who} : salaire nul.`);
    const cin = asciiUpper(e.cin).replace(/ /g, '');
    if (cin.length > 8) errors.push(`Entrant ${who} : CIN « ${cin} » de plus de 8 caractères.`);
    if (!cin) warnings.push(`Entrant ${who} : CIN manquante.`);
    if (!num) warnings.push(`Entrant ${who} : pas de n° CNSS, déclaré avec 000000000.`);
    // Infor: an entrant with a number must have joined during the period.
    const ym = `${file.period.year}-${String(file.period.month).padStart(2, '0')}`;
    if (num && e.hireDate && e.hireDate.slice(0, 7) !== ym) warnings.push(`Entrant ${who} : embauché le ${e.hireDate.slice(0, 10)}, hors de la période déclarée.`);
    const capped = real < capC ? real : capC;
    const number = BigInt(num || '0');
    const ctr = number + BigInt(days) + real + capped;
    ent.push({ number, afToReturn: 0n, days: BigInt(days), real, capped, ctr });
    try {
      b04.push('B04' + head + numField(number, 9) + alphaField(e.name, 60) + alphaField(cin, 8) + numField(days, 2)
        + numField(real, 13) + numField(capped, 9) + numField(ctr, 19) + ' '.repeat(124));
    } catch (err) { errors.push(`Entrant ${who} : ${(err as Error).message}`); }
  }
  if (errors.length) return { ok: false, errors, warnings };

  const add = (ls: Line[], k: keyof Line) => ls.reduce((s, l) => s + l[k], 0n);
  const totalsOf = (ls: Line[]) => ({ count: ls.length, numberSum: add(ls, 'number'), days: add(ls, 'days'), real: add(ls, 'real'), capped: add(ls, 'capped'), ctr: add(ls, 'ctr') });
  const tEx = { ...totalsOf(existing), afToReturn: add(existing, 'afToReturn') };
  const tEn = totalsOf(ent);
  const tAll = { count: tEx.count + tEn.count, numberSum: tEx.numberSum + tEn.numberSum, days: tEx.days + tEn.days, real: tEx.real + tEn.real, capped: tEx.capped + tEn.capped, ctr: tEx.ctr + tEn.ctr };

  const records: string[] = [];
  try {
    // B00: A00 with its two letters changed ("A00" → "B00", category "A?" → "B?").
    const a00 = file.records.a00;
    records.push('B00' + a00.slice(3, 17) + (a00[17] === 'A' ? 'B' : a00[17]) + a00.slice(18));
    // B01: A01 with the record type changed; issue and due dates kept.
    records.push('B01' + file.records.a01.slice(3));
    records.push(...b02);
    // B03: the A03 totals recomputed, then the declared totals.
    records.push('B03' + head + numField(tEx.count, 6) + numField(file.totals.children, 6) + numField(file.totals.afToPay, 12)
      + numField(file.totals.afToDeduct, 12) + numField(file.totals.afNet, 12) + numField(tEx.numberSum, 15) + numField(tEx.afToReturn, 12)
      + numField(tEx.days, 6) + numField(tEx.real, 15) + numField(tEx.capped, 13) + numField(tEx.ctr, 19) + ' '.repeat(116));
    if (b04.length) records.push(...b04);
    // No entrant: one blank B04 (number and names as spaces, numbers zero).
    else records.push('B04' + head + ' '.repeat(9) + ' '.repeat(60) + ' '.repeat(8) + numField(0, 2) + numField(0, 13) + numField(0, 9) + numField(0, 19) + ' '.repeat(124));
    const recap = (type: string, t: typeof tEn) => type + head + numField(t.count, 6) + numField(t.numberSum, 15) + numField(t.days, 6)
      + numField(t.real, 15) + numField(t.capped, 13) + numField(t.ctr, 19) + ' '.repeat(170);
    records.push(recap('B05', tEn));
    records.push(recap('B06', tAll));
  } catch (e) {
    return { ok: false, errors: [(e as Error).message], warnings };
  }
  const bad = records.findIndex(r => r.length !== EBDS_RECORD_LENGTH);
  if (bad >= 0) return { ok: false, errors: [`Enregistrement ${records[bad].slice(0, 3)} de ${records[bad].length} caractères (erreur interne).`], warnings };

  const eol = opts.lineEnding === 'CRLF' ? '\r\n' : '\n';
  return {
    ok: true,
    content: records.join(eol) + eol,
    fileName: ebdsFileName(file.affiliate, file.period),
    records,
    totals: { existing: tEx, entrants: tEn, all: tAll },
    warnings,
  };
}

/** Bytes of the file, in the encoding the préétabli was read with. */
export function ebdsBytes(content: string, encoding: Preetabli['encoding']): Uint8Array {
  if (encoding === 'utf-8') return new TextEncoder().encode(content);
  const out = new Uint8Array(content.length);
  for (let i = 0; i < content.length; i++) {
    const c = content.charCodeAt(i);
    out[i] = c < 256 ? c : 0x3f; // '?' for anything Latin-1 cannot hold
  }
  return out;
}
