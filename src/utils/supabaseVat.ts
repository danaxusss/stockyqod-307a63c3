// Data of the VAT return page: what it is computed from, the VAT settings,
// and the saved declarations (vat_declarations). The computation itself is
// in accounting/vatReturn.ts.
//
// The owner may deploy before running 20261127120000_vat_return.sql: reads
// still work (settings fall back to their defaults, declarations are read
// without their new columns), and a write that needs the new columns throws
// VatMigrationError, which the page shows as "exécutez la migration".

import { supabase } from './supabaseClient';
import { getCompanyContext } from './supabaseCompanyFilter';
import { isMissingColumnError } from './schemaFallback';
import { isMissingDbObject } from './productCosts';
import { AccountingService, accountingTable } from './supabaseAccounting';
import { SupabaseDocumentsService } from './supabaseDocuments';
import { invalidateCompaniesCache } from './supabaseCompanies';
import { CompanySettingsService, VAT_SETTINGS_COLUMNS, type CompanySettings } from './companySettings';
import { SuppliersService, SupplierInvoicesService, SupplierSchemaMissingError } from './supabaseSuppliers';
import type { Quote, JournalEntry } from '../types';
import type { Supplier, SupplierInvoice, SupplierInvoiceLine, SupplierPayment } from '../accounting/supplierInvoices';
import {
  buildVatEntryLines, DEFAULT_VAT_SETTINGS, VAT_MIGRATION, vatSettingsError,
  type SavedDeclaration, type VatPeriod, type VatReturnResult, type VatSettings,
} from '../accounting/vatReturn';
import { deductionRows, type DeductionRow } from '../accounting/vatDeductionStatement';

export class VatMigrationError extends Error {
  constructor(what: string) {
    super(`${what} : exécutez la migration ${VAT_MIGRATION} dans Supabase.`);
    this.name = 'VatMigrationError';
  }
}

export interface VatDeclarationRow extends SavedDeclaration {
  id: string;
  company_id: string;
  period_type: 'M' | 'T';
  regime: string;
  tva_facturee: number;
  tva_recuperable_biens: number;
  tva_recuperable_charges: number;
  tva_due: number;
  credit_report: number;
  entry_id: string | null;
  status: 'draft' | 'filed';
  filed_at: string | null;
  filed_by?: string | null;
  snapshot?: VatSnapshot | null;
  updated_at?: string;
}

/** What a declaration stores: the result as computed, and the relevé built from it. */
export interface VatSnapshot {
  version: 1;
  computedAt: string;
  computedBy: string | null;
  company: { name: string; if: string; ice: string };
  result: VatReturnResult;
  releve: DeductionRow[];
}

/** Whether a stored snapshot can be shown as the return (written by this version of the page). */
export function isReadableSnapshot(s: unknown): s is VatSnapshot {
  const r = (s as { result?: Partial<VatReturnResult> } | null)?.result;
  return !!r && r.version === 1 && !!r.period?.key && !!r.deadline?.electronic && !!r.sales?.byRate && !!r.deductions?.byCategory && !!r.credit
    && Array.isArray(r.warnings) && !!r.supplierWithholdings && !!r.clientWithholdings;
}

export interface VatData {
  settings: CompanySettings | null;
  vatSettings: VatSettings;
  /** Whether the settings were chosen (periodicity stored). */
  periodicityChosen: boolean;
  settingsAvailable: boolean;
  companyRate: number | null;
  invoices: Quote[];
  avoirs: Quote[];
  suppliersAvailable: boolean;
  suppliers: Supplier[];
  supplierInvoices: SupplierInvoice[];
  supplierLines: Map<string, SupplierInvoiceLine[]>;
  supplierPayments: SupplierPayment[];
  declarations: VatDeclarationRow[];
  /** False when vat_declarations is missing altogether. */
  declarationsAvailable: boolean;
  /** False until the migration adds the snapshot column (read from a row, or unknown without rows). */
  snapshotAvailable: boolean | null;
}

/** The settings of the company as the computation needs them. */
export function vatSettingsFrom(s: Partial<CompanySettings> | null | undefined, fallbackPeriodicity: 'M' | 'T' = DEFAULT_VAT_SETTINGS.periodicity): VatSettings {
  return {
    regime: s?.vat_regime === 'debit' ? 'debit' : 'encaissement',
    periodicity: s?.vat_periodicity === 'M' || s?.vat_periodicity === 'T' ? s.vat_periodicity : fallbackPeriodicity,
    prorata: Number(s?.vat_prorata) > 0 ? Number(s?.vat_prorata) : 100,
    openingCredit: Number(s?.vat_opening_credit) || 0,
    startDate: s?.vat_start_date || null,
  };
}

