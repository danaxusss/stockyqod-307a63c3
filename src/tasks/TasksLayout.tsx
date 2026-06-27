import { Outlet } from 'react-router-dom';
import { TasksProviders } from './TasksProviders';

// Layout route so the Tasks providers (data/notifications/realtime/i18n) persist
// across the /tasks/* sub-pages instead of remounting on every navigation.
export default function TasksLayout() {
  return (
    <TasksProviders>
      <Outlet />
    </TasksProviders>
  );
}
