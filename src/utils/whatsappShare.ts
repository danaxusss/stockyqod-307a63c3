const WHATSAPP_BASE_URL = 'https://api.whatsapp.com/send';
const BLOB_URL_PATTERN = /\bblob:https?:\/\/[^\s]+/gi;
const BLOB_URL_LINE_PATTERN = /(^|\n)[ \t]*blob:https?:\/\/[^\s]+[ \t]*(?:\n|$)/gi;

export function sanitizeShareText(messageText: string): string {
  return messageText
    .replace(BLOB_URL_LINE_PATTERN, '$1')
    .replace(BLOB_URL_PATTERN, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function normalizeWhatsAppPhone(rawPhone: string): string {
  const digits = rawPhone.replace(/\D/g, '');
  if (!digits) return '';
  if (digits.startsWith('00')) return digits.slice(2);
  if (digits.startsWith('212')) return digits;
  if (digits.startsWith('0')) return `212${digits.slice(1)}`;
  return digits;
}

export function buildWhatsAppShareUrl(rawPhone: string, messageText: string): string {
  const phone = normalizeWhatsAppPhone(rawPhone);
  const encodedText = sanitizeShareText(messageText).replace(/\n/g, '%0a').replace(/ /g, '%20');

  return phone
    ? `${WHATSAPP_BASE_URL}?phone=${phone}&text=${encodedText}`
    : `${WHATSAPP_BASE_URL}?text=${encodedText}`;
}

function pdfFile(blob: Blob, filename: string): File {
  return new File([blob], filename, { type: 'application/pdf' });
}

export function canSharePdfFile(blob: Blob, filename: string): boolean {
  if (typeof File === 'undefined' || typeof navigator.share !== 'function' || typeof navigator.canShare !== 'function') return false;
  try {
    return navigator.canShare({ files: [pdfFile(blob, filename)] });
  } catch {
    return false;
  }
}

export async function sharePdfFile(blob: Blob, filename: string, messageText = ''): Promise<boolean> {
  const file = pdfFile(blob, filename);
  if (!canSharePdfFile(blob, filename)) return false;

  const text = sanitizeShareText(messageText);
  await navigator.share({ files: [file], ...(text ? { text } : {}) });
  return true;
}

export function downloadPdfFile(blob: Blob, filename: string): void {
  const objectUrl = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = objectUrl;
  link.download = filename;
  link.rel = 'noopener';
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
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
