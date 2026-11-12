import { useState, type ReactNode } from 'react';
import { CalendarDays, Clock3, MapPin, Pencil, Truck, Wrench } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { Task, TaskStatus, User } from '@/tasks/types';
import { PriorityBadge, StatusBadge } from '@/tasks/components/StatusBadge';
import { useLanguage } from '@/tasks/contexts/LanguageContext';
import { isOverdue } from '@/tasks/lib/taskUtils';

const BOARD_STATUSES: TaskStatus[] = ['pending', 'doing', 'done', 'refused'];

const STATUS_DOT: Record<TaskStatus, string> = {
  pending: 'bg-status-pending',
  doing: 'bg-status-doing',
  done: 'bg-status-done',
  refused: 'bg-status-refused',
};

/** Wrench for an intervention, truck for a delivery. */
export function TaskTypeIcon({ type, className }: { type: Task['type']; className?: string }) {
  const { t } = useLanguage();
  const Icon = type === 'delivery' ? Truck : Wrench;
  return (
    <span className={cn('flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary', className)}
      title={type === 'delivery' ? t('salesTasks.delivery') : t('salesTasks.intervention')}>
      <Icon className="h-4 w-4" aria-hidden="true" />
      <span className="sr-only">{type === 'delivery' ? t('salesTasks.delivery') : t('salesTasks.intervention')}</span>
    </span>
  );
}

function initials(user?: Pick<User, 'first_name' | 'last_name'> | null): string {
  return [user?.first_name, user?.last_name].map(part => (part || '').trim()[0] || '').join('').toUpperCase();
}

/**
 * The card of one task: type, client, address, priority, due date and the
 * assignee (initials only when there is a name). `actions` sits in the
 * footer, `children` under the address.
 */
export function TaskCard({ task, assignee, showAssignee = true, showStatus = false, onOpen, actions, children, className }: {
  task: Task;
  assignee?: Pick<User, 'first_name' | 'last_name'> | null;
  /** Off on the assignee's own list, where it would always be them. */
  showAssignee?: boolean;
  showStatus?: boolean;
  /** Makes the client name a button (open / edit the task). */
  onOpen?: () => void;
  actions?: ReactNode;
  children?: ReactNode;
  className?: string;
}) {
  const { t, language } = useLanguage();
  const dateLocale = language === 'ar' ? 'ar-MA' : 'fr-FR';
  const overdue = isOverdue(task);
  const assigneeName = [assignee?.first_name, assignee?.last_name].filter(Boolean).join(' ').trim();
  const title = <span className="block truncate font-semibold text-foreground">{task.client_name}</span>;

  return (
    <article className={cn('rounded-xl border border-border bg-card p-3.5 shadow-sm', className)}>
      <div className="flex items-start gap-3">
        <TaskTypeIcon type={task.type} />
        <div className="min-w-0 flex-1">
          {onOpen ? (
            <button type="button" onClick={onOpen} className="group flex max-w-full items-center gap-1.5 text-start">
              {title}
              <Pencil className="h-3.5 w-3.5 shrink-0 text-muted-foreground opacity-0 transition group-hover:opacity-100 group-focus-visible:opacity-100" aria-hidden="true" />
            </button>
          ) : title}
          {task.address && (
            <p className="mt-0.5 flex items-start gap-1 text-sm text-muted-foreground">
              <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              <span className="line-clamp-2">{task.address}</span>
            </p>
          )}
        </div>
      </div>

      <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
        {showStatus && <StatusBadge status={task.status} label={t(`status.${task.status}`)} />}
        <PriorityBadge priority={task.priority} />
        {overdue && (
          <span className="inline-flex items-center gap-1 rounded-full bg-status-refused-light px-2 py-0.5 text-xs font-semibold text-status-refused">
            <Clock3 className="h-3 w-3" aria-hidden="true" />{t('dashboard.overdue')}
          </span>
        )}
        {task.edited && (
          <span className="inline-flex items-center rounded-full border border-border bg-secondary px-2 py-0.5 text-xs text-muted-foreground">{t('common.modified')}</span>
        )}
        {task.invoice_number && (
          <span className="rounded-full bg-secondary px-2 py-0.5 text-xs text-muted-foreground">{task.invoice_number}</span>
        )}
      </div>

      {children && <div className="mt-2.5 space-y-1 text-sm">{children}</div>}

      <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2 border-t border-border pt-2.5 text-xs text-muted-foreground">
        {task.due_date && (
          <span className={cn('flex items-center gap-1', overdue && 'font-semibold text-status-refused')}>
            <CalendarDays className="h-3.5 w-3.5" aria-hidden="true" />
            {t('board.due', { date: new Date(task.due_date).toLocaleDateString(dateLocale, { day: 'numeric', month: 'short' }) })}
          </span>
        )}
        {!showAssignee ? null : assigneeName ? (
          <span className="flex min-w-0 items-center gap-1.5">
            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-[10px] font-bold text-primary" aria-hidden="true">{initials(assignee)}</span>
            <span className="truncate">{assigneeName}</span>
          </span>
        ) : (
          <span className="italic">{t('board.unassigned')}</span>
        )}
        {actions && <span className="ms-auto flex items-center gap-1">{actions}</span>}
      </div>
    </article>
  );
}

