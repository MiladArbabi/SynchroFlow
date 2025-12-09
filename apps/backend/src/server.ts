// apps/backend/src/server.ts
import dotenv from 'dotenv';
dotenv.config();
import { createApp } from './bootstrap/express';
import { initSpecterStore, closeSpecterStore } from './bootstrap/specter-store';
import { initQueue, closeQueue } from './bootstrap/queue';
import { federatedSearch } from './services/koreSearch';
import { seedSandboxData } from './db/seeder';

const port = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || '127.0.0.1';

const app = createApp();

// preserve the few non-route endpoints that live in the old server
app.get('/api/v1/kore/search', async (req, res) => {
  const query = req.query.q as string;
  if (!query) return res.status(400).json({ error: 'Missing query parameter "q"' });
  const results = await federatedSearch(query);
  return res.status(200).json(results);
});

// small number of retained helpers (seed, inventory endpoints, analytics etc.).
// For brevity we keep them here — you can extract them later into route files.
app.post('/api/v1/dev/seed-sandbox/:shop_id', async (req, res) => {
  try {
    const shopId = Number(req.params.shop_id);
    if (isNaN(shopId)) return res.status(400).json({ error: 'A valid shop_id is required.' });
    await seedSandboxData(shopId);
    res.status(200).json({ message: `Sandbox data seeded for shopId: ${shopId}` });
  } catch (err) {
    console.error('[seeder-endpoint] Error', err);
    res.status(500).json({ error: 'Failed to seed sandbox data' });
  }
});

// Start sequence and graceful shutdown wiring
let server: ReturnType<typeof app.listen> | null = null;

async function start() {
  // ensure optional infra initialized before declaring ready
  await initSpecterStore();
  await initQueue();

  server = app.listen(port, HOST, () => {
    console.log(`Server is listening on http://${HOST}:${port}`);
  });
}

async function shutdown(sig?: string) {
  console.log('[server] shutdown triggered', sig || '');
  try { await closeSpecterStore(); } catch (e) { /* ignore */ }
  try { await closeQueue(); } catch (e) { /* ignore */ }

  if (server) {
    try {
      server.close(() => {
        console.log('[server] HTTP server closed');
        process.exit(0);
      });
    } catch (_) {
      process.exit(0);
    }
  } else {
    process.exit(0);
  }
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

if (require.main === module) {
  // run start when file executed directly (node ./dist/server.js)
  start().catch((err) => {
    console.error('[server] Failed to start:', err && (err as Error).message ? (err as Error).message : err);
    process.exit(1);
  });
}

export default app;
