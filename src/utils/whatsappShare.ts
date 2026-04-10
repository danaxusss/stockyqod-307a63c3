const WHATSAPP_BASE_URL = 'https://api.whatsapp.com/send';

export function normalizeWhatsAppPhone(rawPhone: string): string {
  const digits = rawPhone.replace(/\D/g, '');
  if (!digits) return '';
  if (digits.startsWith('00')) return digits.slice(2);
  if (digits.startsWith('212')) return digits;
  if (digits.startsWith('0')) return `212${digits.slice(1)}`;
  return digits;
}

export function buildWhatsAppShareUrl(rawPhone: string, messageText: string): string {
  const params = new URLSearchParams({ text: messageText });
  const phone = normalizeWhatsAppPhone(rawPhone);

  if (phone) {
    params.set('phone', phone);
  }

  return `${WHATSAPP_BASE_URL}?${params.toString()}`;
}

export function openWhatsAppShareInNewTab(shareUrl: string): boolean {
  const popup = window.open(shareUrl, '_blank');

  if (!popup) {
    return false;
  }

  try {
    popup.opener = null;
  } catch (error) {
    console.error('Unable to detach WhatsApp share window opener:', error);
  }

  return true;
}

export function openWhatsAppShare(shareUrl: string): boolean {
  if (openWhatsAppShareInNewTab(shareUrl)) {
    return true;
  }

  try {
    window.location.assign(shareUrl);
    return true;
  } catch (error) {
    console.error('WhatsApp share current-tab navigation failed:', error);
  }

  return false;
}

export function openPreparingWhatsAppWindow(): Window | null {
  const popup = window.open('', '_blank');

  if (!popup) {
    return null;
  }

  try {
    popup.opener = null;
    popup.document.title = 'Préparation du partage WhatsApp';
    popup.document.body.innerHTML = `
      <div style="font-family: system-ui, sans-serif; min-height: 100vh; margin: 0; display: grid; place-items: center; background: #f8fafc; color: #0f172a;">
        <div style="text-align: center; padding: 24px; max-width: 320px;">
          <div style="width: 40px; height: 40px; border-radius: 999px; border: 3px solid #cbd5e1; border-top-color: #16a34a; margin: 0 auto 16px; animation: spin 1s linear infinite;"></div>
          <h1 style="font-size: 18px; margin: 0 0 8px;">Préparation du partage</h1>
          <p style="font-size: 14px; line-height: 1.5; margin: 0; color: #475569;">Le PDF est en cours de génération. WhatsApp va s'ouvrir automatiquement.</p>
        </div>
      </div>
      <style>
        @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
      </style>
    `;
  } catch (error) {
    console.error('Unable to render WhatsApp share placeholder:', error);
  }

  return popup;
}

export function redirectPreparingWindowToWhatsApp(shareUrl: string, popup: Window | null): boolean {
  if (!popup || popup.closed) {
    return false;
  }

  try {
    popup.location.replace(shareUrl);
    return true;
  } catch (replaceError) {
    console.error('WhatsApp share replace failed:', replaceError);
  }

  try {
    popup.location.href = shareUrl;
    return true;
  } catch (hrefError) {
    console.error('WhatsApp share href failed:', hrefError);
  }

  return false;
}