/**
 * Tasks by status. Wide screens: one column per status. Phones and tablets:
 * status chips (with counts) above a single list.
 */
export function TaskBoard({ tasks, statuses = BOARD_STATUSES, renderTask, emptyLabel, initialStatus = 'all' }: {
  tasks: Task[];
  statuses?: TaskStatus[];
  renderTask: (task: Task) => ReactNode;
  emptyLabel: string;
  initialStatus?: TaskStatus | 'all';
}) {
  const { t } = useLanguage();
  const [filter, setFilter] = useState<TaskStatus | 'all'>(initialStatus);
  // "Refusé" only gets a column when there is something in it.
  const shown = statuses.filter(status => status !== 'refused' || tasks.some(task => task.status === status));
  const byStatus = (status: TaskStatus) => tasks.filter(task => task.status === status);
  const listed = filter === 'all' ? tasks : byStatus(filter);
  const chip = (active: boolean) => cn(
    'flex h-10 shrink-0 items-center gap-2 rounded-full border px-3.5 text-sm font-medium transition-colors',
    active ? 'border-primary bg-primary text-primary-foreground' : 'border-border bg-card text-foreground hover:bg-secondary',
  );

  return (
    <>
      {/* Phones and tablets */}
      <div className="lg:hidden">
        <div role="group" aria-label={t('board.statusFilter')} className="-mx-1 mb-3 flex gap-2 overflow-x-auto px-1 pb-1">
          <button type="button" aria-pressed={filter === 'all'} onClick={() => setFilter('all')} className={chip(filter === 'all')}>
            {t('board.all')} <span className="tabular-nums opacity-75">{tasks.length}</span>
          </button>
          {shown.map(status => (
            <button key={status} type="button" aria-pressed={filter === status} onClick={() => setFilter(status)} className={chip(filter === status)}>
              <span className={cn('h-2 w-2 rounded-full', STATUS_DOT[status])} aria-hidden="true" />
              {t(`status.${status}`)} <span className="tabular-nums opacity-75">{byStatus(status).length}</span>
            </button>
          ))}
        </div>
        <div className="space-y-3">
          {listed.map(task => <div key={task.id}>{renderTask(task)}</div>)}
          {listed.length === 0 && <p className="rounded-xl border border-dashed border-border px-4 py-10 text-center text-sm text-muted-foreground">{emptyLabel}</p>}
        </div>
      </div>

      {/* Wide screens: one column per status */}
      <div className="hidden gap-4 lg:grid" style={{ gridTemplateColumns: `repeat(${shown.length}, minmax(0, 1fr))` }}>
        {shown.map(status => {
          const list = byStatus(status);
          return (
            <section key={status} aria-labelledby={`task-column-${status}`} className="flex min-w-0 flex-col rounded-xl bg-secondary/50 p-2.5">
              <h2 id={`task-column-${status}`} className="flex items-center gap-2 px-1.5 pb-2.5 pt-1 text-sm font-semibold text-foreground">
                <span className={cn('h-2.5 w-2.5 rounded-full', STATUS_DOT[status])} aria-hidden="true" />
                {t(`status.${status}`)}
                <span className="ms-auto rounded-full bg-card px-2 py-0.5 text-xs font-medium tabular-nums text-muted-foreground">{list.length}</span>
              </h2>
              <div className="space-y-2.5">
                {list.map(task => <div key={task.id}>{renderTask(task)}</div>)}
                {list.length === 0 && <p className="px-2 py-8 text-center text-xs text-muted-foreground">{t('myTasks.noTasks')}</p>}
              </div>
            </section>
          );
        })}
      </div>
    </>
  );
}
