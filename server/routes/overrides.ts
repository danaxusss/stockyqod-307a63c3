import { Router } from 'express';
import { prisma } from '../db.js';

const router = Router();

// GET /api/overrides
router.get('/', async (_req, res) => {
  try {
    const overrides = await prisma.productNameOverride.findMany({ orderBy: { created_at: 'asc' } });
    return res.json({ overrides });
  } catch (err) {
    return res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/overrides — upsert
router.post('/', async (req, res) => {
  try {
    const { type, original_name, custom_name } = req.body as { type: string; original_name: string; custom_name: string };
    if (!type || !original_name || !custom_name) {
      return res.status(400).json({ error: 'type, original_name, custom_name required' });
    }
    const override = await prisma.productNameOverride.upsert({
      where: { type_original_name: { type, original_name } },
      create: { type, original_name, custom_name },
      update: { custom_name },
    });
    return res.json({ override });
  } catch (err) {
    return res.status(500).json({ error: 'Server error' });
  }
});

// DELETE /api/overrides/:id
router.delete('/:id', async (req, res) => {
  try {
    await prisma.productNameOverride.delete({ where: { id: req.params.id } });
    return res.json({ success: true });
  } catch (err) {
    return res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/overrides/revert — revert products to original name and delete override
router.post('/revert', async (req, res) => {
  try {
    const { id, field, custom_name, original_name } = req.body as {
      id: string; field: 'brand' | 'provider'; custom_name: string; original_name: string;
    };
    // Update all products using the custom name back to original
    await prisma.product.updateMany({
      where: { [field]: custom_name },
      data: { [field]: original_name },
    });
    await prisma.productNameOverride.delete({ where: { id } });
    return res.json({ success: true });
  } catch (err) {
    return res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/overrides/apply — apply override to all products with given name
router.post('/apply', async (req, res) => {
  try {
    const { field, current_name, new_name } = req.body as {
      field: 'brand' | 'provider'; current_name: string; new_name: string;
    };
    await prisma.product.updateMany({
      where: { [field]: current_name },
      data: { [field]: new_name },
    });
    return res.json({ success: true });
  } catch (err) {
    return res.status(500).json({ error: 'Server error' });
  }
});

export default router;
