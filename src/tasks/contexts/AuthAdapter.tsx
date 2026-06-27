// Bridges the app-wide auth (src/hooks/useAuth) to the Tasks module's expected
// `useAuth()` shape, so ported pages keep working with minimal edits.
import { useMemo } from 'react';
import { useAuth as useAppAuth } from '@/hooks/useAuth';
import type { User, UserRole } from '@/tasks/types';

export function useAuth(): { user: User | null; logout: () => void; isAuthenticated: boolean } {
  const app = useAppAuth();
  const user = useMemo<User | null>(() => {
    const cu = app.currentUser;
    if (!cu || !app.isTasks || !app.tasksRole) return null;
    return {
      id: cu.id,
      pin: cu.pin || '',
      first_name: cu.custom_seller_name?.trim() || cu.username,
      last_name: '',
      role: app.tasksRole as UserRole,
      phone: cu.phone,
      is_active: true,
      created_at: cu.created_at ? String(cu.created_at) : new Date().toISOString(),
    };
  }, [app.currentUser, app.isTasks, app.tasksRole]);

  return { user, logout: app.logout, isAuthenticated: !!user };
}
