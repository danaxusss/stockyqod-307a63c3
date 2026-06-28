import { useNotifications } from '@/tasks/contexts/NotificationContext';
import { useNavigate } from 'react-router-dom';
import { useIsMobile } from '@/hooks/use-mobile';
import { useLanguage } from '@/tasks/contexts/LanguageContext';
import { NOTIFICATION_CONFIG } from '@/tasks/types';
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle } from '@/components/ui/drawer';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Button } from '@/components/ui/button';
import { Check, CheckCheck, Trash2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { formatDistanceToNow } from 'date-fns';
import { fr } from 'date-fns/locale';
import { ar } from 'date-fns/locale';
import NotificationBell from './NotificationBell';
import { useState } from 'react';

export default function NotificationPanel() {
  const isMobile = useIsMobile();
  const [open, setOpen] = useState(false);
  const { t } = useLanguage();

  if (isMobile) {
    return (
      <>
        <NotificationBell onClick={() => setOpen(true)} />
        <Drawer open={open} onOpenChange={setOpen}>
          <DrawerContent className="max-h-[85vh]">
            <DrawerHeader className="border-b border-border pb-3">
              <DrawerTitle>{t('notif.title')}</DrawerTitle>
            </DrawerHeader>
            <NotificationList onClose={() => setOpen(false)} />
          </DrawerContent>
        </Drawer>
      </>
    );
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <div>
          <NotificationBell onClick={() => setOpen(!open)} />
        </div>
      </PopoverTrigger>
      <PopoverContent className="w-96 p-0" align="end">
        <div className="px-4 py-3 border-b border-border">
          <h3 className="font-semibold text-sm">{t('notif.title')}</h3>
        </div>
        <NotificationList onClose={() => setOpen(false)} />
      </PopoverContent>
    </Popover>
  );
}

function NotificationList({ onClose }: { onClose: () => void }) {
  const { notifications, markAsRead, markAllAsRead, clearAll, unreadCount } = useNotifications();
  const navigate = useNavigate();
  const { t, language } = useLanguage();

  const handleClick = (notif: typeof notifications[0]) => {
    markAsRead(notif.id);
    if (notif.task_id) {
      navigate('/tasks');
      onClose();
    }
  };

  const dateLocale = language === 'ar' ? ar : fr;

  return (
    <div className="flex flex-col">
      {notifications.length > 0 && (
        <div className="flex items-center justify-between px-4 py-2 border-b border-border">
          <Button variant="ghost" size="sm" onClick={markAllAsRead} disabled={unreadCount === 0} className="text-xs h-7 gap-1">
            <CheckCheck className="h-3.5 w-3.5" /> {t('notif.readAll')}
          </Button>
          <Button variant="ghost" size="sm" onClick={clearAll} className="text-xs h-7 gap-1 text-destructive hover:text-destructive">
            <Trash2 className="h-3.5 w-3.5" /> {t('notif.clear')}
          </Button>
        </div>
      )}
      <ScrollArea className="max-h-80">
        {notifications.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
            <span className="text-3xl mb-2">🔔</span>
            <p className="text-sm">{t('notif.empty')}</p>
          </div>
        ) : (
          <div className="divide-y divide-border">
            {notifications.map(notif => {
              const config = NOTIFICATION_CONFIG[notif.type] || { emoji: '🔔', color: 'primary' };
              return (
                <button
                  key={notif.id}
                  onClick={() => handleClick(notif)}
                  className={cn(
                    "w-full flex items-start gap-3 px-4 py-3 text-start transition-colors hover:bg-secondary/50",
                    !notif.is_read && "bg-primary/5"
                  )}
                >
                  <span className="text-lg mt-0.5 shrink-0">{config.emoji}</span>
                  <div className="flex-1 min-w-0">
                    <p className={cn("text-sm", !notif.is_read && "font-semibold")}>{notif.title}</p>
                    <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{notif.message}</p>
                    <p className="text-[11px] text-muted-foreground mt-1">
                      {formatDistanceToNow(new Date(notif.created_at), { addSuffix: true, locale: dateLocale })}
                    </p>
                  </div>
                  {!notif.is_read && (
                    <span className="mt-2 h-2 w-2 rounded-full bg-primary shrink-0" />
                  )}
                </button>
              );
            })}
          </div>
        )}
      </ScrollArea>
    </div>
  );
}
