import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildWhatsAppShareUrl, sanitizeShareText, sharePdfFile } from '../utils/whatsappShare';

const originalShare = Object.getOwnPropertyDescriptor(navigator, 'share');
const originalCanShare = Object.getOwnPropertyDescriptor(navigator, 'canShare');

afterEach(() => {
  if (originalShare) Object.defineProperty(navigator, 'share', originalShare);
  else delete (navigator as Navigator & { share?: Navigator['share'] }).share;
  if (originalCanShare) Object.defineProperty(navigator, 'canShare', originalCanShare);
  else delete (navigator as Navigator & { canShare?: Navigator['canShare'] }).canShare;
  vi.restoreAllMocks();
});

describe('WhatsApp PDF sharing', () => {
  it('removes temporary blob addresses without removing real message links', () => {
    const text = 'Voici le devis\nblob:https://stocky.qodweb.com/f61115f2-8150-494d-b2da-2200f67fc24e\nhttps://stocky.qodweb.com/help';

    expect(sanitizeShareText(text)).toBe('Voici le devis\nhttps://stocky.qodweb.com/help');
    expect(decodeURIComponent(buildWhatsAppShareUrl('0612345678', text))).not.toContain('blob:');
  });

  it('shares the PDF as a file and never supplies a URL field', async () => {
    const share = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'canShare', { configurable: true, value: vi.fn(() => true) });
    Object.defineProperty(navigator, 'share', { configurable: true, value: share });

    const shared = await sharePdfFile(
      new Blob(['pdf'], { type: 'application/pdf' }),
      'Devis_TEST.pdf',
      'Message propre\nblob:https://stocky.qodweb.com/temporaire',
    );

    expect(shared).toBe(true);
    expect(share).toHaveBeenCalledOnce();
    const payload = share.mock.calls[0][0];
    expect(payload).toMatchObject({ text: 'Message propre' });
    expect(payload).not.toHaveProperty('url');
    expect(payload.files).toHaveLength(1);
    expect(payload.files[0]).toMatchObject({ name: 'Devis_TEST.pdf', type: 'application/pdf' });
  });
});
