import { Router } from 'express';
import path from 'path';
import fs from 'fs';
import { prisma } from '../db.js';

const router = Router();

function getUploadsDir() {
  return process.env.UPLOADS_DIR_RESOLVED ?? path.resolve(process.cwd(), 'uploads');
}

// GET /api/sheets/sheet-counts — count of linked sheets per product_barcode (all products)
router.get('/sheet-counts', async (_req, res) => {
  try {
    const rows = await prisma.technicalSheetProduct.findMany({ select: { product_barcode: true } });
    const counts: Record<string, number> = {};
    for (const r of rows) {
      counts[r.product_barcode] = (counts[r.product_barcode] || 0) + 1;
    }
    return res.json({ counts });
  } catch (err) {
    return res.status(500).json({ error: 'Server error' });
  }
});

// GET /api/sheets/for-product/:barcode — sheets linked to a specific product
router.get('/for-product/:barcode', async (req, res) => {
  try {
    const links = await prisma.technicalSheetProduct.findMany({
      where: { product_barcode: req.params.barcode },
      select: { sheet_id: true },
    });
    const sheetIds = links.map(l => l.sheet_id);
    if (sheetIds.length === 0) return res.json({ sheets: [] });
    const sheets = await prisma.technicalSheet.findMany({
      where: { id: { in: sheetIds } },
      include: { products: true },
      orderBy: { title: 'asc' },
    });
    return res.json({ sheets: sheets.map(s => ({ ...s, file_size: s.file_size.toString() })) });
  } catch (err) {
    return res.status(500).json({ error: 'Server error' });
  }
});

function serializeSheet(s: Record<string, unknown>) {
  return { ...s, file_size: s.file_size?.toString() ?? '0' };
}

// GET /api/sheets
router.get('/', async (_req, res) => {
  try {
    const sheets = await prisma.technicalSheet.findMany({
      include: { products: true },
      orderBy: { created_at: 'desc' },
    });
    return res.json({ sheets: sheets.map(s => serializeSheet(s as unknown as Record<string, unknown>)) });
  } catch (err) {
    return res.status(500).json({ error: 'Server error' });
  }
});

