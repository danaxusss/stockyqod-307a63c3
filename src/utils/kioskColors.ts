const HEX_RE = /^#[0-9a-f]{6}$/i;

export const DEFAULT_KIOSK_ACCENT = '#2563eb';

export const isHexColor = (value: string | null | undefined): value is string => !!value && HEX_RE.test(value);

/** Dark or white text, whichever reads better on the given accent colour (WCAG contrast). */
export function readableTextOn(hex: string): string {
  if (!isHexColor(hex)) return '#ffffff';
  const channel = (offset: number) => {
    const value = parseInt(hex.slice(offset, offset + 2), 16) / 255;
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  };
  const luminance = 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5);
  // Contrast with white is 1.05 / (L + 0.05); with slate-900 (L ≈ 0.012) it is (L + 0.05) / 0.062.
  return 1.05 / (luminance + 0.05) >= (luminance + 0.05) / 0.062 ? '#ffffff' : '#0f172a';
}
