import { useEffect, useState } from 'react';
import { Bell, BellOff, Languages } from 'lucide-react';
import { toast } from 'sonner';
import NotificationPanel from '@/tasks/components/NotificationPanel';
import { useLanguage } from '@/tasks/contexts/LanguageContext';
import { useAuth } from '@/tasks/contexts/AuthAdapter';
import { enablePush, disablePush, isPushEnabled, pushPermission } from '@/tasks/lib/push';

// Tasks header actions (push toggle, language for field staff, notification
// bell), shown on the right of each Tasks page header.
export default function TasksHeaderActions() {
  const { language, setLanguage, t } = useLanguage();
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
      // is stored under the current user: new devices, cleared rows, and a
      // shared device where someone else was signed in before.
      if (user && pushPermission() === 'granted') {
        try {
          const ok = await enablePush(user.id);
          if (active) setEnabled(ok);
        } catch { /* best-effort silent refresh */ }
      }
    })();
    return () => { active = false; };
  }, [user]);

  const toggle = async () => {
    if (!user || busy) return;
    if (pushPermission() === 'unsupported') {
      toast.error("Ce navigateur ne supporte pas les notifications. Installez l'app (Ajouter à l'écran d'accueil).");
      return;
    }
    if (pushPermission() === 'denied') {
      toast.error('Notifications bloquées. Autorisez-les dans les réglages du navigateur, puis réessayez.');
      return;
    }
    setBusy(true);
    try {
      if (enabled) {
        await disablePush();
        setEnabled(false);
        toast.success('Notifications désactivées');
      } else {
        const ok = await enablePush(user.id);
        setEnabled(ok);
        toast[ok ? 'success' : 'error'](ok ? 'Notifications activées ✅' : 'Autorisation refusée');
      }
    } catch (e) {
      toast.error(e instanceof Error && e.message ? e.message : "Échec de l'activation des notifications");
    } finally {
      setBusy(false);
    }
  };

  const isFieldStaff = user?.role === 'technician' || user?.role === 'driver';

  return (
    <div className="flex items-center gap-1">
      <button
        type="button"
        onClick={toggle}
        disabled={busy}
        aria-pressed={enabled}
        title={enabled ? t('header.notificationsOn') : t('header.notificationsOff')}
        className="flex h-9 items-center gap-1.5 rounded-lg px-2.5 text-sm font-medium text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground disabled:opacity-50"
      >
        {enabled ? <Bell className="h-4 w-4 text-emerald-600" aria-hidden="true" /> : <BellOff className="h-4 w-4" aria-hidden="true" />}
        <span className="hidden sm:inline">{busy ? '…' : enabled ? t('header.notificationsOn') : t('header.notificationsOff')}</span>
      </button>
      {/* Arabic toggle only for field staff (technician / driver). */}
      {isFieldStaff && (
        <button
          type="button"
          onClick={() => setLanguage(language === 'fr' ? 'ar' : 'fr')}
          className="flex h-9 items-center gap-1.5 rounded-lg px-2.5 text-sm font-medium text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
          lang={language === 'fr' ? 'ar' : 'fr'}
        >
          <Languages className="h-4 w-4" aria-hidden="true" />
          {language === 'fr' ? 'العربية' : 'Français'}
        </button>
      )}
      <NotificationPanel />
    </div>
  );
}
