import { Outlet } from 'react-router-dom';
import { TasksProviders } from './TasksProviders';
import TasksHeader from './components/TasksHeader';

// Layout route so the Tasks providers (data/notifications/realtime/i18n) persist
// across the /tasks/* sub-pages instead of remounting on every navigation.
export default function TasksLayout() {
  return (
    <TasksProviders>
      <TasksHeader />
      <Outlet />
    </TasksProviders>
  );
}
