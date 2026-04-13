import { Router } from 'express';
import { prisma } from '../db.js';
import { verifyPin } from '../lib/pin.js';

const router = Router();

// GET /api/settings — company settings
router.get('/', async (_req, res) => {
  try {
    const settings = await prisma.companySettings.findFirst();
    return res.json({ settings: settings ?? null });
  } catch (err) {
    return res.status(500).json({ error: 'Server error' });
  }
});

// PUT /api/settings
router.put('/', async (req, res) => {
  try {
    const current = await prisma.companySettings.findFirst();
    if (!current) return res.status(404).json({ error: 'Settings not found' });
    const { id: _id, updated_at: _u, ...data } = req.body;
    const settings = await prisma.companySettings.update({
      where: { id: current.id },
      data,
    });
    return res.json({ settings });
  } catch (err) {
    console.error('Update settings error:', err);
    return res.status(500).json({ error: 'Server error' });
  }
});

// GET /api/settings/ai
router.get('/ai', async (_req, res) => {
  try {
    const ai = await prisma.aiSettings.findFirst();
    // Never expose the raw API key to the client
    if (!ai) return res.json({ ai: null });
    return res.json({
      ai: {
        id: ai.id,
        provider: ai.provider,
        model: ai.model,
        enabled: ai.enabled,
        has_key: !!(ai.api_key && ai.api_key.length > 0),
      },
    });
  } catch (err) {
    return res.status(500).json({ error: 'Server error' });
  }
});

// PUT /api/settings/ai — admin PIN required
router.put('/ai', async (req, res) => {
  try {
    const { admin_username, admin_pin, provider, api_key, model, enabled } = req.body as {
      admin_username?: string; admin_pin?: string;
      provider?: string; api_key?: string; model?: string; enabled?: boolean;
    };

    if (!admin_username || !admin_pin) {
      return res.status(401).json({ error: 'Admin credentials required' });
    }
    const admin = await prisma.appUser.findUnique({ where: { username: admin_username } });
    if (!admin || !admin.is_admin || !verifyPin(admin_pin, admin.pin)) {
      return res.status(401).json({ error: 'Invalid admin credentials' });
    }

    const current = await prisma.aiSettings.findFirst();
    const update: Record<string, unknown> = { enabled: enabled ?? false };
    if (provider !== undefined) update.provider = provider;
    if (model !== undefined) update.model = model;
    // Only update api_key if a non-empty value was supplied
    if (api_key && api_key.trim().length > 0) update.api_key = api_key.trim();

    const ai = current
      ? await prisma.aiSettings.update({ where: { id: current.id }, data: update })
      : await prisma.aiSettings.create({ data: { provider, api_key, model, enabled: enabled ?? false } });

    return res.json({
      ai: { id: ai.id, provider: ai.provider, model: ai.model, enabled: ai.enabled, has_key: !!(ai.api_key) },
    });
  } catch (err) {
    console.error('Update AI settings error:', err);
    return res.status(500).json({ error: 'Server error' });
  }
});

// ── Admin Users ────────────────────────────────────────────────────────────

async function verifyAdmin(username: string, pin: string): Promise<boolean> {
  const user = await prisma.appUser.findUnique({ where: { username } });
  return !!(user && user.is_admin && verifyPin(pin, user.pin));
}

// GET /api/settings/users
router.get('/users', async (_req, res) => {
  try {
    const users = await prisma.appUser.findMany({
      select: {
        id: true, username: true, is_admin: true, can_create_quote: true,
        allowed_stock_locations: true, allowed_brands: true,
        price_display_type: true, custom_seller_name: true,
        created_at: true, updated_at: true,
      },
      orderBy: { username: 'asc' },
    });
    return res.json({ users });
  } catch (err) {
    return res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/settings/users — create user (admin required)
router.post('/users', async (req, res) => {
  try {
    const { admin_username, admin_pin, username, pin, ...userData } = req.body;
    if (!await verifyAdmin(admin_username, admin_pin)) {
      return res.status(401).json({ error: 'Invalid admin credentials' });
    }
    if (!username || !pin) return res.status(400).json({ error: 'username and pin required' });
    if (pin.length !== 6 || !/^\d{6}$/.test(pin)) {
      return res.status(400).json({ error: 'PIN must be 6 digits' });
    }
    const { hashPin } = await import('../lib/pin.js');
    const user = await prisma.appUser.create({
      data: { username, pin: hashPin(pin), ...userData },
      select: {
        id: true, username: true, is_admin: true, can_create_quote: true,
        allowed_stock_locations: true, allowed_brands: true,
        price_display_type: true, custom_seller_name: true,
        created_at: true, updated_at: true,
      },
    });
    return res.status(201).json({ user });
  } catch (err: any) {
    if (err.code === 'P2002') return res.status(409).json({ error: 'Username already taken' });
    return res.status(500).json({ error: 'Server error' });
  }
});

// PUT /api/settings/users/:id — update user (admin required)
router.put('/users/:id', async (req, res) => {
  try {
    const { admin_username, admin_pin, pin, ...userData } = req.body;
    if (!await verifyAdmin(admin_username, admin_pin)) {
      return res.status(401).json({ error: 'Invalid admin credentials' });
    }
    const update: Record<string, unknown> = { ...userData };
    if (pin && pin.length > 0) {
      if (pin.length !== 6 || !/^\d{6}$/.test(pin)) {
        return res.status(400).json({ error: 'PIN must be 6 digits' });
      }
      const { hashPin } = await import('../lib/pin.js');
      update.pin = hashPin(pin);
    }
    const user = await prisma.appUser.update({
      where: { id: req.params.id },
      data: update,
      select: {
        id: true, username: true, is_admin: true, can_create_quote: true,
        allowed_stock_locations: true, allowed_brands: true,
        price_display_type: true, custom_seller_name: true,
        created_at: true, updated_at: true,
      },
    });
    return res.json({ user });
  } catch (err: any) {
    if (err.code === 'P2002') return res.status(409).json({ error: 'Username already taken' });
    return res.status(500).json({ error: 'Server error' });
  }
});

// DELETE /api/settings/users/:id — admin required
router.delete('/users/:id', async (req, res) => {
  try {
    const { admin_username, admin_pin } = req.body;
    if (!await verifyAdmin(admin_username, admin_pin)) {
      return res.status(401).json({ error: 'Invalid admin credentials' });
    }
    await prisma.appUser.delete({ where: { id: req.params.id } });
    return res.json({ success: true });
  } catch (err) {
    return res.status(500).json({ error: 'Server error' });
  }
});

// GET /api/settings/users/check-username
router.get('/users/check-username', async (req, res) => {
  try {
    const username = String(req.query.username ?? '');
    const excludeId = req.query.exclude_id ? String(req.query.exclude_id) : undefined;
    const existing = await prisma.appUser.findFirst({
      where: { username, ...(excludeId ? { NOT: { id: excludeId } } : {}) },
    });
    return res.json({ available: !existing });
  } catch (err) {
    return res.status(500).json({ error: 'Server error' });
  }
});

export default router;
