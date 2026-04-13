import { Router } from 'express';
import { prisma } from '../db.js';

const router = Router();

// GET /api/quotes
router.get('/', async (_req, res) => {
  try {
    const quotes = await prisma.quote.findMany({ orderBy: { created_at: 'desc' } });
    return res.json({ quotes });
  } catch (err) {
    console.error('Get quotes error:', err);
    return res.status(500).json({ error: 'Server error' });
  }
});

// GET /api/quotes/:id
router.get('/:id', async (req, res) => {
  try {
    const quote = await prisma.quote.findUnique({ where: { id: req.params.id } });
    if (!quote) return res.status(404).json({ error: 'Not found' });
    return res.json({ quote });
  } catch (err) {
    return res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/quotes — upsert (create or update)
router.post('/', async (req, res) => {
  try {
    const q = req.body;
    const quote = await prisma.quote.upsert({
      where: { id: q.id },
      create: {
        id: q.id,
        quote_number: q.quote_number,
        command_number: q.command_number ?? null,
        status: q.status ?? 'draft',
        customer_info: q.customer_info ?? {},
        items: q.items ?? [],
        total_amount: q.total_amount ?? 0,
        notes: q.notes ?? null,
        created_at: q.created_at ? new Date(q.created_at) : undefined,
        updated_at: new Date(),
      },
      update: {
        quote_number: q.quote_number,
        command_number: q.command_number ?? null,
        status: q.status,
        customer_info: q.customer_info ?? {},
        items: q.items ?? [],
        total_amount: q.total_amount ?? 0,
        notes: q.notes ?? null,
        updated_at: new Date(),
      },
    });
    return res.json({ quote });
  } catch (err) {
    console.error('Upsert quote error:', err);
    return res.status(500).json({ error: 'Server error' });
  }
});

// PATCH /api/quotes/:id/status
router.patch('/:id/status', async (req, res) => {
  try {
    const { status } = req.body as { status: string };
    const valid = ['draft', 'pending', 'final'];
    if (!valid.includes(status)) return res.status(400).json({ error: 'Invalid status' });
    const quote = await prisma.quote.update({
      where: { id: req.params.id },
      data: { status, updated_at: new Date() },
    });
    return res.json({ quote });
  } catch (err) {
    return res.status(500).json({ error: 'Server error' });
  }
});

// DELETE /api/quotes/:id
router.delete('/:id', async (req, res) => {
  try {
    await prisma.quote.delete({ where: { id: req.params.id } });
    return res.json({ success: true });
  } catch (err) {
    return res.status(500).json({ error: 'Server error' });
  }
});

// ── Templates ──────────────────────────────────────────────────────────────

// GET /api/quotes/templates/all
router.get('/templates/all', async (_req, res) => {
  try {
    const templates = await prisma.quoteTemplate.findMany({ orderBy: { uploaded_at: 'desc' } });
    return res.json({ templates });
  } catch (err) {
    return res.status(500).json({ error: 'Server error' });
  }
});

// GET /api/quotes/templates/active
router.get('/templates/active', async (_req, res) => {
  try {
    const template = await prisma.quoteTemplate.findFirst({ where: { is_active: true } });
    return res.json({ template: template ?? null });
  } catch (err) {
    return res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/quotes/templates
router.post('/templates', async (req, res) => {
  try {
    const { id, name, file_data, file_type } = req.body;
    const template = await prisma.quoteTemplate.upsert({
      where: { id },
      create: { id, name, file_data, file_type },
      update: { name, file_data, file_type },
    });
    return res.json({ template });
  } catch (err) {
    return res.status(500).json({ error: 'Server error' });
  }
});

// PATCH /api/quotes/templates/:id/activate
router.patch('/templates/:id/activate', async (req, res) => {
  try {
    await prisma.quoteTemplate.updateMany({ where: { is_active: true }, data: { is_active: false } });
    const template = await prisma.quoteTemplate.update({
      where: { id: req.params.id },
      data: { is_active: true },
    });
    return res.json({ template });
  } catch (err) {
    return res.status(500).json({ error: 'Server error' });
  }
});

// DELETE /api/quotes/templates/:id
router.delete('/templates/:id', async (req, res) => {
  try {
    await prisma.quoteTemplate.delete({ where: { id: req.params.id } });
    return res.json({ success: true });
  } catch (err) {
    return res.status(500).json({ error: 'Server error' });
  }
});

export default router;