// GET /api/sheets/:id
router.get('/:id', async (req, res) => {
  try {
    const sheet = await prisma.technicalSheet.findUnique({
      where: { id: req.params.id },
      include: { products: true },
    });
    if (!sheet) return res.status(404).json({ error: 'Not found' });
    // Increment view count
    await prisma.technicalSheet.update({ where: { id: req.params.id }, data: { view_count: { increment: 1 } } });
    return res.json({ sheet: serializeSheet(sheet as unknown as Record<string, unknown>) });
  } catch (err) {
    return res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/sheets — create with metadata (file uploaded separately via /api/upload/sheet)
router.post('/', async (req, res) => {
  try {
    const { title, manufacturer, category, sector, file_url, file_size, file_type } = req.body;
    const sheet = await prisma.technicalSheet.create({
      data: { title, manufacturer: manufacturer ?? '', category: category ?? '', sector: sector ?? '', file_url, file_size: BigInt(file_size ?? 0), file_type: file_type ?? 'application/pdf' },
    });
    return res.status(201).json({ sheet: { ...sheet, file_size: sheet.file_size.toString() } });
  } catch (err) {
    console.error('Create sheet error:', err);
    return res.status(500).json({ error: 'Server error' });
  }
});

// PUT /api/sheets/:id — update metadata
router.put('/:id', async (req, res) => {
  try {
    const { title, manufacturer, category, sector } = req.body;
    const sheet = await prisma.technicalSheet.update({
      where: { id: req.params.id },
      data: { title, manufacturer, category, sector },
    });
    return res.json({ sheet: { ...sheet, file_size: sheet.file_size.toString() } });
  } catch (err) {
    return res.status(500).json({ error: 'Server error' });
  }
});

// PATCH /api/sheets/:id/download — increment download count
router.patch('/:id/download', async (req, res) => {
  try {
    await prisma.technicalSheet.update({
      where: { id: req.params.id },
      data: { download_count: { increment: 1 } },
    });
    return res.json({ success: true });
  } catch (err) {
    return res.status(500).json({ error: 'Server error' });
  }
});

// DELETE /api/sheets/:id
router.delete('/:id', async (req, res) => {
  try {
    const sheet = await prisma.technicalSheet.findUnique({ where: { id: req.params.id } });
    if (!sheet) return res.status(404).json({ error: 'Not found' });

    // Delete physical file
    if (sheet.file_url && sheet.file_url.startsWith('/uploads/')) {
      const filePath = path.join(getUploadsDir(), sheet.file_url.replace('/uploads/', ''));
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    }

    await prisma.technicalSheetProduct.deleteMany({ where: { sheet_id: req.params.id } });
    await prisma.technicalSheet.delete({ where: { id: req.params.id } });
    return res.json({ success: true });
  } catch (err) {
    return res.status(500).json({ error: 'Server error' });
  }
});

// ── Product links ──────────────────────────────────────────────────────────

// POST /api/sheets/:id/products — link products
router.post('/:id/products', async (req, res) => {
  try {
    const { barcodes } = req.body as { barcodes: string[] };
    if (!Array.isArray(barcodes) || barcodes.length === 0) {
      return res.status(400).json({ error: 'barcodes array required' });
    }
    const inserts = barcodes.map(b => ({ sheet_id: req.params.id, product_barcode: b }));
    await prisma.technicalSheetProduct.createMany({ data: inserts, skipDuplicates: true });
    return res.json({ success: true });
  } catch (err) {
    return res.status(500).json({ error: 'Server error' });
  }
});

// DELETE /api/sheets/:id/products/:barcode
router.delete('/:id/products/:barcode', async (req, res) => {
  try {
    await prisma.technicalSheetProduct.deleteMany({
      where: { sheet_id: req.params.id, product_barcode: req.params.barcode },
    });
    return res.json({ success: true });
  } catch (err) {
    return res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/sheets/by-products — get sheet IDs and per-barcode counts for a list of product barcodes
router.post('/by-products', async (req, res) => {
  try {
    const { barcodes } = req.body as { barcodes: string[] };
    if (!Array.isArray(barcodes) || barcodes.length === 0) {
      return res.json({ sheet_ids: [], product_sheet_counts: {} });
    }
    const rows = await prisma.technicalSheetProduct.findMany({
      where: { product_barcode: { in: barcodes } },
      select: { sheet_id: true, product_barcode: true },
    });
    const sheet_ids = [...new Set(rows.map(r => r.sheet_id))];
    const product_sheet_counts: Record<string, number> = {};
    for (const r of rows) {
      product_sheet_counts[r.product_barcode] = (product_sheet_counts[r.product_barcode] || 0) + 1;
    }
    return res.json({ sheet_ids, product_sheet_counts });
  } catch (err) {
    return res.status(500).json({ error: 'Server error' });
  }
});

// ── Share links ─────────────────────────────────────────────────────────────

// GET /api/sheets/share/list
router.get('/share/list', async (_req, res) => {
  try {
    const links = await prisma.sheetShareLink.findMany({ orderBy: { created_at: 'desc' } });
    return res.json({ links });
  } catch (err) {
    return res.status(500).json({ error: 'Server error' });
  }
});

// GET /api/sheets/share/:token
router.get('/share/:token', async (req, res) => {
  try {
    const link = await prisma.sheetShareLink.findUnique({ where: { token: req.params.token } });
    if (!link) return res.status(404).json({ error: 'Link not found' });
    if (link.expires_at && new Date() > link.expires_at) {
      return res.status(410).json({ error: 'Link expired' });
    }
    await prisma.sheetShareLink.update({ where: { id: link.id }, data: { view_count: { increment: 1 } } });

    const sheets = await prisma.technicalSheet.findMany({
      where: { id: { in: link.sheet_ids } },
      include: { products: true },
    });
    return res.json({ link, sheets: sheets.map(s => serializeSheet(s as unknown as Record<string, unknown>)) });
  } catch (err) {
    return res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/sheets/share — create share link
router.post('/share', async (req, res) => {
  try {
    const { token, title, sheet_ids, expires_at } = req.body;
    const link = await prisma.sheetShareLink.create({
      data: {
        token,
        title: title ?? null,
        sheet_ids: sheet_ids ?? [],
        expires_at: expires_at ? new Date(expires_at) : null,
      },
    });
    return res.status(201).json({ link });
  } catch (err) {
    return res.status(500).json({ error: 'Server error' });
  }
});

// DELETE /api/sheets/share/:id
router.delete('/share/:id', async (req, res) => {
  try {
    await prisma.sheetShareLink.delete({ where: { id: req.params.id } });
    return res.json({ success: true });
  } catch (err) {
    return res.status(500).json({ error: 'Server error' });
  }
});

export default router;
