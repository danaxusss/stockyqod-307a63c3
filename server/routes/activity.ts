import { Router } from 'express';
import { prisma } from '../db.js';

const router = Router();

// POST /api/activity — log an action
router.post('/', async (req, res) => {
  try {
    const { user_id, username, action, details, entity_type, entity_id } = req.body;
    if (!username || !action) return res.status(400).json({ error: 'username and action required' });
    const log = await prisma.activityLog.create({
      data: { user_id: user_id ?? null, username, action, details: details ?? null, entity_type: entity_type ?? null, entity_id: entity_id ?? null },
    });
    return res.status(201).json({ log });
  } catch (err) {
    return res.status(500).json({ error: 'Server error' });
  }
});

// GET /api/activity?limit=50
router.get('/', async (req, res) => {
  try {
    const limit = Math.min(parseInt(String(req.query.limit ?? '50'), 10), 200);
    const logs = await prisma.activityLog.findMany({ orderBy: { created_at: 'desc' }, take: limit });
    return res.json({ logs });
  } catch (err) {
    return res.status(500).json({ error: 'Server error' });
  }
});

// GET /api/activity/user/:username?limit=50
router.get('/user/:username', async (req, res) => {
  try {
    const limit = Math.min(parseInt(String(req.query.limit ?? '50'), 10), 200);
    const logs = await prisma.activityLog.findMany({
      where: { username: req.params.username },
      orderBy: { created_at: 'desc' },
      take: limit,
    });
    return res.json({ logs });
  } catch (err) {
    return res.status(500).json({ error: 'Server error' });
  }
});

export default router;
