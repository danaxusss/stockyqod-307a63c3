import { supabase } from './supabaseClient';
import { getCompanyContext } from './supabaseCompanyFilter';
import { AccountingService, accountingTable } from './supabaseAccounting';
import { readAll } from './readAll';
import {
  defaultAccountsFor, degressiveRefusal, depreciableBase, depreciationSchedule, dotationForYear, isFullyDepreciated, netBookValue,
  type ScheduleRow,
} from '../accounting/depreciation';
import type { Journal } from '../types';

export interface FixedAsset {
  id: string;
  company_id: string;
  label: string;
  account_code: string;
  acquisition_date: string;
  amount: number;
  method: 'lineaire' | 'degressif';
  duration_years: number;
  salvage: number;
  depreciation_account_code: string;
  expense_account_code: string;
  /** Voiture de tourisme: tax deduction capped (CGI art. 10-I-F-1°-b). Column added by migration 20261125130000. */
  passenger_car?: boolean;
  created_by: string | null;
  created_at: string;
  depreciations?: AssetDepreciation[];
}

export interface AssetDepreciation {
  id: string;
  asset_id: string;
  year: number;
  amount: number;
  entry_id: string | null;
}

const r2 = (n: number) => Math.round((Number(n) || 0) * 100) / 100;

// PostgREST answers PGRST204 (or Postgres 42703) for a column the table does not have yet.
const missingColumn = (e: { code?: string; message?: string } | null, col: string) =>
  !!e && (e.code === 'PGRST204' || e.code === '42703') && String(e.message || '').includes(col);

export class AssetsService {
  static async list(): Promise<FixedAsset[]> {
    const { companyId, bypassFilter } = getCompanyContext();
    let q = (supabase as any).from('fixed_assets').select('*, depreciations:fixed_asset_depreciations(*)').order('acquisition_date', { ascending: false });
    if (!bypassFilter && companyId) q = q.eq('company_id', companyId);
    const { data, error } = await q;
    if (error) throw error;
    return (data || []) as FixedAsset[];
  }

  static async create(a: Partial<FixedAsset>): Promise<FixedAsset> {
    const { companyId } = getCompanyContext();
    const accountCode = a.account_code || '2340';
    // Accounts follow the asset's class: 21x → 6191, 22x → 6192, 23x → 6193.
    const defaults = defaultAccountsFor(accountCode);
    const method = a.method || 'lineaire';
    const duration = a.duration_years || 5;
    if (method === 'degressif') {
      const refusal = degressiveRefusal({ account_code: accountCode, passenger_car: a.passenger_car, duration_years: duration });
      if (refusal) throw new Error(refusal);
    }
    const salvage = Number(a.salvage) || 0;
    if (salvage < 0 || (salvage > 0 && salvage >= (Number(a.amount) || 0))) {
      throw new Error('La valeur résiduelle doit être positive et inférieure au montant.');
    }
    const row: Record<string, unknown> = {
      company_id: companyId, label: a.label, account_code: accountCode,
      acquisition_date: a.acquisition_date, amount: a.amount || 0, method,
      duration_years: duration, salvage: a.salvage || 0,
      depreciation_account_code: a.depreciation_account_code || defaults.depreciation,
      expense_account_code: a.expense_account_code || defaults.expense,
      created_by: a.created_by ?? null,
    };
    // Sent only when set, so assets can still be created before the migration adds the column.
    if (a.passenger_car) row.passenger_car = true;
    // Older charts lack 6192/6193/2822: add them so the dotation entry uses accounts of the chart.
    // Not blocking: the asset itself does not need them yet.
    await AccountingService.ensureSeedAccounts([String(row.depreciation_account_code), String(row.expense_account_code)]).catch(() => []);
    const { data, error } = await (supabase as any).from('fixed_assets').insert(row).select().single();
    if (error) {
      if (a.passenger_car && missingColumn(error, 'passenger_car')) {
        throw new Error('La base de données n\'est pas à jour : exécutez la migration 20261125130000_accounting_compliance.sql pour enregistrer une voiture de tourisme.');
      }
      throw error;
    }
    return data as FixedAsset;
  }

