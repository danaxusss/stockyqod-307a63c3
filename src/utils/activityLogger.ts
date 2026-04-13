import { activityApi } from '@/lib/apiClient';

export type ActivityAction =
  | 'login' | 'logout'
  | 'quote_created' | 'quote_updated' | 'quote_deleted' | 'quote_finalized'
  | 'products_imported' | 'products_deleted'
  | 'user_created' | 'user_updated' | 'user_deleted'
  | 'template_uploaded' | 'template_deleted';

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
  static async log(action: ActivityAction, details?: string, entityType?: string, entityId?: string): Promise<void> {
    try {
      await activityApi.log(action, details, entityType, entityId);
    } catch (error) {
      console.error('Failed to log activity:', error);
    }
  }

  static async getRecentLogs(limit = 50): Promise<ActivityLog[]> {
    try {
      const { logs } = await activityApi.getRecent(limit);
      return logs as ActivityLog[];
    } catch {
      return [];
    }
  }

  static async getLogsByUser(username: string, limit = 50): Promise<ActivityLog[]> {
    try {
      const { logs } = await activityApi.getByUser(username, limit);
      return logs as ActivityLog[];
    } catch {
      return [];
    }
  }
}
