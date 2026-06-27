import React from 'react';
import { LanguageProvider } from '@/tasks/contexts/LanguageContext';
import { NotificationProvider } from '@/tasks/contexts/NotificationContext';
import { DataProvider } from '@/tasks/contexts/DataContext';

// Composes the Tasks module's contexts. Wrap the Tasks routes with this so the
// realtime/data/notification/i18n providers are scoped to this section only.
export function TasksProviders({ children }: { children: React.ReactNode }) {
  return (
    <LanguageProvider>
      <NotificationProvider>
        <DataProvider>
          {children}
        </DataProvider>
      </NotificationProvider>
    </LanguageProvider>
  );
}
