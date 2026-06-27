import React, { createContext, useContext, useState, useCallback, useEffect } from 'react';
import { AppNotification, NotificationType } from '@/tasks/types';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/tasks/contexts/AuthAdapter';

interface NotificationContextType {
  notifications: AppNotification[];
  unreadCount: number;
  addNotification: (userId: string, type: NotificationType, title: string, message: string, taskId?: string) => void;
  markAsRead: (id: string) => void;
  markAllAsRead: () => void;
  clearAll: () => void;
}

const NotificationContext = createContext<NotificationContextType | undefined>(undefined);

const TABLE = 'task_notifications';

export function NotificationProvider({ children }: { children: React.ReactNode }) {
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const { user } = useAuth();

  const unreadCount = notifications.filter(n => !n.is_read).length;

  useEffect(() => {
    if (!user) {
      setNotifications([]);
      return;
    }

    const fetchNotifications = async () => {
      const { data, error } = await supabase
        .from(TABLE)
        .select('*')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false })
        .limit(100);
      if (!error && data) {
        setNotifications(data.map((n: any) => ({
          id: n.id,
          user_id: n.user_id,
          type: n.type as NotificationType,
          title: n.title,
          message: n.message,
          task_id: n.task_id || undefined,
          is_read: n.is_read,
          created_at: n.created_at,
        })));
      }
    };

    fetchNotifications();

    const channel = supabase
      .channel('task-notifications-realtime')
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: TABLE,
        filter: `user_id=eq.${user.id}`,
      }, (payload) => {
        const n = payload.new as any;
        const notification: AppNotification = {
          id: n.id,
          user_id: n.user_id,
          type: n.type as NotificationType,
          title: n.title,
          message: n.message,
          task_id: n.task_id || undefined,
          is_read: n.is_read,
          created_at: n.created_at,
        };
        setNotifications(prev => {
          if (prev.some(existing => existing.id === notification.id)) return prev;
          return [notification, ...prev];
        });
        toast(notification.title, { description: notification.message });
      })
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [user]);

  const addNotification = useCallback(async (userId: string, type: NotificationType, title: string, message: string, taskId?: string) => {
    const { error } = await supabase.from(TABLE).insert({
      user_id: userId,
      type,
      title,
      message,
      task_id: taskId || null,
    });
    if (error) console.error('Error adding notification:', error);
  }, []);

  const markAsRead = useCallback(async (id: string) => {
    setNotifications(prev => prev.map(n => n.id === id ? { ...n, is_read: true } : n));
    await supabase.from(TABLE).update({ is_read: true }).eq('id', id);
  }, []);

  const markAllAsRead = useCallback(async () => {
    if (!user) return;
    setNotifications(prev => prev.map(n => ({ ...n, is_read: true })));
    await supabase.from(TABLE).update({ is_read: true }).eq('user_id', user.id).eq('is_read', false);
  }, [user]);

  const clearAll = useCallback(async () => {
    if (!user) return;
    setNotifications([]);
    await supabase.from(TABLE).delete().eq('user_id', user.id);
  }, [user]);

  return (
    <NotificationContext.Provider value={{ notifications, unreadCount, addNotification, markAsRead, markAllAsRead, clearAll }}>
      {children}
    </NotificationContext.Provider>
  );
}

export function useNotifications() {
  const ctx = useContext(NotificationContext);
  if (!ctx) throw new Error('useNotifications must be used within NotificationProvider');
  return ctx;
}
