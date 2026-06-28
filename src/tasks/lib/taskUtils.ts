import type { Task } from '@/tasks/types';

// Local YYYY-MM-DD for "today" (due_date is stored as a plain date string).
export function todayStr(): string {
  const d = new Date();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

// A task is overdue when it has a past due date and isn't finished/refused.
export function isOverdue(task: Pick<Task, 'due_date' | 'status'>): boolean {
  if (!task.due_date) return false;
  if (task.status === 'done' || task.status === 'refused') return false;
  return task.due_date < todayStr();
}

// Whether a timestamp falls on the current local day.
export function isToday(iso?: string | null): boolean {
  if (!iso) return false;
  const d = new Date(iso);
  const n = new Date();
  return d.getFullYear() === n.getFullYear() && d.getMonth() === n.getMonth() && d.getDate() === n.getDate();
}
