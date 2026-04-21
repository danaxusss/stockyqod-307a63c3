import { supabase } from './supabaseClient';
import { Return, ReturnItem } from '../types';
import { getCompanyContext } from './supabaseCompanyFilter';

type ReturnRow = {
  id: string;
  company_id: string | null;
  reference_document_id: string | null;
  reference_number: string;
  client_name: string;
  reason: string;
  items: unknown;
  status: string;
  notes: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

function mapRow(r: ReturnRow): Return {
  return {
    id: r.id,
    company_id: r.company_id || undefined,
    reference_document_id: r.reference_document_id || undefined,
    reference_number: r.reference_number,
    client_name: r.client_name,
    reason: r.reason,
    items: (Array.isArray(r.items) ? r.items : []) as ReturnItem[],
    status: (r.status || 'open') as Return['status'],
    notes: r.notes || undefined,
    created_by: r.created_by || undefined,
    created_at: r.created_at,
    updated_at: r.updated_at,
  };
}

export class SupabaseReturnsService {
  static async getAll(): Promise<Return[]> {
    const { companyId, isSuperAdmin } = getCompanyContext();
    let q = (supabase.from('returns') as any).select('*').order('created_at', { ascending: false });
    if (!isSuperAdmin && companyId) q = q.eq('company_id', companyId);
    const { data, error } = await q;
    if (error) throw error;
    return ((data as ReturnRow[]) || []).map(mapRow);
  }

  static async create(payload: {
    reference_number: string;
    client_name: string;
    reason: string;
    items: ReturnItem[];
    notes?: string;
    reference_document_id?: string;
  }): Promise<Return> {
    const { companyId } = getCompanyContext();
    const { data, error } = await (supabase.from('returns') as any)
      .insert({
        reference_number: payload.reference_number,
        client_name: payload.client_name,
        reason: payload.reason,
        items: payload.items,
        notes: payload.notes || null,
        reference_document_id: payload.reference_document_id || null,
        status: 'open',
        ...(companyId ? { company_id: companyId } : {}),
      })
      .select('*')
      .single();
    if (error) throw error;
    return mapRow(data as ReturnRow);
  }

  static async update(id: string, updates: Partial<{
    status: 'open' | 'closed';
    notes: string;
    items: ReturnItem[];
  }>): Promise<Return> {
    const { data, error } = await (supabase.from('returns') as any)
      .update({ ...updates, updated_at: new Date().toISOString() })
      .eq('id', id)
      .select('*')
      .single();
    if (error) throw error;
    return mapRow(data as ReturnRow);
  }

  static async delete(id: string): Promise<void> {
    const { error } = await (supabase.from('returns') as any).delete().eq('id', id);
    if (error) throw error;
  }
}
