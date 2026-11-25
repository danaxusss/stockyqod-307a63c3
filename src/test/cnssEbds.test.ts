// CNSS e-BDS (Damancom) — layout from secondary sources only. A small
// pre-filled file written by hand from that layout; every control sum below
// is worked out by hand in the comments.
import { describe, expect, it } from 'vitest';
import {
  alphaField, asciiUpper, cnssNumberValid, EBDS_RECORD_LENGTH, ebdsBytes, ebdsFileName, generateEbds, matchPreetabli, numField,
  parsePreetabli, readPeriod, situationRank, suggestedSituation, type EbdsDeclaredLine, type Preetabli,
} from '../utils/cnssEbds';

// Test-side padding, written independently of the module's helpers.
const N = (v: string | number, len: number) => String(v).padStart(len, '0');
const A = (v: string, len: number) => v.padEnd(len, ' ');
const SP = (len: number) => ' '.repeat(len);

const AFF = '1234567';
const PER = '202611';
const A00 = 'A00' + '00000000000042' + 'A0' + SP(241);
const A01 = 'A01' + AFF + PER + A('SOCIETE TEST', 40) + A('COMMERCE', 40) + A('12 RUE ATLAS', 120) + A('CASABLANCA', 20) + A('20000', 6) + '01' + '20261115' + '20261210';
const a02 = (num: string, name: string, kids: number, pay: number, ded: number, net: number) =>
  'A02' + AFF + PER + num + A(name, 60) + N(kids, 2) + N(pay, 6) + N(ded, 6) + N(net, 6) + SP(155);
// Valid check digits: 100000018, 111111119, 123456785 (see cnssNumberValid).
const A02S = [
  a02('100000018', 'AMRANI ALI', 2, 30000, 0, 30000),
  a02('111111119', 'BENNANI SARA', 0, 0, 0, 0),
  a02('123456785', 'TAZI KARIM', 1, 15000, 0, 15000),
];
// 3 insured, 3 children, AF 450.00 to pay and net, numbers 100000018 + 111111119 + 123456785 = 334567922.
const A03 = 'A03' + AFF + PER + N(3, 6) + N(3, 6) + N(45000, 12) + N(0, 12) + N(45000, 12) + N(334567922, 15) + SP(181);
const PREETABLI = [A00, A01, ...A02S, A03].join('\r\n') + '\r\n';

const parsed = (text = PREETABLI): Preetabli => {
  const r = parsePreetabli(text);
  if (!('file' in r)) throw new Error(r.errors.join('\n'));
  return r.file;
};

describe('e-BDS layout helpers', () => {
  it('pads numbers with zeros and text with spaces, and never truncates a number', () => {
    expect(numField(42, 6)).toBe('000042');
    expect(numField(123n, 3)).toBe('123');
    expect(() => numField(1234, 3)).toThrow(/trop longue/);
    expect(() => numField(-1, 3)).toThrow(/négative/);
    expect(alphaField('Benâni-Él Idrissi', 12)).toBe('BENANI EL ID');
    expect(asciiUpper("  N'Diaye  ")).toBe('N DIAYE');
  });

  it('checks the insured number key and reads both period forms', () => {
    for (const n of ['100000018', '111111119', '123456785']) expect(cnssNumberValid(n)).toBe(true);
    expect(cnssNumberValid('123456784')).toBe(false);
    expect(cnssNumberValid('223456785')).toBe(false);
    expect(cnssNumberValid('12345678')).toBe(false);
    expect(readPeriod('202611')).toEqual({ year: 2026, month: 11, format: 'AAAAMM' });
    expect(readPeriod('112026')).toEqual({ year: 2026, month: 11, format: 'MMAAAA' });
    expect(readPeriod('202613')).toBeNull();
    expect(situationRank('')).toBe(0);
    expect(situationRank('SO')).toBe(1);
    expect(situationRank('MP')).toBe(8);
  });
});