const num = (v: unknown) => Number(v) || 0;

function toDeclaration(row: Record<string, unknown>): VatDeclarationRow {
  return {
    ...(row as unknown as VatDeclarationRow),
    tva_facturee: num(row.tva_facturee), tva_recuperable_biens: num(row.tva_recuperable_biens), tva_recuperable_charges: num(row.tva_recuperable_charges),
    tva_due: num(row.tva_due), credit_report: num(row.credit_report),
    status: row.status === 'filed' ? 'filed' : 'draft',
    snapshot: (row.snapshot as VatSnapshot | null | undefined) ?? null,
  };
}

export class VatService {
  static async load(): Promise<VatData> {
    const { companyId } = getCompanyContext();
    const settings = await CompanySettingsService.getSettings(companyId || undefined).catch(() => null);
    const [invoices, avoirs] = companyId
      ? await Promise.all([SupabaseDocumentsService.getIssuedInvoicesWithDrafts(companyId), SupabaseDocumentsService.getForLedger('avoir', companyId)])
      : await Promise.all([SupabaseDocumentsService.getAllByType('invoice'), SupabaseDocumentsService.getAllByType('avoir')]);

    let suppliersAvailable = true;
    let suppliers: Supplier[] = [], supplierInvoices: SupplierInvoice[] = [], supplierPayments: SupplierPayment[] = [];
    const supplierLines = new Map<string, SupplierInvoiceLine[]>();
    try {
      [suppliers, supplierInvoices, supplierPayments] = await Promise.all([SuppliersService.list(), SupplierInvoicesService.list(), SupplierInvoicesService.payments()]);
      const paid = [...new Set(supplierPayments.map(p => p.invoice_id))];
      for (const l of await SupplierInvoicesService.lines(paid)) {
        if (!l.invoice_id) continue;
        (supplierLines.get(l.invoice_id) || supplierLines.set(l.invoice_id, []).get(l.invoice_id)!).push(l);
      }
    } catch (e) {
      if (!(e instanceof SupplierSchemaMissingError)) throw e;
      suppliersAvailable = false;
    }

    let declarations: VatDeclarationRow[] = [];
    let declarationsAvailable = true;
    let snapshotAvailable: boolean | null = null;
    try {
      const rows = await AccountingService.listVatDeclarations();
      declarations = rows.map(toDeclaration);
      if (rows.length) snapshotAvailable = rows.some((r: Record<string, unknown>) => 'snapshot' in r);
    } catch (e) {
      if (!isMissingDbObject(e)) throw e;
      declarationsAvailable = false;
    }

    return {
      settings, vatSettings: vatSettingsFrom(settings), periodicityChosen: settings?.vat_periodicity === 'M' || settings?.vat_periodicity === 'T',
      settingsAvailable: settings?.vat_settings_available !== false && !!settings,
      companyRate: settings?.tva_rate ?? null,
      invoices, avoirs, suppliersAvailable, suppliers, supplierInvoices, supplierLines, supplierPayments,
      declarations, declarationsAvailable, snapshotAvailable,
    };
  }

  /** Save the VAT settings only. Refused (VatMigrationError) when the columns do not exist yet. */
  static async saveSettings(s: VatSettings): Promise<void> {
    const err = vatSettingsError(s);
    if (err) throw new Error(err);
    const payload = {
      vat_regime: s.regime, vat_periodicity: s.periodicity, vat_prorata: s.prorata,
      vat_opening_credit: s.openingCredit, vat_start_date: s.startDate || null, updated_at: new Date().toISOString(),
    };
    const { companyId } = getCompanyContext();
    const t = (name: string) => (supabase as unknown as { from(n: string): { update(v: unknown): { eq(c: string, v: string): PromiseLike<{ error: { code?: string; message?: string } | null }> } } }).from(name);
    let error: { code?: string; message?: string } | null;
    if (companyId) {
      ({ error } = await t('companies').update(payload).eq('id', companyId));
    } else {
      const current = await CompanySettingsService.getSettings();
      if (!current) throw new Error('Paramètres de la société introuvables.');
      ({ error } = await t('company_settings').update(payload).eq('id', current.id));
    }
    if (error && isMissingColumnError(error, VAT_SETTINGS_COLUMNS)) throw new VatMigrationError('Réglages TVA non enregistrés');
    if (error) throw new Error(error.message || 'Erreur base de données');
    invalidateCompaniesCache();
  }

