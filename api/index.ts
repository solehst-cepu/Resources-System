import express from 'express';
import { createApiRouter } from '../server/apiRouter.js';

const app = express();

// Normalisasi req.url saat Vercel melakukan rewrite ke /api/index
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');

  try {
    const parsed = new URL(req.url || '/', 'http://localhost');
    const forwardedPath = parsed.searchParams.get('__lrms_path');

    if (forwardedPath !== null) {
      parsed.searchParams.delete('__lrms_path');
      const cleaned = forwardedPath.startsWith('/') ? forwardedPath : `/${forwardedPath}`;
      const withoutApiPrefix = cleaned.replace(/^\/api(?=\/|$)/, '') || '/';
      const qs = parsed.searchParams.toString();
      req.url = `/api${withoutApiPrefix === '/' ? '' : withoutApiPrefix}${qs ? `?${qs}` : ''}`;
    } else if (parsed.pathname === '/api/index' || parsed.pathname === '/api/index.ts') {
      const headerUri =
        (req.headers['x-vercel-original-uri'] as string | undefined) ||
        (req.headers['x-now-route-uri'] as string | undefined);
      if (headerUri && headerUri.startsWith('/api/') && !headerUri.startsWith('/api/index')) {
        req.url = headerUri;
      }
    }
  } catch {
    // Biarkan req.url apa adanya jika parsing gagal
  }

  next();
});

const apiRouter = createApiRouter();

app.use('/api', apiRouter);
app.use('/', apiRouter);

export default app;
