import { useEffect, useMemo, useState } from 'react';
import { useLanguage } from '@/tasks/contexts/LanguageContext';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { MapPin, AlertTriangle, ShieldAlert } from 'lucide-react';

interface GPSPermissionDialogProps {
  open: boolean;
  onClose: () => void;
  onPermissionGranted: () => void;
  forced?: boolean;
}

export function GPSPermissionDialog({ open, onClose, onPermissionGranted, forced = false }: GPSPermissionDialogProps) {
  const [state, setState] = useState<'explain' | 'denied'>('explain');
  const [loading, setLoading] = useState(false);
  const [deniedReason, setDeniedReason] = useState('');
  const isIOS = useMemo(() => /iPhone|iPad|iPod/i.test(navigator.userAgent), []);
  const isAndroid = useMemo(() => /Android/i.test(navigator.userAgent), []);
  const { t } = useLanguage();

  useEffect(() => {
    if (!open) return;
    setState('explain');
    setLoading(false);
    setDeniedReason('');
  }, [open]);

  const handleRequestPermission = () => {
    setLoading(true);
    setDeniedReason('');

    if (!navigator.geolocation) {
      setDeniedReason(t('gps.notAvailable'));
      setState('denied');
      setLoading(false);
      return;
    }

    navigator.geolocation.getCurrentPosition(
      () => {
        setLoading(false);
        onPermissionGranted();
      },
      (err) => {
        setLoading(false);
        if (err.code === err.PERMISSION_DENIED) {
          setDeniedReason(
            isIOS
              ? 'Sur iPhone, la position peut être bloquée dans Réglages > Confidentialité et sécurité > Service de localisation, puis dans Réglages > Safari ou Chrome > Position.'
              : isAndroid
                ? 'Sur Android, vérifiez Paramètres > Applications > Chrome > Autorisations > Position, ainsi que le service de localisation du téléphone.'
                : "L'accès à la position a été refusé par le navigateur ou le téléphone."
          );
          setState('denied');
        } else {
          onPermissionGranted();
        }
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 60000 }
    );
  };

  const handleClose = () => {
    if (forced) return;
    setState('explain');
    onClose();
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v && !forced) handleClose(); }}>
      <DialogContent className="sm:max-w-md" onPointerDownOutside={forced ? (e) => e.preventDefault() : undefined} onEscapeKeyDown={forced ? (e) => e.preventDefault() : undefined}>
        {state === 'explain' ? (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                {forced ? (
                  <ShieldAlert className="h-5 w-5 text-destructive" />
                ) : (
                  <MapPin className="h-5 w-5 text-primary" />
                )}
                {forced ? t('gps.mandatoryTitle') : t('gps.optionalTitle')}
              </DialogTitle>
              <DialogDescription className="text-sm pt-2">
                {forced ? t('gps.mandatoryDesc') : t('gps.optionalDesc')}
              </DialogDescription>
            </DialogHeader>
            <div className="rounded-lg border bg-muted/50 p-3 text-sm text-muted-foreground">
              <p>{forced ? t('gps.mandatoryNote') : t('gps.optionalNote')}</p>
            </div>
            <DialogFooter className="gap-2 sm:gap-0">
              {!forced && (
                <Button variant="outline" onClick={handleClose}>
                  {t('form.cancel')}
                </Button>
              )}
              <Button onClick={handleRequestPermission} disabled={loading} className={forced ? 'w-full' : ''}>
                {loading ? t('gps.checking') : t('gps.authorize')}
              </Button>
            </DialogFooter>
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2 text-destructive">
                <AlertTriangle className="h-5 w-5" />
                {t('gps.blockedTitle')}
              </DialogTitle>
              <DialogDescription className="text-sm pt-2">
                {forced ? t('gps.blockedMandatory') : t('gps.blockedOptional')}
              </DialogDescription>
            </DialogHeader>
            <div className="rounded-lg border bg-muted/50 p-3 text-sm space-y-2">
              {deniedReason ? <p className="text-muted-foreground">{deniedReason}</p> : null}
              <p className="font-medium">{t('gps.howToEnable')}</p>
              <ol className="list-decimal list-inside space-y-1 text-muted-foreground">
                <li>{t('gps.step1')}</li>
                <li>{t('gps.step2')}</li>
                <li>{t('gps.step3')}</li>
                <li>{t('gps.step4')}</li>
              </ol>
            </div>
            <DialogFooter className="gap-2 sm:gap-0">
              <Button onClick={handleRequestPermission} disabled={loading} className={forced ? 'w-full' : ''}>
                {loading ? t('gps.retrying') : t('gps.retry')}
              </Button>
              {!forced && (
                <Button variant="outline" onClick={handleClose}>
                  {t('gps.close')}
                </Button>
              )}
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
