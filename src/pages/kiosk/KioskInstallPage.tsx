import { useEffect, useState, type ReactNode } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { CheckCircle2, Download, ExternalLink, Loader2, Lock, MoreVertical, Share, SquarePlus, WifiOff } from 'lucide-react';
import { KioskRequestError, KioskService, type KioskPublicProfile } from '../../utils/kioskService';
import { installPlatform, isInstalledApp, rememberKioskToken, rememberedKioskToken } from '../../utils/kioskApp';
import { DEFAULT_KIOSK_ACCENT, isHexColor, readableTextOn } from '../../utils/kioskColors';

type InstallPromptEvent = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }> };

/**
 * Set up a tablet: installs the kiosk as a full-screen app that always opens
 * on this kiosk (Chrome/Edge/Samsung offer a one-tap install, Safari needs
 * "Add to Home Screen").
 */
export default function KioskInstallPage() {
  const { token = '' } = useParams();
  const navigate = useNavigate();
  const [profile, setProfile] = useState<KioskPublicProfile | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'invalid' | 'offline'>('loading');
  const [prompt, setPrompt] = useState<InstallPromptEvent | null>(null);
  const [installed, setInstalled] = useState(false);
  const [installing, setInstalling] = useState(false);
  const platform = installPlatform();
  const kioskPath = `/kiosk/${token}`;

  useEffect(() => {
    rememberKioskToken(token);
    // Opened from the home-screen icon (Safari starts on this page): go straight to the kiosk.
    if (isInstalledApp()) navigate(kioskPath, { replace: true });
  }, [kioskPath, navigate, token]);

  useEffect(() => {
    let active = true;
    KioskService.loadPublic(token)
      .then(data => { if (active) { setProfile(data.profile); setState('ready'); } })
      .catch(error => { if (active) setState(error instanceof KioskRequestError && error.status === 404 ? 'invalid' : 'offline'); });
    return () => { active = false; };
  }, [token]);

  useEffect(() => {
    const onPrompt = (event: Event) => { event.preventDefault(); setPrompt(event as InstallPromptEvent); };
    const onInstalled = () => { setInstalled(true); setPrompt(null); };
    window.addEventListener('beforeinstallprompt', onPrompt);
    window.addEventListener('appinstalled', onInstalled);
    return () => {
      window.removeEventListener('beforeinstallprompt', onPrompt);
      window.removeEventListener('appinstalled', onInstalled);
    };
  }, []);

  const install = async () => {
    if (!prompt) return;
    setInstalling(true);
    try {
      await prompt.prompt();
      const choice = await prompt.userChoice;
      if (choice.outcome === 'accepted') setInstalled(true);
      setPrompt(null);
    } finally {
      setInstalling(false);
    }
  };

  const accent = profile && isHexColor(profile.accent_color) ? profile.accent_color : DEFAULT_KIOSK_ACCENT;
  const onAccent = readableTextOn(accent);

  return (
    <main className="min-h-screen bg-slate-950 px-5 py-10 text-white">
      <div className="mx-auto max-w-xl">
        <div className="flex items-center gap-4">
          <img src="/kiosk-icon-192.png" alt="" className="h-20 w-20 rounded-3xl shadow-xl" />
          <div>
            <p className="text-sm font-semibold uppercase tracking-widest text-white/50">Installer l’application</p>
            <h1 className="mt-1 text-3xl font-black">Kiosque {profile ? `· ${profile.name}` : ''}</h1>
            {profile && <p className="mt-1 text-white/60">{profile.company_name}</p>}
          </div>
        </div>

        {state === 'loading' && <div className="mt-10 flex items-center gap-3 text-white/70"><Loader2 className="h-5 w-5 animate-spin" />Vérification du lien…</div>}
        {state === 'invalid' && <Notice tone="error">Ce lien de kiosque n’existe plus ou a été renouvelé. Demandez le nouveau lien d’installation depuis Stocky (Demandes Kiosque → Liens & réglages).</Notice>}
        {state === 'offline' && <Notice tone="warning"><WifiOff className="me-2 inline h-4 w-4" />Impossible de vérifier le kiosque pour le moment. Vous pouvez quand même l’installer ; il se connectera dès que le réseau sera disponible.</Notice>}

        {state !== 'invalid' && (
          <>
            {installed ? (
              <section className="mt-8 rounded-3xl bg-emerald-500/15 p-6 ring-1 ring-emerald-400/30">
                <p className="flex items-center gap-2 text-xl font-bold"><CheckCircle2 className="h-6 w-6 text-emerald-400" />Application installée</p>
                <p className="mt-2 text-white/75">Ouvrez « Kiosque » depuis l’écran d’accueil de la tablette : il démarre en plein écran directement sur ce kiosque.</p>
              </section>
            ) : prompt ? (
              <button onClick={install} disabled={installing}
                className="mt-8 flex min-h-16 w-full items-center justify-center gap-3 rounded-2xl text-xl font-black shadow-2xl disabled:opacity-60"
                style={{ backgroundColor: accent, color: onAccent }}>
                {installing ? <Loader2 className="h-6 w-6 animate-spin" /> : <Download className="h-6 w-6" />}Installer l’application
              </button>
            ) : (
              <section className="mt-8 rounded-3xl bg-white/5 p-6 ring-1 ring-white/10">
                <h2 className="text-lg font-bold">Ajouter le kiosque à l’écran d’accueil</h2>
                {platform === 'ios' ? (
                  <ol className="mt-4 space-y-3 text-white/85">
                    <Step n={1}>Ouvrez ce lien dans <strong>Safari</strong>.</Step>
                    <Step n={2}>Touchez <Share className="mx-1 inline h-5 w-5" /> <strong>Partager</strong>.</Step>
                    <Step n={3}>Choisissez <SquarePlus className="mx-1 inline h-5 w-5" /> <strong>Sur l’écran d’accueil</strong>, puis <strong>Ajouter</strong>.</Step>
                  </ol>
                ) : (
                  <ol className="mt-4 space-y-3 text-white/85">
                    <Step n={1}>Ouvrez ce lien dans <strong>Chrome</strong> (ou Samsung Internet / Edge).</Step>
                    <Step n={2}>Touchez le menu <MoreVertical className="mx-1 inline h-5 w-5" />.</Step>
                    <Step n={3}>Choisissez <strong>Installer l’application</strong> (ou <strong>Ajouter à l’écran d’accueil</strong>).</Step>
                  </ol>
                )}
                <p className="mt-4 text-sm text-white/50">L’icône « Kiosque » ouvre ensuite directement ce kiosque, en plein écran.</p>
              </section>
            )}

            <section className="mt-6 rounded-3xl bg-white/5 p-6 ring-1 ring-white/10">
              <h2 className="flex items-center gap-2 text-lg font-bold"><Lock className="h-5 w-5" />Verrouiller la tablette (conseillé)</h2>
              <p className="mt-2 text-white/75">
                {platform === 'ios'
                  ? 'Réglages → Accessibilité → Accès guidé : activez-le, ouvrez le kiosque puis triple-cliquez sur le bouton latéral pour empêcher de quitter l’application.'
                  : 'Réglages → Sécurité → Épinglage d’application : activez-le, ouvrez le kiosque puis épinglez-le depuis l’écran des applications récentes.'}
              </p>
            </section>

            <a href={kioskPath} className="mt-6 inline-flex items-center gap-2 text-sm font-semibold text-white/70 underline-offset-4 hover:underline">
              <ExternalLink className="h-4 w-4" />Ouvrir le kiosque sans l’installer
            </a>
          </>
        )}
      </div>
    </main>
  );
}