describe('pre-filled file (préétabli)', () => {
  it('reads a valid file: employer, period and each insured person', () => {
    expect([A00, A01, ...A02S, A03].every(l => l.length === EBDS_RECORD_LENGTH)).toBe(true);
    const f = parsed();
    expect(f).toMatchObject({
      affiliate: AFF, periodField: PER, period: { year: 2026, month: 11 }, transferId: '00000000000042', category: 'A0',
      companyName: 'SOCIETE TEST', activity: 'COMMERCE', address: '12 RUE ATLAS', city: 'CASABLANCA', postalCode: '20000', agency: '01',
      issueDate: '20261115', dueDate: '20261210', lineEnding: 'CRLF', warnings: [],
    });
    expect(f.insured.map(p => [p.number, p.name, p.children, p.afNet])).toEqual([
      ['100000018', 'AMRANI ALI', 2, 30000n], ['111111119', 'BENNANI SARA', 0, 0n], ['123456785', 'TAZI KARIM', 1, 15000n],
    ]);
    expect(f.totals).toEqual({ count: 3, children: 3n, afToPay: 45000n, afToDeduct: 0n, afNet: 45000n, numberSum: 334567922n });
  });

  it('accepts LF and CR line ends and a missing final line end', () => {
    expect(parsed([A00, A01, ...A02S, A03].join('\n')).lineEnding).toBe('LF');
    expect(parsed([A00, A01, ...A02S, A03].join('\r')).lineEnding).toBe('CR');
  });

  it('reads Latin-1 bytes position by position (an accented name stays 260 characters)', () => {
    const accented = a02('111111119', 'BENNANI SARA', 0, 0, 0, 0).replace('BENNANI SARA', 'BENNANI SARÉ');
    const text = [A00, A01, A02S[0], accented, A02S[2], A03].join('\r\n');
    const bytes = new Uint8Array([...text].map(ch => ch.charCodeAt(0)));
    const r = parsePreetabli(bytes);
    expect('file' in r && r.file.encoding).toBe('latin1');
    expect('file' in r && r.file.insured[1].name).toBe('BENNANI SARÉ');
  });

  it('refuses a record of the wrong length', () => {
    const r = parsePreetabli([A00, A01, A02S[0].slice(0, 259), A02S[1], A02S[2], A03].join('\n'));
    expect(r).toEqual({ ok: false, errors: ['Ligne 3 : 259 caractères au lieu de 260.'] });
  });

  it('refuses an unknown record and a record out of place', () => {
    expect(parsePreetabli([A00, A01, 'A09' + A02S[0].slice(3), A03].join('\n'))).toEqual({ ok: false, errors: ['Ligne 3 : enregistrement « A09 » inconnu.'] });
    const swapped = parsePreetabli([A01, A00, ...A02S, A03].join('\n'));
    expect('errors' in swapped && swapped.errors).toEqual(expect.arrayContaining(['Ligne 1 : l\'enregistrement A00 doit être le premier.']));
    expect(parsePreetabli('')).toEqual({ ok: false, errors: ['Fichier vide.'] });
  });

  it('refuses a file whose A03 totals do not match its A02 records', () => {
    const badA03 = A03.replace(N(334567922, 15), N(334567921, 15));
    const r = parsePreetabli([A00, A01, ...A02S, badA03].join('\n'));
    expect(r).toEqual({ ok: false, errors: ['A03 : total des immatriculations 334567921 alors que les lignes A02 donnent 334567922.'] });
  });

  it('refuses non-numeric fields, another affiliate on a line and duplicates', () => {
    const badNum = A02S[0].replace('100000018', '10000001X');
    expect(parsePreetabli([A00, A01, badNum, A02S[1], A02S[2], A03].join('\n'))).toMatchObject({ ok: false, errors: ['Ligne 3 : n° d\'immatriculation « 10000001X » non numérique.'] });
    const other = 'A02' + '7654321' + A02S[0].slice(10);
    expect(parsePreetabli([A00, A01, other, A02S[1], A02S[2], A03].join('\n'))).toMatchObject({ ok: false, errors: ['Ligne 3 : n° d\'affiliation ou période différent de A01.'] });
    const dupA03 = 'A03' + AFF + PER + N(2, 6) + N(4, 6) + N(60000, 12) + N(0, 12) + N(60000, 12) + N(200000036, 15) + SP(181);
    expect(parsePreetabli([A00, A01, A02S[0], A02S[0], dupA03].join('\n'))).toMatchObject({ ok: false, errors: ['N° d\'immatriculation 100000018 en double.'] });
  });

  it('warns about an unsorted file and a number whose key does not check', () => {
    const unsorted = [A00, A01, A02S[1], A02S[0], A02S[2], A03].join('\n');
    expect(parsed(unsorted).warnings).toEqual(['Les assurés ne sont pas triés par n° d\'immatriculation.']);
  });
});

