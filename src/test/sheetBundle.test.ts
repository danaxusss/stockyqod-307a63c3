import { describe, expect, it } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import { buildSheetBundle, pdfSafe, sectionsForQuote, sectionsForShare, sniff } from '../utils/sheetBundle';

// 1×1 white PNG.
const PNG = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg=='), c => c.charCodeAt(0));

async function pdfWithPages(n: number): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  for (let i = 0; i < n; i++) doc.addPage([300, 400]);
  return doc.save();
}

function fakeFetch(files: Record<string, Uint8Array | number>) {
  return async (url: string) => {
    const file = files[url];
    if (file === undefined || typeof file === 'number') return new Response('missing', { status: typeof file === 'number' ? file : 404 });
    return new Response(file);
  };
}

describe('single-file bundle of technical sheets', () => {
  it('merges sheet pages and photo pages after a cover, and skips what cannot be read', async () => {
    const files = {
      'https://x/a.pdf': await pdfWithPages(2),
      'https://x/b.pdf': await pdfWithPages(1),
      'https://x/p.png': PNG,
      'https://x/bad.txt': new TextEncoder().encode('not a document'),
      'https://x/gone.pdf': 404,
    };
    const progress: number[] = [];
    const result = await buildSheetBundle({
      title: 'Fiches techniques — Devis QT-1',
      subtitle: 'Client : Hôtel Atlas',
      company: 'RESTONET.MA',
      sections: [
        { heading: 'Four mixte', files: [{ url: 'https://x/a.pdf', label: 'Fiche four' }, { url: 'https://x/gone.pdf', label: 'Fiche disparue' }] },
        { heading: 'Plancha', files: [{ url: 'https://x/p.png', label: 'Photo plancha' }] },
        { heading: 'Hachoir', files: [{ url: 'https://x/b.pdf', label: 'Fiche hachoir' }, { url: 'https://x/bad.txt', label: 'Fichier illisible' }] },
      ],
    }, { fetcher: fakeFetch(files), onProgress: done => progress.push(done) });

    const merged = await PDFDocument.load(result.bytes);
    expect(merged.getPageCount()).toBe(1 + 1 + 2 + 1 + 1); // cover + contents + 2 sheet pages + photo + 1 sheet page
    expect(result.included).toBe(3);
    expect(result.skipped).toEqual(['Fiche disparue', 'Fichier illisible']);
    expect(progress).toEqual([1, 2, 3, 4, 5]);
  });

  it('converts images pdf-lib cannot embed with the given converter', async () => {
    const webp = new TextEncoder().encode('RIFF\u0000\u0000\u0000\u0000WEBPVP8 ');
    const result = await buildSheetBundle(
      { title: 'T', sections: [{ heading: 'Produit', files: [{ url: 'https://x/w.webp', label: 'Photo' }] }] },
      { fetcher: fakeFetch({ 'https://x/w.webp': webp }), toJpeg: async () => PNG.slice(0, 0) },
    );
    // The converter returned nothing usable: the photo is reported, not a crash.
    expect(result.skipped).toEqual(['Photo']);
  });

  it('recognises formats from their first bytes', async () => {
    expect(sniff(await pdfWithPages(1))).toBe('pdf');
    expect(sniff(PNG)).toBe('png');
    expect(sniff(Uint8Array.from([0xff, 0xd8, 0xff, 0xe0]))).toBe('jpg');
    expect(sniff(new TextEncoder().encode('hello'))).toBeNull();
  });

  it('keeps text drawable with the standard font', () => {
    expect(pdfSafe('L’offre — 1 200,00 Dh')).toBe("L'offre - 1 200,00 Dh");
    expect(pdfSafe('مطعم Café')).toBe(' Café');
  });
});

describe('bundle sections', () => {
  const sheets = [
    { id: 's1', title: 'Fiche four', manufacturer: 'OLIS', file_url: 'https://x/s1.pdf' },
    { id: 's2', title: 'Fiche commune', manufacturer: null, file_url: 'https://x/s2.pdf' },
  ];
  const links = [
    { sheet_id: 's1', product_barcode: 'P1' },
    { sheet_id: 's2', product_barcode: 'P1' },
    { sheet_id: 's2', product_barcode: 'P3' },
  ];
  const images = [{ barcode: 'P2', name: 'Plancha', brand: 'ROLLER', url: 'https://x/p2.jpg' }];

  it('follows the quote order, uses the photo of a product without a sheet, and includes a shared sheet once', () => {
    const sections = sectionsForQuote(
      [
        { product: { barcode: 'P2', name: 'Plancha', brand: 'ROLLER' } },
        { product: { barcode: 'P1', name: 'Four', brand: 'OLIS' }, quoteName: 'Four mixte 10 niveaux' },
        { product: { barcode: 'P3', name: 'Hotte' } },
        { product: { barcode: 'P1', name: 'Four' } },
      ],
      sheets, links, images,
    );
    expect(sections.map(section => section.heading)).toEqual(['Plancha', 'Four mixte 10 niveaux']);
    expect(sections[0].files).toEqual([{ url: 'https://x/p2.jpg', label: 'Photo Plancha', kind: 'image' }]);
    expect(sections[1].files.map(file => file.label)).toEqual(['Fiche four', 'Fiche commune']);
  });

  it('lists the share page sheets then the photos', () => {
    expect(sectionsForShare(sheets, images).map(section => section.heading)).toEqual(['Fiche four', 'Fiche commune', 'Plancha']);
  });
});
