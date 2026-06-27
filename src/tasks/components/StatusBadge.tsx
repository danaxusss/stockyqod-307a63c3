import { TaskStatus, Priority } from '@/tasks/types';
import { cn } from '@/lib/utils';
import { Clock, Loader, CheckCircle, XCircle } from 'lucide-react';
import { STATUS_CONFIG, PRIORITY_CONFIG } from '@/tasks/types';
import { motion } from 'framer-motion';

const STATUS_ICONS = { pending: Clock, doing: Loader, done: CheckCircle, refused: XCircle };

export function StatusBadge({ status }: { status: TaskStatus }) {
  const config = STATUS_CONFIG[status];
  const Icon = STATUS_ICONS[status];
  return (
    <motion.span
      layout
      className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold"
      style={{
        backgroundColor: `hsl(var(--status-${status}-light))`,
        color: `hsl(var(--status-${status}))`,
      }}
    >
      <Icon className={cn("h-3.5 w-3.5", status === 'doing' && "animate-spin")} />
      {config.emoji} {config.label}
    </motion.span>
  );
}

export function PriorityBadge({ priority }: { priority: Priority }) {
  const config = PRIORITY_CONFIG[priority];
  return (
    <span
      className={cn(
        "inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium",
        priority === 'urgent' && "animate-pulse_glow"
      )}
      style={{
        backgroundColor: priority === 'low' ? 'hsl(var(--muted))' : `hsl(var(--priority-${priority}) / 0.15)`,
        color: `hsl(var(--priority-${priority}))`,
        border: priority === 'low' ? '1px solid hsl(var(--border))' : 'none',
      }}
    >
      {config.label}
    </span>
  );
}
