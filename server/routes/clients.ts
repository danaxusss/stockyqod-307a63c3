import { Router } from 'express';
import { prisma } from '../db.js';

const router = Router();

// GET /api/clients
router.get('/', async (_req, res) => {
  try {
    const clients = await prisma.client.findMany({ orderBy: { created_at: 'desc' } });
    return res.json({ clients });
  } catch (err) {
    return res.status(500).json({ error: 'Server error' });
  }
});

// GET /api/clients/search?q=
router.get('/search', async (req, res) => {
  try {
    const q = String(req.query.q ?? '').trim();
    if (!q) return res.json({ clients: [] });
    const clients = await prisma.client.findMany({
      where: {
        OR: [
          { full_name: { contains: q, mode: 'insensitive' } },
          { phone_number: { contains: q, mode: 'insensitive' } },
        ],
      },
      orderBy: { full_name: 'asc' },
      take: 10,
    });
    return res.json({ clients });
  } catch (err) {
    return res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/clients — create
router.post('/', async (req, res) => {
  try {
    const client = await prisma.client.create({ data: req.body });
    return res.status(201).json({ client });
  } catch (err: any) {
    if (err.code === 'P2002') return res.status(409).json({ error: 'Phone number already exists' });
    return res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/clients/upsert — upsert by phone_number
router.post('/upsert', async (req, res) => {
  try {
    const { phone_number, ...rest } = req.body;
    const client = await prisma.client.upsert({
      where: { phone_number },
      create: { phone_number, ...rest },
      update: rest,
    });
    return res.json({ client });
  } catch (err) {
    return res.status(500).json({ error: 'Server error' });
  }
});

// PUT /api/clients/:id
router.put('/:id', async (req, res) => {
  try {
    const client = await prisma.client.update({ where: { id: req.params.id }, data: req.body });
    return res.json({ client });
  } catch (err) {
    return res.status(500).json({ error: 'Server error' });
  }
});

// DELETE /api/clients/:id — blocked if client has quotes
router.delete('/:id', async (req, res) => {
  try {
    const client = await prisma.client.findUnique({ where: { id: req.params.id } });
    if (!client) return res.status(404).json({ error: 'Not found' });

    // Check for linked quotes by phone number
    const linkedQuotes = await prisma.quote.count({
      where: {
        customer_info: {
          path: ['phoneNumber'],
          equals: client.phone_number,
        },
      },
    });
    if (linkedQuotes > 0) {
      return res.status(409).json({ error: `Ce client a ${linkedQuotes} devis associé(s). Supprimez-les d'abord.` });
    }

    await prisma.client.delete({ where: { id: req.params.id } });
    return res.json({ success: true });
  } catch (err) {
    console.error('Delete client error:', err);
    return res.status(500).json({ error: 'Server error' });
  }
});

export default router;
