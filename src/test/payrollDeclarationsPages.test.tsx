// The two declaration-file tabs (annual 9421 return, Damancom e-BDS) and the
// "Déclarations" group of the employee form, on the in-memory database —
// with and without the 20261126140000_payroll_declarations.sql migration.
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createFakeDb, fakeClient, type FakeDb } from './fakeSupabase';

const state = vi.hoisted(() => ({ db: null as unknown as FakeDb, downloads: [] as { name: string; blob: Blob }[] }));
vi.mock('../utils/supabaseClient', () => ({ get supabase() { return fakeClient(state.db); } }));
vi.mock('../integrations/supabase/client', () => ({ get supabase() { return fakeClient(state.db); } }));
vi.mock('@/integrations/supabase/client', () => ({ get supabase() { return fakeClient(state.db); } }));
vi.mock('../utils/supabaseCompanyFilter', () => ({
  getCompanyContext: () => ({ companyId: 'c1', bypassFilter: true, isSuperAdmin: true, isCompta: false }),
}));
vi.mock('../hooks/useAuth', () => ({ useAuth: () => ({ isPaie: true, isSuperAdmin: false, companyId: 'c1', currentUser: { username: 'rh' } }) }));
const showToast = vi.hoisted(() => vi.fn());
vi.mock('../context/ToastContext', () => ({ useToast: () => ({ showToast }) }));
vi.mock('../utils/companySettings', () => ({
  CompanySettingsService: {
    getSettings: vi.fn(async () => ({
      company_name: 'Société Test', if_number: '12345678', ice: '001', rc: 'RC123', cnss: '1234567', patente: '45678901',
      address: '12 rue Atlas, Casablanca', phone: '0522000000', email: 'paie@test.ma',
    })),
  },
}));
vi.mock('../pages/paie/declarations/download', async () => ({
  ...(await vi.importActual<object>('../pages/paie/declarations/download')),
  downloadBlob: (name: string, blob: Blob) => { state.downloads.push({ name, blob }); },
}));

import DeclarationsPage from '../pages/paie/DeclarationsPage';
import EmployeesPage from '../pages/paie/EmployeesPage';

const MISSING_TABLE = (t: string) => `Could not find the table 'public.${t}' in the schema cache`;

const readBytes = (b: Blob) => new Promise<Uint8Array>((resolve, reject) => {
  const r = new FileReader();
  r.onload = () => resolve(new Uint8Array(r.result as ArrayBuffer));
  r.onerror = () => reject(r.error);
  r.readAsArrayBuffer(b);
});
const readText = async (b: Blob) => new TextDecoder('utf-8').decode(await readBytes(b));

const ali = {
  id: 'e1', company_id: 'c1', full_name: 'Ali Amrani', last_name: 'AMRANI', first_name: 'Ali', cin: 'AB123456', cnss_number: '100000018',
  marital_status: 'marie', dependents_count: 2, contract_type: 'CDI', base_salary: 10000, is_active: true, hire_date: '2020-03-01',
  address: '1 rue A, Casablanca', matricule: 'M001',
};
const sara = { id: 'e2', company_id: 'c1', full_name: 'Sara Bennani', cnss_number: '111111119', dependents_count: 0, contract_type: 'CDD', base_salary: 3000, is_active: true, cin: 'BE1' };
const omar = { id: 'e4', company_id: 'c1', full_name: 'Omar Idrissi', cnss_number: '', cin: 'AB12345', dependents_count: 0, contract_type: 'CDD', base_salary: 2000, is_active: true, hire_date: '2026-11-10' };

const payslip = (id: string, employee_id: string, month: number, extra: Record<string, unknown> = {}) => ({
  id, company_id: 'c1', employee_id, period_month: month, period_year: 2026, payslip_number: id, hours_worked: 191, base_salary: 10000,
  total_gross: 10000, ir_taxable_gross: 9500, net_taxable: 6641.5, cnss_base: 9500, frais_pro: 2375, cnss_employee: 268.8, amo_employee: 214.7,
  ir_amount: 800, cnss_days: 26, dependents_count: 2, is_locked: true, ...extra,
});