  /** Dotation entries generated for the asset (any status), found by their source id. */
  static async depreciationEntries(assetId: string): Promise<{ id: string; source_id: string; status: string }[]> {
    const { companyId } = getCompanyContext();
    const rows = await readAll<{ id: string; source_id: string; status: string }>(() => {
      const q = accountingTable('journal_entries').select('id, source_id, status').eq('source_type', 'depreciation');
      return companyId ? q.eq('company_id', companyId) : q;
    });
    return rows.filter(r => String(r.source_id || '').startsWith(`amort:${assetId}:`));
  }

  /**
   * Delete an asset. Refused once a dotation was booked: the entries stay in
   * the books, and the asset would no longer explain them. A disposal is
   * recorded with its own entry instead.
   */
  static async remove(asset: FixedAsset | string): Promise<void> {
    const id = typeof asset === 'string' ? asset : asset.id;
    const years = typeof asset === 'string' ? [] : (asset.depreciations || []).map(d => d.year);
    const entries = await this.depreciationEntries(id);
    if (years.length > 0 || entries.length > 0) {
      const list = years.length ? ` (${years.sort().join(', ')})` : '';
      throw new Error(`Des dotations ont été comptabilisées pour cette immobilisation${list} : elle ne peut pas être supprimée. Pour une cession ou une mise au rebut, passez l'écriture de sortie dans Saisie / Journaux.`);
    }
    const { error } = await (supabase as any).from('fixed_assets').delete().eq('id', id);
    if (error) throw error;
  }

  /** Annual straight-line depreciation base amount. */
  static annualAmount(a: FixedAsset): number {
    return a.duration_years > 0 ? r2(depreciableBase(a) / a.duration_years) : 0;
  }

  /**
   * Dotation for one year: linear (prorated by month in the year of
   * acquisition, the last year takes what is left) or declining balance
   * (CGI coefficients, switch to straight line): see accounting/depreciation.
   */
  static dotationForYear(a: FixedAsset, year: number): number {
    return dotationForYear(a, year);
  }

  static schedule(a: FixedAsset): ScheduleRow[] {
    return depreciationSchedule(a);
  }

  /** Cumulative depreciation already booked. */
  static cumulative(a: FixedAsset): number {
    return r2((a.depreciations || []).reduce((s, d) => s + (Number(d.amount) || 0), 0));
  }

  /** Net book value: cost less booked depreciation, never below the salvage value. */
  static netBookValue(a: FixedAsset): number {
    return netBookValue(a);
  }

  /**
   * Generate + post the dotation for a given year: D 619x / C 28xx, then record
   * the depreciation row. Caps the last annuity to not exceed the base.
   */
  static async generateDotation(asset: FixedAsset, year: number, journals: Journal[], user: string | null): Promise<void> {
    if ((asset.depreciations || []).some(d => d.year === year)) throw new Error(`Dotation ${year} déjà générée`);
    const { companyId } = getCompanyContext();
    if (year < Number(String(asset.acquisition_date).slice(0, 4))) throw new Error(`Immobilisation acquise après ${year}`);
    if (isFullyDepreciated(asset)) throw new Error('Immobilisation totalement amortie');
    const amount = this.dotationForYear(asset, year);
    if (amount <= 0) throw new Error('Rien à amortir pour cet exercice');

    const entry = await AccountingService.createFromDraft(
      {
        journalType: 'od', date: `${year}-12-31`, reference: `DA ${year}`,
        label: `Dotation amortissement ${year} - ${asset.label}`, sourceType: 'depreciation', sourceId: `amort:${asset.id}:${year}`,
        lines: [
          { account_code: asset.expense_account_code, label: `Dotation ${asset.label}`, debit: amount, credit: 0 },
          { account_code: asset.depreciation_account_code, label: `Amort. ${asset.label}`, debit: 0, credit: amount },
        ],
      },
      journals, { post: true, createdBy: user },
    );

    const { error } = await (supabase as any).from('fixed_asset_depreciations').insert({
      asset_id: asset.id, company_id: companyId, year, amount, entry_id: entry.id,
    });
    if (error) throw error;
  }
}
