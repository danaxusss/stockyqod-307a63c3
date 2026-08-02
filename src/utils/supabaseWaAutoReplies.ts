import { supabase } from './supabaseClient';
import { getCompanyContext } from './supabaseCompanyFilter';

export interface WaAutoReply {
  id: string;
  keyword: string;
  match_type: 'exact' | 'contains';
  reply_body: string;
  active: boolean;
  cooldown_hours: number;
}

export class WaAutoRepliesService {
  static async list(): Promise<WaAutoReply[]> {
    const { companyId, bypassFilter } = getCompanyContext();
    let q = (supabase as any).from('wa_auto_replies')
      .select('id, keyword, match_type, reply_body, active, cooldown_hours').order('keyword');
    if (!bypassFilter && companyId) q = q.eq('company_id', companyId);
    const { data, error } = await q;
    if (error) throw error;
    return (data || []) as WaAutoReply[];
  }

  static async save(r: Partial<WaAutoReply> & { keyword: string; reply_body: string }): Promise<void> {
    const { companyId } = getCompanyContext();
    if (!r.keyword.trim()) throw new Error('Mot-clé requis');
    if (!r.reply_body.trim()) throw new Error('Réponse requise');
    const payload = {
      keyword: r.keyword.trim(), match_type: r.match_type || 'exact',
      reply_body: r.reply_body.trim(), active: r.active ?? true,
      cooldown_hours: r.cooldown_hours ?? 24,
    };
    if (r.id) {
      const { error } = await (supabase as any).from('wa_auto_replies').update(payload).eq('id', r.id);
      if (error) throw error;
    } else {
      const { error } = await (supabase as any).from('wa_auto_replies').insert({ company_id: companyId, ...payload });
      if (error) throw error;
    }
  }

  static async setActive(id: string, active: boolean): Promise<void> {
    const { error } = await (supabase as any).from('wa_auto_replies').update({ active }).eq('id', id);
    if (error) throw error;
  }

  static async remove(id: string): Promise<void> {
    const { error } = await (supabase as any).from('wa_auto_replies').delete().eq('id', id);
    if (error) throw error;
  }
}