beforeEach(() => {
  state.downloads = [];
  state.db = createFakeDb({
    employees: [ali, sara, omar], payslips: [], payslip_variables: [], payslip_items: [], payroll_settings: [], payroll_rubriques: [],
    payroll_declaration_settings: [], payroll_ir_payments: [],
  });
  vi.spyOn(window, 'confirm').mockReturnValue(true);
});
afterEach(() => { vi.restoreAllMocks(); showToast.mockReset(); });

const renderPage = () => render(<MemoryRouter><DeclarationsPage /></MemoryRouter>);
const openTab = async (label: string, year = '2026') => {
  renderPage();
  fireEvent.click(await screen.findByRole('tab', { name: label }));
  fireEvent.change(screen.getByLabelText('Année'), { target: { value: year } });
};

describe('annual salary return tab (9421)', () => {
  beforeEach(() => {
    state.db.tables.payslips.push(payslip('p1', 'e1', 1), payslip('p2', 'e1', 2), payslip('p3', 'e1', 3, { is_locked: false }));
    state.db.tables.payroll_declaration_settings.push({ id: 'd1', company_id: 'c1', commune_code: '141.01.01', family_field_as_amount: false });
  });

  it('shows the deadline, the checks and the annual figures, and exports the XML', async () => {
    await openTab('Déclaration annuelle (9421)');
    expect(await screen.findByText(/Montants annuels par personne \(1\)/)).toBeTruthy();
    expect(screen.getByText(/avant le 1er mars 2027/)).toBeTruthy();
    expect(screen.getByText(/contrôlez-le sur SIMPL avant de le valider et de le déposer/)).toBeTruthy();
    expect(screen.getByText(/1 bulletin\(s\) de 2026 encore en brouillon/)).toBeTruthy();
    // March is a draft: a month without a validated payslip.
    expect(screen.getByText('Mois sans bulletin validé').parentElement!.textContent).toContain('Mars');
    // IR recomputed on 13,283 of net taxable: nothing due, 1,600 withheld.
    expect(screen.getByText(/1\s600,00 retenu en trop/)).toBeTruthy();
    expect(screen.getByText('TPP.25.2009')).toBeTruthy();
    // No payment entered for January and February.
    expect(screen.getAllByText(/aucun versement saisi/)).toHaveLength(2);

    fireEvent.click(screen.getByText('XML seul'));
    expect(state.downloads.map(d => d.name)).toEqual(['DTS_9421_12345678_2026.xml']);
    const xml = await readText(state.downloads[0].blob);
    expect(xml).toMatch(/^<\?xml version="1.0" encoding="UTF-8"\?>\r\n<TraitementEtSalaire /);
    expect(xml).toContain('<identifiantFiscal>12345678</identifiantFiscal>');
    expect(xml).toContain('<code>141.01.01</code>');
    expect(xml).toContain('<mtRevenuNetImposable>13283.00</mtRevenuNetImposable>');

    fireEvent.click(screen.getByText('Fichier SIMPL (XML zippé)'));
    expect(state.downloads[1].name).toBe('DTS_9421_12345678_2026.zip');
    const zip = await readBytes(state.downloads[1].blob);
    expect([...zip.slice(0, 2)]).toEqual([0x50, 0x4b]); // "PK"
    fireEvent.click(screen.getByText('État récapitulatif (CSV)'));
    expect(await readText(state.downloads[2].blob)).toContain('AMRANI;Ali');
  });

  it('records an IR payment and the commune code', async () => {
    state.db.strictUpsert = true;
    await openTab('Déclaration annuelle (9421)');
    await screen.findByText(/Montants annuels par personne/);
    fireEvent.change(screen.getByLabelText('Principal'), { target: { value: '800' } });
    fireEvent.change(screen.getByLabelText('Date du versement'), { target: { value: '2026-02-10' } });
    fireEvent.change(screen.getByLabelText('N° de quittance'), { target: { value: 'Q-01' } });
    fireEvent.click(screen.getByText('Ajouter'));
    await waitFor(() => expect(state.db.tables.payroll_ir_payments).toHaveLength(1));
    expect(state.db.tables.payroll_ir_payments[0]).toMatchObject({ company_id: 'c1', year: 2026, month: 1, principal: 800, payment_mode: 'SIR', receipt_number: 'Q-01' });
    expect(await screen.findByText(/2026-02-10 · Télépaiement · Q-01/)).toBeTruthy();
    expect(screen.getAllByText(/aucun versement saisi/)).toHaveLength(1);

    fireEvent.change(screen.getByLabelText('Code commune DGI *'), { target: { value: '001.01.01' } });
    fireEvent.click(screen.getByText('Enregistrer'));
    await waitFor(() => expect(state.db.tables.payroll_declaration_settings[0].commune_code).toBe('001.01.01'));
  });

  it('blocks the XML while something required is missing, unless asked to go on', async () => {
    state.db.tables.payroll_declaration_settings = [];
    state.db.tables.employees[0] = { ...ali, address: '', marital_status: null };
    await openTab('Déclaration annuelle (9421)');
    await screen.findByText(/Informations manquantes \(3 bloquante\(s\)\)/);
    const list = screen.getByText(/Informations manquantes/).parentElement!;
    expect(within(list).getByText('Code commune DGI manquant.')).toBeTruthy();
    expect(within(list).getByText('Adresse personnelle manquante.')).toBeTruthy();
    expect(within(list).getByText('Situation familiale manquante.')).toBeTruthy();
    expect(within(list).getAllByText('Fiche employé')[0].getAttribute('href')).toBe('/paie/employes');
    const xmlButton = screen.getByText('XML seul').closest('button')!;
    expect(xmlButton.disabled).toBe(true);
    fireEvent.click(screen.getByLabelText(/Générer malgré 3 information\(s\) manquante\(s\)/));
    expect(xmlButton.disabled).toBe(false);
  });

  it('still works before the migration: older payslips rebuilt from their lines, nothing saved', async () => {
    state.db.failRead = t => (t === 'payroll_declaration_settings' || t === 'payroll_ir_payments' ? MISSING_TABLE(t) : undefined);
    // A payslip saved before the 2026 columns: bases from its lines (800 transport, 500 exempt).
    state.db.tables.payslips = [payslip('old', 'e1', 1, { ir_taxable_gross: null, net_taxable: null, cnss_base: null, total_gross: 10800, base_salary: 10000 })];
    state.db.tables.payslip_variables.push({ id: 'v1', payslip_id: 'old', label: 'Transport', type: 'gain', amount: 800, soumis_cnss: false, soumis_ir: false,
      ir_ceiling_type: 'amount', ir_ceiling_value: 500, cnss_ceiling_type: 'amount', cnss_ceiling_value: 500, sort_order: 0 });
    await openTab('Déclaration annuelle (9421)');
    expect(await screen.findByText(/Base de données pas à jour : exécutez la migration 20261126140000_payroll_declarations.sql/)).toBeTruthy();
    expect(screen.getByText(/Bases imposables reconstituées depuis les lignes des bulletins \(1 mois\)/)).toBeTruthy();
    // 10,000 + 10 % seniority (hired 2020) + 300 of transport above its 500 ceiling.
    const row = screen.getByText('AMRANI Ali').closest('tr')!;
    expect(within(row).getAllByText(/11\s300,00/).length).toBeGreaterThan(0);
    expect((screen.getByText('Enregistrer').closest('button') as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByText('Ajouter').closest('button') as HTMLButtonElement).disabled).toBe(true);
  });
});

