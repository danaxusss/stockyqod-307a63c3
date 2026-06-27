import NotificationPanel from '@/tasks/components/NotificationPanel';
import { useLanguage } from '@/tasks/contexts/LanguageContext';

// Thin header for the Tasks section: notification bell + language switcher.
// Rendered inside TasksLayout so it sits within the module's providers.
export default function TasksHeader() {
  const { language, setLanguage } = useLanguage();
  return (
    <div className="flex items-center justify-end gap-1 mb-3">
      <button
        onClick={() => setLanguage(language === 'fr' ? 'ar' : 'fr')}
        className="px-2.5 py-1.5 rounded-lg text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
        title={language === 'fr' ? 'العربية' : 'Français'}
      >
        {language === 'fr' ? '🇲🇦 العربية' : '🇫🇷 Français'}
      </button>
      <NotificationPanel />
    </div>
  );
}
