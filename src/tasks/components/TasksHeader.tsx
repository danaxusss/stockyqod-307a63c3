import { useEffect, useState } from 'react';
import { Bell, BellOff } from 'lucide-react';
import NotificationPanel from '@/tasks/components/NotificationPanel';
import { useLanguage } from '@/tasks/contexts/LanguageContext';
import { useAuth } from '@/tasks/contexts/AuthAdapter';
import { enablePush, disablePush, isPushEnabled, pushPermission } from '@/tasks/lib/push';

// Thin header for the Tasks section: push toggle + notification bell + language.
export default function TasksHeader() {
  const { language, setLanguage } = useLanguage();
  const { user } = useAuth();
  const [enabled, setEnabled] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let active = true;
    (async () => {
      const on = await isPushEnabled();
      if (!active) return;
      setEnabled(on);
      // If permission was already granted, make sure this device's subscription
      // is stored under the current user (handles new devices / cleared rows).
      if (!on && user && pushPermission() === 'granted') {
        const ok = await enablePush(user.id);
        if (active) setEnabled(ok);
      }
    })();
    return () => { active = false; };
  }, [user]);

  const toggle = async () => {
    if (!user || busy) return;
    setBusy(true);
    try {
      if (enabled) { await disablePush(); setEnabled(false); }
      else { setEnabled(await enablePush(user.id)); }
    } finally {
      setBusy(false);
    }
  };

  const denied = pushPermission() === 'denied';

  return (
    <div className="flex items-center justify-end gap-1 mb-3">
      <button
        onClick={toggle}
        disabled={busy || denied}
        title={denied ? 'Notifications bloquées par le navigateur' : enabled ? 'Désactiver les notifications' : 'Activer les notifications push'}
        className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-accent transition-colors disabled:opacity-50"
      >
        {enabled ? <Bell className="h-3.5 w-3.5 text-emerald-500" /> : <BellOff className="h-3.5 w-3.5" />}
        <span className="hidden sm:inline">{enabled ? 'Notifications activées' : 'Activer les notifications'}</span>
      </button>
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
