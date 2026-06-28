import { Bell } from 'lucide-react';
import { useNotifications } from '@/tasks/contexts/NotificationContext';
import { motion, AnimatePresence } from 'framer-motion';
import { cn } from '@/lib/utils';

interface NotificationBellProps {
  onClick: () => void;
}

export default function NotificationBell({ onClick }: NotificationBellProps) {
  const { unreadCount } = useNotifications();

  return (
    <button
      onClick={onClick}
      className="relative p-2 rounded-lg text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
      aria-label={`Notifications${unreadCount > 0 ? ` (${unreadCount} non lues)` : ''}`}
    >
      <AnimatePresence>
        {unreadCount > 0 && (
          <motion.div
            initial={{ scale: 0 }}
            animate={{ scale: 1 }}
            exit={{ scale: 0 }}
            className="absolute -top-0.5 -right-0.5 flex items-center justify-center"
          >
            <span className="relative flex h-5 w-5">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-destructive opacity-75" />
              <span className={cn(
                "relative inline-flex rounded-full h-5 w-5 items-center justify-center text-[10px] font-bold",
                "bg-destructive text-destructive-foreground"
              )}>
                {unreadCount > 99 ? '99+' : unreadCount}
              </span>
            </span>
          </motion.div>
        )}
      </AnimatePresence>
      <Bell className="h-5 w-5" />
    </button>
  );
}
