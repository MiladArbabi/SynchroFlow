// apps/backend/src/server.ts
import dotenv from 'dotenv';
dotenv.config();
import { createApp } from './bootstrap/express';
import { initSpecterStore, closeSpecterStore } from './bootstrap/specter-store';
import { initQueue, closeQueue } from './bootstrap/queue';
import { startWorkers } from './bootstrap/workers';

const port = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || '127.0.0.1';

const app = createApp();

// Start sequence and graceful shutdown wiring
let server: ReturnType<typeof app.listen> | null = null;

async function start() {
  // ensure optional infra initialized before declaring ready
  await initSpecterStore();
  await initQueue();
  await startWorkers();

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