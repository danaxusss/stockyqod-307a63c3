// Tasks/Delivery module types & display configs.
// Self-contained barrel so ported pages import from '@/tasks/types' instead of
// the app-wide '@/types' (which has different User/UserRole meanings).

export type UserRole = 'super_admin' | 'sales' | 'technician' | 'driver';
export type TaskType = 'technical_intervention' | 'delivery';
export type TaskStatus = 'pending' | 'doing' | 'done' | 'refused';
export type Priority = 'low' | 'medium' | 'high' | 'urgent';
export type ActivityAction = 'created' | 'updated' | 'status_changed' | 'reassigned' | 'commented' | 'archived';

// The current user as seen inside the Tasks module (bridged from the app's auth).
export interface User {
  id: string;
  pin: string;
  first_name: string;
  last_name: string;
  role: UserRole;
  phone?: string;
  avatar_url?: string;
  is_active: boolean;
  created_at: string;
}

export interface Task {
  id: string;
  company_id?: string | null;
  type: TaskType;
  status: TaskStatus;
  client_name: string;
  client_phone: string;
  address: string;
  problem_details?: string;
  invoice_number?: string;
  payment_details?: string;
  comment?: string;
  priority: Priority;
  created_by: string;
  assigned_to: string;
  archived_at?: string;
  due_date?: string;
  created_at: string;
  edited?: boolean;
  updated_at: string;
}

export interface TaskActivity {
  id: string;
  task_id: string;
  user_id: string;
  action: ActivityAction;
  old_value?: string;
  new_value?: string;
  note?: string;
  created_at: string;
}

export interface Contact {
  id: string;
  company_id?: string | null;
  name: string;
  phone: string;
  role_label: string;
  created_by: string;
  created_at: string;
}

export const STATUS_CONFIG: Record<TaskStatus, { label: string; color: string; icon: string; emoji: string }> = {
  pending: { label: 'En attente', color: 'status-pending', icon: 'Clock', emoji: '⏳' },
  doing: { label: 'En cours', color: 'status-doing', icon: 'Loader', emoji: '🔄' },
  done: { label: 'Terminé', color: 'status-done', icon: 'CheckCircle', emoji: '✅' },
  refused: { label: 'Refusé', color: 'status-refused', icon: 'XCircle', emoji: '❌' },
};

export const PRIORITY_CONFIG: Record<Priority, { label: string; color: string }> = {
  low: { label: 'Basse', color: 'priority-low' },
  medium: { label: 'Moyenne', color: 'priority-medium' },
  high: { label: 'Haute', color: 'priority-high' },
  urgent: { label: 'Urgente', color: 'priority-urgent' },
};

export type NotificationType = 'task_assigned' | 'status_changed' | 'task_created' | 'task_reassigned' | 'priority_changed' | 'location_request';

export interface AppNotification {
  id: string;
  user_id: string;
  type: NotificationType;
  title: string;
  message: string;
  task_id?: string;
  is_read: boolean;
  created_at: string;
}

export const NOTIFICATION_CONFIG: Record<NotificationType, { emoji: string; color: string }> = {
  task_assigned: { emoji: '📋', color: 'primary' },
  status_changed: { emoji: '🔄', color: 'status-doing' },
  task_created: { emoji: '✨', color: 'status-done' },
  task_reassigned: { emoji: '🔀', color: 'role-sales' },
  priority_changed: { emoji: '🔥', color: 'destructive' },
  location_request: { emoji: '📍', color: 'primary' },
};

export const ROLE_CONFIG: Record<UserRole, { label: string; color: string; emoji: string }> = {
  super_admin: { label: 'Admin', color: 'role-admin', emoji: '🛡️' },
  sales: { label: 'Commercial', color: 'role-sales', emoji: '💼' },
  technician: { label: 'Technicien', color: 'role-technician', emoji: '🔧' },
  driver: { label: 'Livreur', color: 'role-driver', emoji: '🚚' },
};
