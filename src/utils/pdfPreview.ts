import { loadPdfjs } from './converter';

/**
 * Render the first pages of a PDF as images. Drawing the pages ourselves
 * works everywhere, including phones that cannot show a PDF inside a page.
 */
export async function renderPdfPages(data: ArrayBuffer, maxPages = 3, width = 900): Promise<{ pages: string[]; numPages: number }> {
  const pdfjs = await loadPdfjs();
  pdfjs.GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url).toString();
  const doc = await pdfjs.getDocument({ data }).promise;
  const pages: string[] = [];
  for (let number = 1; number <= Math.min(maxPages, doc.numPages); number++) {
    const page = await doc.getPage(number);
    const base = page.getViewport({ scale: 1 });
    const viewport = page.getViewport({ scale: Math.min(3, width / base.width) });
    const canvas = document.createElement('canvas');
    canvas.width = Math.ceil(viewport.width);
    canvas.height = Math.ceil(viewport.height);
    const context = canvas.getContext('2d');
    if (!context) break;
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvasContext: context, viewport, canvas }).promise;
    pages.push(canvas.toDataURL('image/jpeg', 0.85));
  }
  return { pages, numPages: doc.numPages };
}