  /** The snapshot a declaration stores. */
  static snapshotOf(result: VatReturnResult, company: VatSnapshot['company'], user: string | null): VatSnapshot {
    // A deep copy: what is stored must not move if the page's objects do.
    return JSON.parse(JSON.stringify({ version: 1, computedAt: new Date().toISOString(), computedBy: user, company, result, releve: deductionRows(result) }));
  }

  /**
   * Save the declaration of a period (draft, or filed). A filed declaration is
   * not overwritten: reopen it first. Needs the migration (snapshot column).
   */
  static async saveDeclaration(snapshot: VatSnapshot, status: 'draft' | 'filed', user: string | null, existing?: VatDeclarationRow | null): Promise<VatDeclarationRow> {
    if (existing?.status === 'filed') throw new Error('Cette déclaration est déposée : rouvrez-la avant de la modifier.');
    const r = snapshot.result;
    const assets = r.deductions.byCategory.find(c => c.category === 'immobilisations')?.vatAfterProrata || 0;
    const fy = (await AccountingService.listFiscalYears().catch(() => [])).find(y => y.start_date <= r.period.end && r.period.end <= y.end_date);
    const now = new Date().toISOString();
    const row: Record<string, unknown> = {
      fiscal_year_id: fy?.id ?? null, period_type: r.period.type, period: r.period.key, regime: r.settings.regime,
      tva_facturee: r.sales.totalVat, tva_recuperable_biens: assets, tva_recuperable_charges: Math.round((r.deductions.totalAfterProrata - assets) * 100) / 100,
      tva_due: r.toPay, credit_report: r.creditToCarry, credit_precedent: r.credit.amount, tva_retenue_clients: r.clientWithholdings.total,
      prorata: r.deductions.prorata, period_start: r.period.start, period_end: r.period.end, snapshot, status,
      filed_at: status === 'filed' ? now : null, filed_by: status === 'filed' ? user : null,
    };
    try {
      return toDeclaration(await AccountingService.saveVatDeclaration(row));
    } catch (e) {
      if (isMissingDbObject(e)) throw new VatMigrationError('La table des déclarations de TVA n’existe pas');
      if (isMissingColumnError(e as { code?: string; message?: string })) throw new VatMigrationError('Déclaration non enregistrée');
      throw e;
    }
  }

  /** Set a filed declaration back to draft (the page asks for confirmation first). */
  static async reopenDeclaration(d: VatDeclarationRow, user: string | null): Promise<void> {
    const { error } = await accountingTable('vat_declarations').update({ status: 'draft', filed_at: null, reopened_at: new Date().toISOString(), reopened_by: user }).eq('id', d.id);
    if (error && isMissingColumnError(error)) throw new VatMigrationError('Déclaration non rouverte');
    if (error) throw error;
  }

  /** Source id of the OD entry of a period (kept from the previous page). */
  static entrySourceId(period: Pick<VatPeriod, 'key'>): string { return `tva:${period.key}`; }

  /**
   * DRAFT OD entry of the return (see buildVatEntryLines for what it books).
   * A draft of the same period is replaced; a posted one must be reversed
   * first. Returns the entry.
   */
  static async createEntryDraft(result: VatReturnResult, user: string | null): Promise<JournalEntry> {
    const lines = buildVatEntryLines(result);
    if (!lines.length) throw new Error('Rien à comptabiliser sur cette période.');
    const sourceId = this.entrySourceId(result.period);
    const previous = await AccountingService.entriesForSource(sourceId);
    if (previous.some(e => e.status === 'posted')) {
      throw new Error('L’écriture de TVA de cette période est déjà validée : contre-passez-la dans Saisie / journaux avant d’en créer une autre.');
    }
    for (const e of previous.filter(e => e.status === 'draft')) await AccountingService.deleteDraft(e.id);
    await AccountingService.ensureSeedAccounts([...new Set(lines.map(l => l.account_code))]);
    const journals = await AccountingService.listJournals();
    return AccountingService.createFromDraft({
      journalType: 'od', date: result.period.end, reference: `TVA ${result.period.key}`, label: `Déclaration de TVA ${result.period.label}`,
      sourceType: 'manual', sourceId, lines,
    }, journals, { post: false, createdBy: user });
  }

  /** Posted lines of the fiscal years the period touches, for the ledger comparison. */
  static async ledgerLines(period: Pick<VatPeriod, 'start' | 'end'>) {
    const years = (await AccountingService.listFiscalYears()).filter(y => y.start_date <= period.end && period.start <= y.end_date);
    const out: Array<{ account_code: string; debit: number; credit: number; entry_date: string; source_id?: string | null }> = [];
    for (const y of years) out.push(...(await AccountingService.getPostedLines(y.id)) as typeof out);
    return { lines: out, years: years.length };
  }
}
