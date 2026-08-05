// apps/backend/src/server.ts
import dotenv from 'dotenv';
dotenv.config();
import { createApp } from './bootstrap/express.js';
import { initSpecterStore, closeSpecterStore } from './bootstrap/specter-store.js';
import { initQueue, closeQueue } from './bootstrap/queue.js';
import { declareTopology } from './queue.topology.js';
import { startWorkers } from './bootstrap/workers.js';
import { fileURLToPath } from 'url';
import path from 'path';
import { runSchemaGuard } from './utils/schemaGuard.js';
import { initRedisClient, closeRedisClient } from '@lasyncro/backend-core/services/redis.client.js';
import { flushAnalytics } from './utils/analytics.js';
import { assertRuntimeDatabaseIdentity } from '@lasyncro/backend-core/db.js';

const port = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || '127.0.0.1';

const app = createApp();

// Start sequence and graceful shutdown wiring
let server: ReturnType<typeof app.listen> | null = null;

const __filename = fileURLToPath(import.meta.url);
const isMain = process.argv[1] && path.resolve(process.argv[1]) === __filename;

async function start() {
  // SEC-RLS-P0: fail before any infrastructure or worker starts if the HTTP
  // runtime is connected with the privileged migration identity.
  await assertRuntimeDatabaseIdentity();
  await initRedisClient();
  await initSpecterStore();
  // schema verification FIRST
  await runSchemaGuard();
  // infrastructure SECOND
  await initQueue();
  await declareTopology();
  await startWorkers();
  server = app.listen(port, HOST, () => {
    console.log(`Server is listening on http://${HOST}:${port}`);
  });
}

async function shutdown(sig?: string) {
  console.log('[server] shutdown triggered', sig || '');
  try { await flushAnalytics(); } catch (e) { /* non-fatal — flush remaining PostHog events */ }
  try { await closeRedisClient(); } catch (e) { /* ignore */ }
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
