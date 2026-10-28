import { useEffect, useState } from 'react';
import QRCode from 'qrcode';

/** A QR code image (data URL) for an address, regenerated when it changes. */
export function useQrCode(url: string | null | undefined, width = 640): string {
  const [dataUrl, setDataUrl] = useState('');
  useEffect(() => {
    if (!url) { setDataUrl(''); return; }
    let active = true;
    QRCode.toDataURL(url, { width, margin: 1, errorCorrectionLevel: 'M', color: { dark: '#0f172a', light: '#ffffff' } })
      .then(value => { if (active) setDataUrl(value); })
      .catch(() => { if (active) setDataUrl(''); });
    return () => { active = false; };
  }, [url, width]);
  return dataUrl;
}