// The same hand-written préétabli as cnssEbds.test.ts.
const N = (v: string | number, len: number) => String(v).padStart(len, '0');
const A = (v: string, len: number) => v.padEnd(len, ' ');
const SP = (len: number) => ' '.repeat(len);
const head = '1234567202611';
const a02 = (num: string, name: string, kids: number, af: number) => 'A02' + head + num + A(name, 60) + N(kids, 2) + N(af, 6) + N(0, 6) + N(af, 6) + SP(155);
const PREETABLI = [
  'A00' + '00000000000042' + 'A0' + SP(241),
  'A01' + head + A('SOCIETE TEST', 40) + A('COMMERCE', 40) + A('12 RUE ATLAS', 120) + A('CASABLANCA', 20) + A('20000', 6) + '01' + '20261115' + '20261210',
  a02('100000018', 'AMRANI ALI', 2, 30000), a02('111111119', 'BENNANI SARA', 0, 0), a02('123456785', 'TAZI KARIM', 1, 15000),
  'A03' + head + N(3, 6) + N(3, 6) + N(45000, 12) + N(0, 12) + N(45000, 12) + N(334567922, 15) + SP(181),
].join('\r\n') + '\r\n';

describe('Damancom e-BDS tab', () => {
  beforeEach(() => {
    state.db.tables.payslips.push(
      payslip('n1', 'e1', 11, { cnss_base: 9500, cnss_days: 26 }),
      payslip('n2', 'e2', 11, { cnss_base: 3000, cnss_days: 20 }),
      payslip('n4', 'e4', 11, { cnss_base: 2000.5, cnss_days: 10 }),
    );
  });

  const upload = async (content: string, name = 'AFFEBDS_1234567_202611.txt') => {
    fireEvent.change(screen.getByLabelText('Mois'), { target: { value: '11' } });
    const input = await screen.findByLabelText('Fichier préétabli');
    fireEvent.change(input, { target: { files: [new File([content], name, { type: 'text/plain' })] } });
  };

  it('says the format is not verified, reads the file, matches and generates the declaration', async () => {
    await openTab('Fichier Damancom (e-BDS)');
    expect(await screen.findAllByText('Format établi à partir de descriptions non officielles : testez le dépôt sur Damancom (contrôle du fichier) avant toute déclaration réelle, et envoyez-nous un fichier préétabli réel pour validation.')).toHaveLength(1);
    await upload(PREETABLI);
    const table = (await screen.findByText('Assurés du préétabli (3)')).closest('section')!;
    expect(within(table).getByText('Ali Amrani')).toBeTruthy();
    expect(within(table).getByText(/Aucun employé avec ce n° CNSS/)).toBeTruthy();
    expect(screen.getByText('Entrants : bulletin validé, absents du préétabli (1)').closest('section')!.textContent).toContain('Omar Idrissi');

    // Karim has no payslip: a situation must be chosen first.
    fireEvent.click(screen.getByText('Générer le fichier de déclaration'));
    expect(await screen.findByText(/123456785 TAZI KARIM : choisissez une situation/)).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Situation de TAZI KARIM'), { target: { value: 'SO' } });
    fireEvent.click(screen.getByText('Générer le fichier de déclaration'));
    const button = await screen.findByText(/Télécharger DS_1234567_112026.txt \(non vérifié\)/);
    expect(screen.getAllByText(/Format établi à partir de descriptions non officielles/)).toHaveLength(2);
    fireEvent.click(button);
    expect(state.downloads[0].name).toBe('DS_1234567_112026.txt');
    const lines = new TextDecoder('latin1').decode(await readBytes(state.downloads[0].blob)).split('\n');
    expect(lines.map(l => l.slice(0, 3))).toEqual(['B00', 'B01', 'B02', 'B02', 'B02', 'B03', 'B04', 'B05', 'B06', '']);
    expect(lines[8]).toBe('B06' + head + N(4, 6) + N(334567922, 15) + N(56, 6) + N(1450050, 15) + N(1100050, 13) + N(337133079, 19) + SP(170));
    // No separate surname / first name on the employee: the full name as typed.
    expect(lines[6].slice(16, 25 + 60)).toBe(N(0, 9) + A('OMAR IDRISSI', 60));
  });

  it('refuses a file with a wrong record and one for another month', async () => {
    await openTab('Fichier Damancom (e-BDS)');
    await upload(PREETABLI.replace('A03', 'A09'));
    expect(await screen.findByText(/Fichier refusé \(lecture stricte\)/)).toBeTruthy();
    expect(screen.getByText('Ligne 6 : enregistrement « A09 » inconnu.')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Mois'), { target: { value: '10' } });
    const input = await screen.findByLabelText('Fichier préétabli');
    fireEvent.change(input, { target: { files: [new File([PREETABLI], 'AFFEBDS.txt')] } });
    expect(await screen.findByText(/Ce préétabli est pour 11\/2026, pas pour octobre 2026/)).toBeTruthy();
    expect(screen.queryByText('Générer le fichier de déclaration')).toBeNull();
  });
});

describe('employee form: the "Déclarations" group', () => {
  const openForm = async () => {
    render(<MemoryRouter><EmployeesPage /></MemoryRouter>);
    fireEvent.click(await screen.findByText('Nouvel employé'));
    fireEvent.change(screen.getByLabelText('Nom complet *'), { target: { value: 'Nadia Tahiri' } });
    fireEvent.change(screen.getByLabelText('Salaire de base (MAD)'), { target: { value: '5000' } });
  };

  it('saves the return data with the employee', async () => {
    await openForm();
    expect(screen.getByText('Déclarations')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Nom'), { target: { value: 'TAHIRI' } });
    fireEvent.change(screen.getByLabelText('Prénom'), { target: { value: 'Nadia' } });
    fireEvent.change(screen.getByLabelText('Adresse personnelle'), { target: { value: '5 rue B' } });
    fireEvent.change(screen.getByLabelText('Liste de la déclaration 9421'), { target: { value: 'exonere_57_20' } });
    fireEvent.click(screen.getByText('Enregistrer'));
    await waitFor(() => expect(state.db.tables.employees).toHaveLength(4));
    expect(state.db.tables.employees[3]).toMatchObject({ full_name: 'Nadia Tahiri', last_name: 'TAHIRI', first_name: 'Nadia', address: '5 rue B', dts_category: 'exonere_57_20' });
  });

  it('before the migration: saves without the new fields when they are empty, refuses when they are filled', async () => {
    const declarationCols = ['last_name', 'first_name', 'address', 'residence_card', 'tax_id', 'dts_category'];
    state.db.failWrite = (table, _op, payload) => {
      const col = table === 'employees' ? declarationCols.find(c => c in (payload as Record<string, unknown>)) : undefined;
      return col ? `Could not find the '${col}' column of 'employees' in the schema cache` : undefined;
    };
    await openForm();
    fireEvent.change(screen.getByLabelText('Adresse personnelle'), { target: { value: '5 rue B' } });
    fireEvent.click(screen.getByText('Enregistrer'));
    await waitFor(() => expect(showToast).toHaveBeenCalled());
    expect(showToast.mock.calls[0][0].message).toMatch(/ne peuvent pas être enregistrées.*20261126140000_payroll_declarations\.sql/);
    expect(state.db.tables.employees).toHaveLength(3);

    fireEvent.change(screen.getByLabelText('Adresse personnelle'), { target: { value: '' } });
    fireEvent.click(screen.getByText('Enregistrer'));
    await waitFor(() => expect(state.db.tables.employees).toHaveLength(4));
    expect(Object.keys(state.db.tables.employees[3]).some(k => declarationCols.includes(k))).toBe(false);
  });
});
