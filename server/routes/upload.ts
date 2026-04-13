import { Router } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { randomUUID } from 'crypto';

const router = Router();

function getUploadsDir() {
  return process.env.UPLOADS_DIR_RESOLVED ?? path.resolve(process.cwd(), 'uploads');
}

function makeStorage(subdir: string) {
  return multer.diskStorage({
    destination: (_req, _file, cb) => {
      const dir = path.join(getUploadsDir(), subdir);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      cb(null, dir);
    },
    filename: (_req, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase() || '.bin';
      cb(null, `${randomUUID()}${ext}`);
    },
  });
}

const uploadLogo = multer({
  storage: makeStorage('logos'),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const allowed = ['image/jpeg', 'image/png', 'image/webp', 'image/svg+xml', 'image/gif'];
    cb(null, allowed.includes(file.mimetype));
  },
});

const uploadSheet = multer({
  storage: makeStorage('sheets'),
  limits: { fileSize: 50 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    cb(null, file.mimetype === 'application/pdf');
  },
});

// POST /api/upload/logo
router.post('/logo', uploadLogo.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded or invalid type' });
  const url = `/uploads/logos/${req.file.filename}?t=${Date.now()}`;
  return res.json({ url, filename: req.file.filename });
});

// POST /api/upload/sheet
router.post('/sheet', uploadSheet.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No PDF uploaded' });
  const url = `/uploads/sheets/${req.file.filename}`;
  return res.json({ url, filename: req.file.filename, size: req.file.size, mimetype: req.file.mimetype });
});

export default router;
