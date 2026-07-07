import { supabase } from './supabaseClient';
import { getCompanyContext } from './supabaseCompanyFilter';
import { AccountingService } from './supabaseAccounting';
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
    const { data, error } = await (supabase as any).from('fixed_assets').insert({
      company_id: companyId, label: a.label, account_code: a.account_code || '2340',
      acquisition_date: a.acquisition_date, amount: a.amount || 0, method: a.method || 'lineaire',
      duration_years: a.duration_years || 5, salvage: a.salvage || 0,
      depreciation_account_code: a.depreciation_account_code || '2834', expense_account_code: a.expense_account_code || '6191',
      created_by: a.created_by ?? null,
    }).select().single();
    if (error) throw error;
    return data as FixedAsset;
  }

  static async remove(id: string): Promise<void> {
    const { error } = await (supabase as any).from('fixed_assets').delete().eq('id', id);
    if (error) throw error;
  }

  /** Annual straight-line depreciation base amount. */
  static annualAmount(a: FixedAsset): number {
    const base = (Number(a.amount) || 0) - (Number(a.salvage) || 0);
    return a.duration_years > 0 ? r2(base / a.duration_years) : 0;
  }

  /** Cumulative depreciation already booked. */
  static cumulative(a: FixedAsset): number {
    return r2((a.depreciations || []).reduce((s, d) => s + (Number(d.amount) || 0), 0));
  }

  /**
   * Generate + post the dotation for a given year: D 619x / C 28xx, then record
   * the depreciation row. Caps the last annuity to not exceed the base.
   */
  static async generateDotation(asset: FixedAsset, year: number, fiscalYearId: string, journals: Journal[], user: string | null): Promise<void> {
    if ((asset.depreciations || []).some(d => d.year === year)) throw new Error(`Dotation ${year} déjà générée`);
    const { companyId } = getCompanyContext();
    const base = (Number(asset.amount) || 0) - (Number(asset.salvage) || 0);
    const already = this.cumulative(asset);
    const remaining = r2(base - already);
    if (remaining <= 0) throw new Error('Immobilisation totalement amortie');
    const amount = r2(Math.min(this.annualAmount(asset), remaining));

    const entry = await AccountingService.createFromDraft(
      {
        journalType: 'od', date: `${year}-12-31`, reference: `DA ${year}`,
        label: `Dotation amortissement ${year} - ${asset.label}`, sourceType: 'depreciation', sourceId: `amort:${asset.id}:${year}`,
        lines: [
          { account_code: asset.expense_account_code, label: `Dotation ${asset.label}`, debit: amount, credit: 0 },
          { account_code: asset.depreciation_account_code, label: `Amort. ${asset.label}`, debit: 0, credit: amount },
        ],
      },
      fiscalYearId, journals, { post: true, createdBy: user },
    );

    const { error } = await (supabase as any).from('fixed_asset_depreciations').insert({
      asset_id: asset.id, company_id: companyId, year, amount, entry_id: entry.id,
    });
    if (error) throw error;
  }
}
