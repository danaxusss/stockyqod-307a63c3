import { supabase } from '@/integrations/supabase/client';

// VAPID public key (safe to ship in the client). Override per-deploy with
// VITE_VAPID_PUBLIC_KEY; the default matches the committed edge secret.
const VAPID_PUBLIC_KEY =
  (import.meta as any).env?.VITE_VAPID_PUBLIC_KEY ||
  'BJNl5LPtP_qX1apSTnjufefdgZAfKPA9ehODWjGro33BpufBu2S15zCsFm0CqW15wjvmWT8G3QfdgrpL7Ols5AU';

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  const output = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) output[i] = raw.charCodeAt(i);
  return output;
}

export function pushSupported(): boolean {
  return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
}

export function pushPermission(): NotificationPermission | 'unsupported' {
  if (!pushSupported()) return 'unsupported';
  return Notification.permission;
}

export async function isPushEnabled(): Promise<boolean> {
  if (!pushSupported()) return false;
  const reg = await navigator.serviceWorker.getRegistration();
  if (!reg) return false;
  const sub = await reg.pushManager.getSubscription();
  return !!sub;
}

async function persistSubscription(userId: string, sub: PushSubscription) {
  const json = sub.toJSON();
  const keys = json.keys || ({} as Record<string, string>);
  return supabase.from('push_subscriptions').upsert(
    {
      user_id: userId,
      endpoint: json.endpoint!,
      p256dh: keys.p256dh,
      auth: keys.auth,
      user_agent: navigator.userAgent,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'endpoint' }
  );
}

// Requests permission (if needed), subscribes via the SW, and stores the
// subscription. Returns true when push is active; false when permission was
// declined; throws (with a readable message) on a real failure.
export async function enablePush(userId: string): Promise<boolean> {
  if (!pushSupported()) throw new Error('Notifications non supportées par ce navigateur.');

  const permission = Notification.permission === 'granted'
    ? 'granted'
    : await Notification.requestPermission();
  if (permission !== 'granted') return false;

  // Ensure an active service worker exists — the index.html registration may
  // have failed or raced, leaving navigator.serviceWorker.ready pending forever.
  try { await navigator.serviceWorker.register('/sw.js'); } catch { /* already registered */ }
  const reg = await navigator.serviceWorker.ready;

  let sub = await reg.pushManager.getSubscription();
  if (!sub) {
    sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
    });
  }
  const { error } = await persistSubscription(userId, sub);
  if (error) throw new Error("Abonnement non enregistré (la table push_subscriptions existe-t-elle ?) : " + error.message);
  return true;
}

export async function disablePush(): Promise<void> {
  if (!pushSupported()) return;
  const reg = await navigator.serviceWorker.getRegistration();
  if (!reg) return;
  const sub = await reg.pushManager.getSubscription();
  if (sub) {
    const endpoint = sub.toJSON().endpoint;
    await sub.unsubscribe().catch(() => {});
    if (endpoint) await supabase.from('push_subscriptions').delete().eq('endpoint', endpoint);
  }
}