describe('matching with employees', () => {
  const employees = [
    { id: 'e1', name: 'Ali Amrani', cnss: '100000018', cin: 'AB123456', hireDate: '2020-03-01', exitDate: null },
    { id: 'e2', name: 'Sara Bennani', cnss: '111 111 119', cin: 'BE1', hireDate: '2025-01-01', exitDate: null },
    { id: 'e3', name: 'Karim Tazi', cnss: '', cin: 'K1', hireDate: '2019-01-01', exitDate: '2026-10-31' },
    { id: 'e4', name: 'Omar Idrissi', cnss: '', cin: 'AB12345', hireDate: '2026-11-10', exitDate: null },
  ];
  const pays = [
    { employeeId: 'e1', days: 26, realSalary: 9500 },
    { employeeId: 'e2', days: 20, realSalary: 3000 },
    { employeeId: 'e4', days: 10, realSalary: 2000.5 },
  ];

  it('matches by CNSS number only, gives the name as a hint, and lists the entrants', () => {
    const f = parsed();
    const { matches, entrants } = matchPreetabli(f, employees, pays);
    expect(matches.map(m => [m.insured.number, m.employee?.id ?? null, m.pay?.days ?? null, m.nameHint?.id ?? null, m.nameDiffers])).toEqual([
      ['100000018', 'e1', 26, null, false],
      ['111111119', 'e2', 20, null, false],
      // Karim has no CNSS number on file: not matched, his name is only a hint.
      ['123456785', null, null, 'e3', false],
    ]);
    expect(entrants.map(x => x.employee.id)).toEqual(['e4']);
    expect(matches.map(m => suggestedSituation(m, f.period))).toEqual(['', '', null]);
    // With his number, Karim matches and, having left in October, is suggested "sortant".
    const withNumber = matchPreetabli(f, employees.map(e => (e.id === 'e3' ? { ...e, cnss: '123456785', name: 'K. Tazi' } : e)), pays);
    expect(withNumber.matches[2]).toMatchObject({ employee: { id: 'e3' }, nameDiffers: true, pay: null });
    expect(suggestedSituation(withNumber.matches[2], f.period)).toBe('SO');
  });
});

