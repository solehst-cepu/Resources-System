import express from 'express';
import { createApiRouter } from '../server/apiRouter.js';

const app = express();

app.use((_req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  next();
});

const apiRouter = createApiRouter();

// Mount pada '/api' (saat req.url mempertahankan prefix '/api/...')
app.use('/api', apiRouter);
// Fallback jika platform meneruskan path tanpa prefix '/api'
app.use('/', apiRouter);

export default app;
