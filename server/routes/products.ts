import { Router } from 'express';
import { prisma } from '../db.js';

const router = Router();

// GET /api/products — all products
router.get('/', async (_req, res) => {
  try {
    const products = await prisma.product.findMany({ orderBy: { name: 'asc' } });
    return res.json({ products });
  } catch (err) {
    console.error('Get products error:', err);
    return res.status(500).json({ error: 'Server error' });
  }
});

// GET /api/products/brands — distinct brands list
router.get('/brands', async (_req, res) => {
  try {
    const rows = await prisma.product.findMany({ select: { brand: true }, distinct: ['brand'] });
    const brands = rows.map(r => r.brand).filter(Boolean).sort();
    return res.json({ brands });
  } catch (err) {
    return res.status(500).json({ error: 'Server error' });
  }
});

// GET /api/products/providers — distinct providers list
router.get('/providers', async (_req, res) => {
  try {
    const rows = await prisma.product.findMany({ select: { provider: true }, distinct: ['provider'] });
    const providers = rows.map(r => r.provider).filter(Boolean).sort();
    return res.json({ providers });
  } catch (err) {
    return res.status(500).json({ error: 'Server error' });
  }
});

// GET /api/products/locations — distinct stock location keys
router.get('/locations', async (_req, res) => {
  try {
    const rows = await prisma.product.findMany({ select: { stock_levels: true } });
    const locs = new Set<string>();
    for (const r of rows) {
      if (r.stock_levels && typeof r.stock_levels === 'object') {
        Object.keys(r.stock_levels as Record<string, unknown>).forEach(k => locs.add(k));
      }
    }
    return res.json({ locations: Array.from(locs).sort() });
  } catch (err) {
    return res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/products/bulk — upsert many products (Excel import)
router.post('/bulk', async (req, res) => {
  try {
    const { products } = req.body as { products: Array<Record<string, unknown>> };
    if (!Array.isArray(products) || products.length === 0) {
      return res.status(400).json({ error: 'products array required' });
    }

    // Fetch overrides for brand/provider name mapping
    const overrides = await prisma.productNameOverride.findMany();
    const brandMap = new Map<string, string>();
    const providerMap = new Map<string, string>();
    for (const o of overrides) {
      if (o.type === 'brand') brandMap.set(o.original_name, o.custom_name);
      else if (o.type === 'provider') providerMap.set(o.original_name, o.custom_name);
    }

    const existing = await prisma.product.findMany({ select: { barcode: true, brand: true, provider: true } });
    const existingMap = new Map(existing.map(p => [p.barcode, p]));
    const brandCustomValues = new Set([...brandMap.values()]);
    const providerCustomValues = new Set([...providerMap.values()]);

    const valid: Array<{
      barcode: string; name: string; brand: string; techsheet: string;
      price: number; buyprice: number; reseller_price: number; provider: string;
      stock_levels: Record<string, number>;
    }> = [];

    for (const p of products) {
      const barcode = String(p.barcode ?? '').trim();
      const name = String(p.name ?? '').trim();
      if (!barcode || !name) continue;

      let brand = String(p.brand ?? '').trim();
      let provider = String(p.provider ?? '').trim();

      const ex = existingMap.get(barcode);
      if (ex) {
        brand = brandCustomValues.has(ex.brand) ? ex.brand : (brandMap.get(brand) ?? brand);
        provider = providerCustomValues.has(ex.provider) ? ex.provider : (providerMap.get(provider) ?? provider);
      } else {
        brand = brandMap.get(brand) ?? brand;
        provider = providerMap.get(provider) ?? provider;
      }

      valid.push({
        barcode,
        name,
        brand,
        techsheet: String(p.techsheet ?? '').trim(),
        price: Number(p.price) || 0,
        buyprice: Number(p.buyprice) || 0,
        reseller_price: Number(p.reseller_price) || 0,
        provider,
        stock_levels: (p.stock_levels as Record<string, number>) ?? {},
      });
    }

    if (valid.length === 0) return res.status(400).json({ error: 'No valid products' });

    // Batch upsert in chunks of 100
    const BATCH = 100;
    for (let i = 0; i < valid.length; i += BATCH) {
      const batch = valid.slice(i, i + BATCH);
      await Promise.all(
        batch.map(p =>
          prisma.product.upsert({
            where: { barcode: p.barcode },
            create: p,
            update: { name: p.name, brand: p.brand, techsheet: p.techsheet, price: p.price, buyprice: p.buyprice, reseller_price: p.reseller_price, provider: p.provider, stock_levels: p.stock_levels },
          })
        )
      );
    }

    return res.json({ success: true, count: valid.length });
  } catch (err) {
    console.error('Bulk upsert error:', err);
    return res.status(500).json({ error: 'Server error' });
  }
});

// PUT /api/products/:barcode — update a single product
router.put('/:barcode', async (req, res) => {
  try {
    const { barcode } = req.params;
    const product = await prisma.product.update({ where: { barcode }, data: req.body });
    return res.json({ product });
  } catch (err) {
    return res.status(500).json({ error: 'Server error' });
  }
});

// DELETE /api/products/:barcode
router.delete('/:barcode', async (req, res) => {
  try {
    await prisma.product.delete({ where: { barcode: req.params.barcode } });
    return res.json({ success: true });
  } catch (err) {
    return res.status(500).json({ error: 'Server error' });
  }
});

export default router;
