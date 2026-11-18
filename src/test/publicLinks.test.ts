import { describe, expect, it } from 'vitest';
import {
  destinationInput, isLinkToken, publicCompany, publicImages, publicLocation, publicSheet,
  publicTrackingSession, shareLinkStatus, trackingStatus,
} from '../../supabase/functions/_shared/publicLinks';

// What the public-share and public-tracking functions let anonymous visitors see.

const NOW = Date.parse('2026-11-19T12:00:00Z');

describe('link tokens', () => {
  it('accepts the tokens the app creates and nothing that could reach the query', () => {
    expect(isLinkToken(crypto.randomUUID())).toBe(true);
    expect(isLinkToken(crypto.randomUUID().slice(0, 12))).toBe(true);
    expect(isLinkToken('a'.repeat(64))).toBe(true);
    for (const bad of ['', 'short', 'a,b.c=d', 'x'.repeat(200), 'abc def ghi', null, 42, { token: 'x' }]) {
      expect(isLinkToken(bad)).toBe(false);
    }
  });
});

describe('share links', () => {
  it('open until their expiry date, forever without one', () => {
    expect(shareLinkStatus(null, NOW)).toBe('missing');
    expect(shareLinkStatus({ expires_at: null }, NOW)).toBe('ok');
    expect(shareLinkStatus({ expires_at: '2026-11-20T00:00:00Z' }, NOW)).toBe('ok');
    expect(shareLinkStatus({ expires_at: '2026-11-18T00:00:00Z' }, NOW)).toBe('expired');
  });

  it('show only well-formed photos with a web address', () => {
    expect(publicImages([
      { barcode: 'A1', name: 'Four', brand: 'Rational', url: 'https://cdn.test/a.jpg', secret: 'x' },
      { barcode: 'B2', name: 'Bad', brand: '', url: 'javascript:alert(1)' },
      null, 'text',
    ])).toEqual([{ barcode: 'A1', name: 'Four', brand: 'Rational', url: 'https://cdn.test/a.jpg' }]);
    expect(publicImages('not an array')).toEqual([]);
  });

  it('pass on the sheet columns the page shows, not the counters', () => {
    expect(publicSheet({ id: 's1', title: 'Fiche', manufacturer: 'Bosch', category: 'Four', sector: '', file_url: 'https://x/s1.pdf', file_size: 1234, file_type: 'application/pdf', download_count: 9, source_url: 'https://y' }))
      .toEqual({ id: 's1', title: 'Fiche', manufacturer: 'Bosch', category: 'Four', sector: '', file_url: 'https://x/s1.pdf', file_size: 1234, file_type: 'application/pdf' });
  });

  it("put the link's company on the cover, else the default company, never private settings", () => {
    const company = publicCompany(
      { name: 'QodWeb', logo_url: 'https://x/logo.png', address: 'Casablanca', phone: '0522', phone2: '', email: 'a@b.ma', website: 'qodweb.com', ice: '123', accent_color: '#112233', special_pin: '999999', ai_system_prompt: 'x' },
      null,
    );
    expect(company).toEqual({
      company_name: 'QodWeb', logo_url: 'https://x/logo.png', address: 'Casablanca', phone: '0522', phone2: '', phone_gsm: '', phone_dir: '',
      email: 'a@b.ma', website: 'qodweb.com', ice: '123', quote_style: { accentColor: '#112233' },
    });
    expect(JSON.stringify(company)).not.toContain('999999');

    const legacy = publicCompany(null, { company_name: 'Ancienne', logo_url: null, phone_gsm: '0661', quote_style: { accentColor: '#abcdef', template: 'classic' } });
    expect(legacy).toMatchObject({ company_name: 'Ancienne', logo_url: null, phone_gsm: '0661', quote_style: { accentColor: '#abcdef' } });
    expect(publicCompany({ name: '' }, { company_name: 'Repli' })?.company_name).toBe('Repli');
    expect(publicCompany(null, null)).toBeNull();
    expect(publicCompany({ name: 'Sans couleur' }, null)?.quote_style.accentColor).toBe('#3B82F6');
  });
});

describe('delivery tracking', () => {
  it('works while the delivery runs and until its expiry', () => {
    expect(trackingStatus(null, NOW)).toBe('missing');
    expect(trackingStatus({ is_active: true, expires_at: '2026-11-19T13:00:00Z' }, NOW)).toBe('ok');
    expect(trackingStatus({ is_active: false, expires_at: '2026-11-19T13:00:00Z' }, NOW)).toBe('expired');
    expect(trackingStatus({ is_active: true, expires_at: '2026-11-19T11:00:00Z' }, NOW)).toBe('expired');
    expect(trackingStatus({ is_active: true, expires_at: null }, NOW)).toBe('expired');
  });

  it('shows the customer the delivery without driver id, client phone or token', () => {
    const shown = publicTrackingSession({
      id: 'x', token: 't', task_id: 'task', driver_id: 'd', client_phone: '0600', client_name: 'Café Atlas',
      is_active: true, expires_at: '2026-11-19T13:00:00Z', destination_latitude: 33.5, destination_longitude: -7.6, destination_source: 'gps',
    });
    expect(shown).toEqual({ client_name: 'Café Atlas', expires_at: '2026-11-19T13:00:00Z', destination_latitude: 33.5, destination_longitude: -7.6, destination_source: 'gps' });
    expect(publicTrackingSession({ client_name: 'A', destination_latitude: null })).toMatchObject({ destination_latitude: null, destination_source: null });
  });

  it('passes on the last position only when it has coordinates', () => {
    expect(publicLocation({ latitude: 33.5, longitude: -7.6, accuracy: 12, created_at: '2026-11-19T12:00:00Z', driver_id: 'd' }))
      .toEqual({ latitude: 33.5, longitude: -7.6, accuracy: 12, created_at: '2026-11-19T12:00:00Z' });
    expect(publicLocation(null)).toBeNull();
    expect(publicLocation({ latitude: 'x', longitude: 2 })).toBeNull();
  });

  it('accepts a destination only with real coordinates and a known source', () => {
    expect(destinationInput({ latitude: 33.5, longitude: -7.6, source: 'gps' })).toEqual({ latitude: 33.5, longitude: -7.6, source: 'gps' });
    expect(destinationInput({ latitude: '33.5', longitude: '-7.6', source: 'address' })).toEqual({ latitude: 33.5, longitude: -7.6, source: 'address' });
    expect(destinationInput({ latitude: 91, longitude: 0, source: 'gps' })).toBeNull();
    expect(destinationInput({ latitude: 1, longitude: 2, source: 'manual' })).toBeNull();
    expect(destinationInput({ latitude: 'abc', longitude: 2, source: 'gps' })).toBeNull();
  });
});