describe('declaration file (DS_…)', () => {
  const f = parsed();
  const lines: EbdsDeclaredLine[] = [
    { insured: f.insured[0], situation: '', days: 26, realSalary: 9500 },
    { insured: f.insured[1], situation: '', days: 20, realSalary: 3000 },
    { insured: f.insured[2], situation: 'SO', days: 0, realSalary: 0 },
  ];
  const entrants = [{ number: '', name: 'IDRISSI OMAR', cin: 'AB12345', days: 10, realSalary: 2000.5 }];

  it('writes every record and the control totals', () => {
    const r = generateEbds(f, lines, entrants, { cap: 6000 });
    if (!('content' in r)) throw new Error(r.errors.join('\n'));
    const head = AFF + PER;
    // B02 lines: N_Num_Assure + AF à reverser + jours + salaire réel + salaire plafonné + rang de la situation.
    // Ali:   100000018 + 0 + 26 + 950000 + 600000 + 0     = 101550044
    // Sara:  111111119 + 0 + 20 + 300000 + 300000 + 0     = 111711139
    // Karim: 123456785 + 15000 (AF net returned) + 0 + 0 + 0 + 1 = 123471786
    const b02 = (a02line: string, afRev: number, days: number, real: number, plaf: number, sit: string, ctr: number) =>
      'B02' + a02line.slice(3, 105) + N(afRev, 6) + N(days, 2) + N(real, 13) + N(plaf, 9) + A(sit, 2) + N(ctr, 19) + SP(104);
    const expected = [
      'B00' + '00000000000042' + 'B0' + SP(241),
      'B01' + A01.slice(3),
      b02(A02S[0], 0, 26, 950000, 600000, '', 101550044),
      b02(A02S[1], 0, 20, 300000, 300000, '', 111711139),
      b02(A02S[2], 15000, 0, 0, 0, 'SO', 123471786),
      // 3 insured, the A03 totals, numbers 334567922, AF returned 15000, 46 days, 1,250,000 real, 900,000 capped, control 336732969.
      'B03' + head + N(3, 6) + N(3, 6) + N(45000, 12) + N(0, 12) + N(45000, 12) + N(334567922, 15) + N(15000, 12) + N(46, 6) + N(1250000, 15) + N(900000, 13) + N(336732969, 19) + SP(116),
      // Entrant without a number: 0 + 10 + 200050 + 200050 = 400110.
      'B04' + head + N(0, 9) + A('IDRISSI OMAR', 60) + A('AB12345', 8) + N(10, 2) + N(200050, 13) + N(200050, 9) + N(400110, 19) + SP(124),
      'B05' + head + N(1, 6) + N(0, 15) + N(10, 6) + N(200050, 15) + N(200050, 13) + N(400110, 19) + SP(170),
      // B06 = B03 + B05: 4 people, 56 days, 1,450,050 real, 1,100,050 capped, 336732969 + 400110 = 337133079.
      'B06' + head + N(4, 6) + N(334567922, 15) + N(56, 6) + N(1450050, 15) + N(1100050, 13) + N(337133079, 19) + SP(170),
    ];
    expect(r.records).toEqual(expected);
    expect(r.records.every(l => l.length === 260)).toBe(true);
    expect(r.content).toBe(expected.join('\n') + '\n');
    expect(r.fileName).toBe('DS_1234567_112026.txt');
    expect(r.totals.all).toEqual({ count: 4, numberSum: 334567922n, days: 56n, real: 1450050n, capped: 1100050n, ctr: 337133079n });
    expect(r.warnings).toEqual(['Entrant IDRISSI OMAR : pas de n° CNSS, déclaré avec 000000000.']);
  });

  it('writes one blank B04 when nobody joined, and CRLF on request', () => {
    const r = generateEbds(f, lines, [], { cap: 6000, lineEnding: 'CRLF' });
    if (!('content' in r)) throw new Error(r.errors.join('\n'));
    const head = AFF + PER;
    expect(r.records[6]).toBe('B04' + head + SP(9) + SP(60) + SP(8) + N(0, 2) + N(0, 13) + N(0, 9) + N(0, 19) + SP(124));
    expect(r.records[7]).toBe('B05' + head + N(0, 6) + N(0, 15) + N(0, 6) + N(0, 15) + N(0, 13) + N(0, 19) + SP(170));
    expect(r.records[8].slice(16, 22)).toBe(N(3, 6));
    expect(r.content.split('\r\n')).toHaveLength(10);
  });

  it('zeroes days and salaries for unpaid leave and kept-without-pay', () => {
    const r = generateEbds(f, [lines[0], { ...lines[1], situation: 'CS' }, lines[2]], [], { cap: 6000 });
    if (!('content' in r)) throw new Error(r.errors.join('\n'));
    // Sara CS: 111111119 + 0 + 0 + 0 + 0 + 6.
    expect(r.records[3].slice(105)).toBe(N(0, 6) + N(0, 2) + N(0, 13) + N(0, 9) + 'CS' + N(111111125, 19) + SP(104));
    expect(r.warnings).toEqual(['111111119 BENNANI SARA : situation CS, jours et salaires mis à zéro.']);
  });

  it('refuses a normal line without pay, more than 26 days, a missing person and a bad entrant', () => {
    const noPay = generateEbds(f, [lines[0], lines[1], { ...lines[2], situation: '' }], [], { cap: 6000 });
    expect('errors' in noPay && noPay.errors).toEqual(['123456785 TAZI KARIM : situation normale sans jours ni salaire. Choisissez une situation.']);
    const tooMany = generateEbds(f, [{ ...lines[0], days: 27 }, lines[1], lines[2]], [], { cap: 6000 });
    expect('errors' in tooMany && tooMany.errors).toEqual(['100000018 AMRANI ALI : 27 jours (maximum 26).']);
    const missing = generateEbds(f, [lines[0], lines[2]], [], { cap: 6000 });
    expect('errors' in missing && missing.errors[0]).toBe('Chaque personne du préétabli doit être déclarée une fois, dans l\'ordre du fichier.');
    const bad = generateEbds(f, lines, [{ number: '12345', name: 'X', cin: 'ABCDEFGHIJ', days: 0, realSalary: 0 }], { cap: 6000 });
    expect('errors' in bad && bad.errors).toEqual([
      'Entrant X : n° CNSS « 12345 » de 5 chiffres (9 attendus).', 'Entrant X : 0 jours (1 à 26).', 'Entrant X : salaire nul.',
      'Entrant X : CIN « ABCDEFGHIJ » de plus de 8 caractères.',
    ]);
    const dup = generateEbds(f, lines, [{ number: '100000018', name: 'Y', cin: 'A1', days: 5, realSalary: 900 }], { cap: 6000 });
    expect('errors' in dup && dup.errors).toEqual(['Entrant Y : n° 100000018 déjà dans le préétabli.']);
    const late = generateEbds(f, lines, [{ number: '100000026', name: 'Z', cin: 'A1', days: 5, realSalary: 900, hireDate: '2026-09-01' }], { cap: 6000 });
    expect(late.warnings).toEqual(['Entrant Z : embauché le 2026-09-01, hors de la période déclarée.']);
  });

  it('warns under the SMIG / 26 rule of the sources', () => {
    const r = generateEbds(f, [{ ...lines[0], realSalary: 500 }, lines[1], lines[2]], [], { cap: 6000, smigMonthly: 3422.72 });
    expect(r.warnings).toEqual(['100000018 AMRANI ALI : salaire réel bas pour 26 jours (contrôle SMIG / 26 × (jours − 1)).']);
  });

  it('names the file DS_<affiliate>_<MMAAAA>.txt and writes Latin-1 bytes', () => {
    expect(ebdsFileName('12345', { year: 2027, month: 1 })).toBe('DS_0012345_012027.txt');
    expect([...ebdsBytes('AÉ\n', 'latin1')]).toEqual([0x41, 0xc9, 0x0a]);
    expect([...ebdsBytes('AÉ', 'utf-8')]).toEqual([0x41, 0xc3, 0x89]);
  });
});