/** Where the installed app starts: the kiosk this tablet was set up with. */
export function KioskAppLauncher() {
  const navigate = useNavigate();
  const token = rememberedKioskToken();
  useEffect(() => { if (token) navigate(`/kiosk/${token}`, { replace: true }); }, [navigate, token]);
  if (token) return <main className="flex min-h-screen items-center justify-center bg-slate-950"><Loader2 className="h-8 w-8 animate-spin text-white/50" /></main>;
  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-950 p-6 text-center text-white">
      <div className="max-w-md">
        <img src="/kiosk-icon-192.png" alt="" className="mx-auto h-20 w-20 rounded-3xl" />
        <h1 className="mt-6 text-2xl font-black">Kiosque à configurer</h1>
        <p className="mt-3 text-white/70">Ouvrez sur cette tablette le lien d’installation du kiosque (Stocky → Demandes Kiosque → Liens & réglages → Installer).</p>
      </div>
    </main>
  );
}

function Step({ n, children }: { n: number; children: ReactNode }) {
  return <li className="flex items-start gap-3"><span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-white/15 text-sm font-black">{n}</span><span className="pt-1">{children}</span></li>;
}

function Notice({ tone, children }: { tone: 'error' | 'warning'; children: ReactNode }) {
  return <p className={`mt-8 rounded-2xl p-4 text-sm font-semibold ${tone === 'error' ? 'bg-red-500/15 text-red-200 ring-1 ring-red-400/30' : 'bg-amber-500/15 text-amber-100 ring-1 ring-amber-400/30'}`}>{children}</p>;
}
