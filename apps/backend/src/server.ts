// apps/backend/src/server.ts
import dotenv from 'dotenv';
dotenv.config();
import { createApp } from './bootstrap/express.js';
import { initSpecterStore, closeSpecterStore } from './bootstrap/specter-store.js';
import { initQueue, closeQueue } from './bootstrap/queue.js';
import { startWorkers } from './bootstrap/workers.js';
import { fileURLToPath } from 'url';
import path from 'path';
import { runSchemaGuard } from './utils/schemaGuard.js';

const port = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || '127.0.0.1';

const app = createApp();

// Start sequence and graceful shutdown wiring
let server: ReturnType<typeof app.listen> | null = null;

const __filename = fileURLToPath(import.meta.url);
const isMain = process.argv[1] && path.resolve(process.argv[1]) === __filename;

async function start() {
  await initSpecterStore();

  // schema verification FIRST
  await runSchemaGuard();

  // infrastructure SECOND
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

if (isMain) {
  start().catch((err) => {
    console.error('[server] Failed to start:', err && (err as Error).message ? (err as Error).message : err);
    process.exit(1);
  });
}

export default app;