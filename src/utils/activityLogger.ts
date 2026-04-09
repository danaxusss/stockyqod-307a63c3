import { supabase } from './supabaseClient';

export type ActivityAction = 
  | 'login'
  | 'logout'
  | 'quote_created'
  | 'quote_updated'
  | 'quote_deleted'
  | 'quote_finalized'
  | 'products_imported'
  | 'products_deleted'
  | 'user_created'
  | 'user_updated'
  | 'user_deleted'
  | 'template_uploaded'
  | 'template_deleted';

export interface ActivityLog {
  id: string;
  user_id: string | null;
  username: string;
  action: ActivityAction;
  details: string | null;
  entity_type: string | null;
  entity_id: string | null;
  created_at: string;
}

export class ActivityLogger {
  private static getUsername(): string {
    try {
      const stored = localStorage.getItem('inventory_authenticated_user');
      if (stored) {
        const user = JSON.parse(stored);
        return user.username || 'unknown';
      }
    } catch { /* ignore */ }
    return 'unknown';
  }

  private static getUserId(): string | null {
    try {
      const stored = localStorage.getItem('inventory_authenticated_user');
      if (stored) {
        const user = JSON.parse(stored);
        return user.id || null;
      }
    } catch { /* ignore */ }
    return null;
  }

  static async log(action: ActivityAction, details?: string, entityType?: string, entityId?: string): Promise<void> {
    try {
      await supabase.from('activity_logs').insert({
        user_id: this.getUserId(),
        username: this.getUsername(),
        action,
        details: details || null,
        entity_type: entityType || null,
        entity_id: entityId || null,
      });
    } catch (error) {
      console.error('Failed to log activity:', error);
    }
  }

  static async getRecentLogs(limit = 50): Promise<ActivityLog[]> {
    const { data, error } = await supabase
      .from('activity_logs')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(limit);

    if (error) {
      console.error('Failed to fetch activity logs:', error);
      return [];
    }

    return (data || []) as unknown as ActivityLog[];
  }

  static async getLogsByUser(username: string, limit = 50): Promise<ActivityLog[]> {
    const { data, error } = await supabase
      .from('activity_logs')
      .select('*')
      .eq('username', username)
      .order('created_at', { ascending: false })
      .limit(limit);

    if (error) return [];
    return (data || []) as unknown as ActivityLog[];
  }
}
