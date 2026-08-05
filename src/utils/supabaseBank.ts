import { supabase } from './supabaseClient';
import { getCompanyContext } from './supabaseCompanyFilter';
import { throwEdgeError } from './edgeError';

export interface BankStatementLine {
  id?: string;
  statement_id?: string;
  company_id?: string;
  line_date: string | null;
  label: string | null;
  reference?: string | null;
  debit: number;
  credit: number;
  balance?: number | null;
  matched_entry_line_id?: string | null;
  reconciled?: boolean;
  sort_order?: number;
}

export interface BankStatement {
  id: string;
  company_id: string;
  account_code: string;
  label: string | null;
  bank_name: string | null;
  period_start: string | null;
  period_end: string | null;
  opening_balance: number | null;
  closing_balance: number | null;
  status: 'draft' | 'reconciled';
  created_by: string | null;
  created_at: string;
  lines?: BankStatementLine[];
}

export interface ParsedStatement {
  bank_name: string | null;
  account_code: string | null;
  rib: string | null;
  period_start: string | null;
  period_end: string | null;
  opening_balance: number | null;
  closing_balance: number | null;
  lines: { date: string; label: string; reference?: string | null; debit: number; credit: number; balance?: number | null }[];
}

export class BankService {
  /** Send an image (base64 data URL or raw base64) to the AI parser edge function. */
  static async parseScan(imageBase64: string, mime: string, model?: string | null): Promise<{ model: string; data: ParsedStatement }> {
    const { data, error } = await supabase.functions.invoke('parse-bank-statement', {
      body: { image_base64: imageBase64, mime, model: model || undefined },
    });
    if (error) await throwEdgeError(error, 'parse-bank-statement');
    if ((data as any)?.error) throw new Error((data as any).error);
    return data as { model: string; data: ParsedStatement };
  }

  static async list(): Promise<BankStatement[]> {
    const { companyId, bypassFilter } = getCompanyContext();
    let q = (supabase as any).from('bank_statements').select('*').order('created_at', { ascending: false });
    if (!bypassFilter && companyId) q = q.eq('company_id', companyId);
    const { data, error } = await q;
    if (error) throw error;
    return (data || []) as BankStatement[];
  }

  static async get(id: string): Promise<BankStatement | null> {
    const { data, error } = await (supabase as any).from('bank_statements').select('*, lines:bank_statement_lines(*)').eq('id', id).single();
    if (error) throw error;
    if (!data) return null;
    const s = data as BankStatement;
    s.lines = ((data.lines || []) as BankStatementLine[]).sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));
    return s;
  }

  static async save(header: Partial<BankStatement>, lines: BankStatementLine[]): Promise<BankStatement> {
    const { companyId } = getCompanyContext();
    const { data: stmt, error } = await (supabase as any).from('bank_statements').insert({
      company_id: companyId, account_code: header.account_code || '5141', label: header.label ?? null,
      bank_name: header.bank_name ?? null, period_start: header.period_start ?? null, period_end: header.period_end ?? null,
      opening_balance: header.opening_balance ?? null, closing_balance: header.closing_balance ?? null,
      created_by: header.created_by ?? null,
    }).select().single();
    if (error) throw error;
    const rows = lines.map((l, i) => ({
      statement_id: stmt.id, company_id: companyId, line_date: l.line_date || null, label: l.label || null,
      reference: l.reference || null, debit: Number(l.debit) || 0, credit: Number(l.credit) || 0, balance: l.balance ?? null, sort_order: i,
    }));
    if (rows.length > 0) {
      const { error: e2 } = await (supabase as any).from('bank_statement_lines').insert(rows);
      if (e2) throw e2;
    }
    return stmt as BankStatement;
  }

  static async delete(id: string): Promise<void> {
    const { error } = await (supabase as any).from('bank_statements').delete().eq('id', id);
    if (error) throw error;
  }

  static async setLineReconciled(lineId: string, entryLineId: string | null): Promise<void> {
    const { error } = await (supabase as any).from('bank_statement_lines')
      .update({ matched_entry_line_id: entryLineId, reconciled: !!entryLineId }).eq('id', lineId);
    if (error) throw error;
  }

  /** Recompute the statement status from its lines (all reconciled → 'reconciled'). */
  static async syncStatus(id: string): Promise<void> {
    const s = await this.get(id);
    if (!s) return;
    const lines = s.lines || [];
    const status = lines.length > 0 && lines.every(l => l.reconciled) ? 'reconciled' : 'draft';
    if (status !== s.status) {
      const { error } = await (supabase as any).from('bank_statements').update({ status }).eq('id', id);
      if (error) throw error;
    }
  }
}
