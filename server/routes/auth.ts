import { Router } from 'express';
import { prisma } from '../db.js';
import { hashPin, verifyPin } from '../lib/pin.js';

const router = Router();

// POST /api/auth/login — verify username + PIN, return safe user object
router.post('/login', async (req, res) => {
  try {
    const { username, pin } = req.body as { username?: string; pin?: string };
    if (!username || !pin) {
      return res.status(400).json({ error: 'username and pin required' });
    }

    const user = await prisma.appUser.findUnique({ where: { username } });
    if (!user) return res.status(401).json({ success: false, error: 'Identifiants invalides' });

    const valid = verifyPin(pin, user.pin);
    if (!valid) return res.status(401).json({ success: false, error: 'Identifiants invalides' });

    // Auto-upgrade plaintext PINs to PBKDF2
    if (!user.pin.startsWith('pbkdf2:')) {
      await prisma.appUser.update({
        where: { id: user.id },
        data: { pin: hashPin(pin) },
      });
    }

    return res.json({
      success: true,
      user: safeUser(user),
    });
  } catch (err) {
    console.error('Login error:', err);
    return res.status(500).json({ error: 'Server error' });
  }
});

// GET /api/auth/users — list all users (without PIN), for login dropdown
router.get('/users', async (_req, res) => {
  try {
    const users = await prisma.appUser.findMany({
      select: {
        id: true,
        username: true,
        is_admin: true,
        can_create_quote: true,
        allowed_stock_locations: true,
        allowed_brands: true,
        price_display_type: true,
        custom_seller_name: true,
        created_at: true,
        updated_at: true,
      },
      orderBy: { username: 'asc' },
    });
    return res.json({ users });
  } catch (err) {
    console.error('Get users error:', err);
    return res.status(500).json({ error: 'Server error' });
  }
});

function safeUser(user: {
  id: string; username: string; is_admin: boolean; can_create_quote: boolean;
  allowed_stock_locations: string[]; allowed_brands: string[]; price_display_type: string;
  custom_seller_name: string | null; created_at: Date; updated_at: Date;
}) {
  return {
    id: user.id,
    username: user.username,
    is_admin: user.is_admin,
    can_create_quote: user.can_create_quote,
    allowed_stock_locations: user.allowed_stock_locations,
    allowed_brands: user.allowed_brands,
    price_display_type: user.price_display_type,
    custom_seller_name: user.custom_seller_name ?? '',
    created_at: user.created_at,
    updated_at: user.updated_at,
  };
}

// POST /api/auth/login-by-pin — verify by PIN only (admin re-auth)
// Tries to match provided PIN against the stored user (identified by username in body)
router.post('/login-by-pin', async (req, res) => {
  try {
    const { username, pin } = req.body as { username?: string; pin?: string };
    if (!pin) return res.status(400).json({ error: 'pin required' });

    // If username provided, just verify that user's PIN (preferred)
    if (username) {
      const user = await prisma.appUser.findUnique({ where: { username } });
      if (user && verifyPin(pin, user.pin)) {
        return res.json({ success: true, user: safeUser(user) });
      }
      return res.status(401).json({ success: false, error: 'PIN invalide' });
    }

    // Fallback: find any admin user with matching PIN (legacy)
    const admins = await prisma.appUser.findMany({ where: { is_admin: true } });
    for (const admin of admins) {
      if (verifyPin(pin, admin.pin)) {
        return res.json({ success: true, user: safeUser(admin) });
      }
    }
    return res.status(401).json({ success: false, error: 'PIN invalide' });
  } catch (err) {
    console.error('Login by PIN error:', err);
    return res.status(500).json({ error: 'Server error' });
  }
});

export default router;
