// The installed kiosk app always starts on /kiosk-app (see
// public/kiosk-manifest.webmanifest); it opens the kiosk this tablet was set
// up with, remembered here.
const TOKEN_KEY = 'stocky-kiosk-app-token';
const TOKEN_RE = /^[0-9a-f-]{36}$/i;

export function rememberKioskToken(token: string) {
  if (!TOKEN_RE.test(token)) return;
  try { localStorage.setItem(TOKEN_KEY, token); } catch { /* storage disabled: the launcher asks for the link again */ }
}

export function rememberedKioskToken(): string | null {
  try {
    const token = localStorage.getItem(TOKEN_KEY);
    return token && TOKEN_RE.test(token) ? token : null;
  } catch {
    return null;
  }
}

/** Running as the installed app rather than in a browser tab. */
export function isInstalledApp(): boolean {
  const media = (query: string) => typeof window.matchMedia === 'function' && window.matchMedia(query).matches;
  return media('(display-mode: fullscreen)') || media('(display-mode: standalone)')
    || (navigator as Navigator & { standalone?: boolean }).standalone === true;
}

export type InstallPlatform = 'ios' | 'android' | 'other';

export function installPlatform(userAgent = navigator.userAgent, touchPoints = navigator.maxTouchPoints || 0): InstallPlatform {
  // iPadOS reports itself as a Mac; touch support gives it away.
  if (/iPad|iPhone|iPod/.test(userAgent) || (/Macintosh/.test(userAgent) && touchPoints > 1)) return 'ios';
  if (/Android/.test(userAgent)) return 'android';
  return 'other';
}
