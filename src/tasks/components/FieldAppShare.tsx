import { useEffect, useState } from 'react';
import { Smartphone, Copy, Check, ExternalLink, ChevronDown } from 'lucide-react';

// Admin onboarding helper: shows a shareable link + QR so a technician/driver
// can open the app on their phone and "Add to Home Screen" in one scan.
export default function FieldAppShare() {
  const appUrl = typeof window !== 'undefined' ? window.location.origin : '';
  const [qr, setQr] = useState<string>('');
  const [copied, setCopied] = useState(false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open || qr || !appUrl) return;
    let active = true;
    (async () => {
      try {
        const qrcode = await import('qrcode');
        const url = await qrcode.toDataURL(appUrl, { width: 220, margin: 1 });
        if (active) setQr(url);
      } catch { /* ignore */ }
    })();
    return () => { active = false; };
  }, [open, qr, appUrl]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(appUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch { /* ignore */ }
  };

  return (
    <div className="glass rounded-xl overflow-hidden">
      <button
        onClick={() => setOpen(v => !v)}
        className="w-full flex items-center gap-2 p-4 text-start"
      >
        <Smartphone className="h-4 w-4 text-primary shrink-0" />
        <span className="flex-1 min-w-0">
          <span className="block text-sm font-semibold text-foreground">App terrain — technicien / livreur</span>
          <span className="block text-xs text-muted-foreground">Lien et QR à partager pour installer l'app sur leur téléphone</span>
        </span>
        <ChevronDown className={`h-4 w-4 text-muted-foreground transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div className="px-4 pb-4 flex flex-col sm:flex-row gap-4 items-center">
          <div className="shrink-0 bg-white p-2 rounded-lg">
            {qr
              ? <img src={qr} alt="QR code app terrain" className="w-40 h-40" />
              : <div className="w-40 h-40 flex items-center justify-center text-xs text-gray-400">…</div>}
          </div>
          <div className="flex-1 w-full space-y-3">
            <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-secondary/60 border border-border">
              <span className="flex-1 min-w-0 truncate text-sm font-mono text-foreground">{appUrl}</span>
              <button onClick={copy} className="shrink-0 p-1.5 rounded-md hover:bg-secondary text-muted-foreground" title="Copier le lien">
                {copied ? <Check className="h-4 w-4 text-status-done" /> : <Copy className="h-4 w-4" />}
              </button>
            </div>
            <a
              href={appUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-primary text-white text-sm font-medium hover:bg-primary/90"
            >
              <ExternalLink className="h-4 w-4" /> Ouvrir dans un nouvel onglet
            </a>
            <ol className="text-xs text-muted-foreground list-decimal ms-4 space-y-0.5">
              <li>Le technicien/livreur scanne le QR (ou ouvre le lien).</li>
              <li>Il se connecte avec son code PIN.</li>
              <li>Menu du navigateur → « Ajouter à l'écran d'accueil » pour une vraie icône d'app.</li>
            </ol>
          </div>
        </div>
      )}
    </div>
  );
}
