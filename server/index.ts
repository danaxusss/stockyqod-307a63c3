import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

import authRouter from './routes/auth.js';
import productsRouter from './routes/products.js';
import quotesRouter from './routes/quotes.js';
import clientsRouter from './routes/clients.js';
import settingsRouter from './routes/settings.js';
import sheetsRouter from './routes/sheets.js';
import activityRouter from './routes/activity.js';
import overridesRouter from './routes/overrides.js';
import uploadRouter from './routes/upload.js';
import aiRouter from './routes/ai.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = parseInt(process.env.PORT ?? '3001', 10);
const isDev = process.env.NODE_ENV !== 'production';

// Resolve uploads directory
const UPLOADS_DIR = process.env.UPLOADS_DIR
  ? path.resolve(process.env.UPLOADS_DIR)
  : path.resolve(process.cwd(), 'uploads');

// Ensure uploads subdirectories exist
['logos', 'sheets'].forEach(sub => {
  const dir = path.join(UPLOADS_DIR, sub);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});

// Expose to routes
process.env.UPLOADS_DIR_RESOLVED = UPLOADS_DIR;

const app = express();

app.use(cors());
app.use(express.json({ limit: '50mb' }));

// Serve uploaded files
app.use('/uploads', express.static(UPLOADS_DIR));

// API routes
app.use('/api/auth', authRouter);
app.use('/api/products', productsRouter);
app.use('/api/quotes', quotesRouter);
app.use('/api/clients', clientsRouter);
app.use('/api/settings', settingsRouter);
app.use('/api/sheets', sheetsRouter);
app.use('/api/activity', activityRouter);
app.use('/api/overrides', overridesRouter);
app.use('/api/upload', uploadRouter);
app.use('/api/ai', aiRouter);

// In production: serve the Vite build
if (!isDev) {
  const distPath = path.resolve(process.cwd(), 'dist');
  app.use(express.static(distPath));
  // SPA fallback — all non-API routes return index.html
  app.get(/^(?!\/api|\/uploads).*/, (_req, res) => {
    res.sendFile(path.join(distPath, 'index.html'));
  });
}

app.listen(PORT, () => {
  console.log(`Stocky server running on port ${PORT} (${isDev ? 'development' : 'production'})`);
  console.log(`Uploads directory: ${UPLOADS_DIR}`);
});
