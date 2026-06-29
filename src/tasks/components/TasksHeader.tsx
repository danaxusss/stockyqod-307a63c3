import { useEffect, useState } from 'react';
import { Bell, BellOff } from 'lucide-react';
import { toast } from 'sonner';
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
    } catch (e: any) {
      toast.error(e?.message || "Échec de l'activation des notifications");
    } finally {
      setBusy(false);
    }
  };

  const isFieldStaff = user?.role === 'technician' || user?.role === 'driver';

  return (
    <div className="flex items-center justify-end gap-1 mb-3">
      <button
        onClick={toggle}
        disabled={busy}
        title={enabled ? 'Désactiver les notifications' : 'Activer les notifications push'}
        className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors disabled:opacity-50"
      >
        {enabled ? <Bell className="h-3.5 w-3.5 text-emerald-500" /> : <BellOff className="h-3.5 w-3.5" />}
        <span className="hidden sm:inline">{busy ? '…' : enabled ? 'Notifications activées' : 'Activer les notifications'}</span>
      </button>
      {/* Arabic toggle only for field staff (technician / driver). */}
      {isFieldStaff && (
        <button
          onClick={() => setLanguage(language === 'fr' ? 'ar' : 'fr')}
          className="px-2.5 py-1.5 rounded-lg text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
          title={language === 'fr' ? 'العربية' : 'Français'}
        >
          {language === 'fr' ? '🇲🇦 العربية' : '🇫🇷 Français'}
        </button>
      )}
      <NotificationPanel />
    </div>
  );
}
