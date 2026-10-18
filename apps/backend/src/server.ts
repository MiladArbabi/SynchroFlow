// apps/backend/src/server.ts
import dotenv from 'dotenv';
dotenv.config();
import { createApp } from './bootstrap/express.js';
import { initQueue, closeQueue } from './bootstrap/queue.js';
import { declareTopology } from './queue.topology.js';
import { startWorkers, stopWorkers } from './bootstrap/workers.js';
import { createProcessShutdown } from './bootstrap/processShutdown.js';
import { fileURLToPath } from 'url';
import path from 'path';
import { runSchemaGuard } from './utils/schemaGuard.js';
import { initRedisClient, closeRedisClient } from '@lasyncro/backend-core/services/redis.client.js';
import { flushAnalytics } from './utils/analytics.js';
import { assertRuntimeDatabaseIdentity } from '@lasyncro/backend-core/db.js';
import { closeShopifyReconnectExecutor } from './services/shopify/shopifyReconnectExecutor.db.js';

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
  // schema verification FIRST
  await runSchemaGuard();
  // infrastructure SECOND
  await initQueue();
  await declareTopology();

  // RUNTIME-BOOT-01:
  // Bind the HTTP server after critical infrastructure readiness, but before
  // optional background-worker initialization. A slow or failed worker must
  // not prevent Fly health checks from reaching the API.
  // RUNTIME-BOOT-02: bootstrap/workers.ts starts ten workers with `void`, so a
  // rejection in any polling loop is unowned and Node 20 terminates the process.
  // That killed v270 four seconds after the listener bound, past the reach of
  // startWorkers().catch. Contain and log loudly — never exit on a worker fault.
  process.on('unhandledRejection', (reason) => {
    console.error('[UNHANDLED_REJECTION] contained, process kept alive:', reason);
  });

  server = app.listen(port, HOST, () => {
    console.log(`Server is listening on http://${HOST}:${port}`);

    void startWorkers().catch((err) => {
      console.error(
        '[server] Background worker startup failed after HTTP listener became ready:',
        err
      );
    });
  });
}

function closeHttpServer(): Promise<void> {
  if (!server) {
    return Promise.resolve();
  }

  return new Promise<void>((resolve, reject) => {
    try {
      server?.close((error?: Error) => {
        if (error) {
          reject(error);
          return;
        }

        console.log('[server] HTTP server closed');
        resolve();
      });
    } catch (error) {
      reject(error);
    }
  });
}

const shutdown = createProcessShutdown({
  processName: 'server',
  startDrain: () => [
    closeHttpServer(),
    stopWorkers(),
  ],
  cleanup: [
    {
      name: 'shopify-reconnect-executor',
      run: () => closeShopifyReconnectExecutor(),
    },
    {
      name: 'analytics',
      run: () => flushAnalytics(),
    },
    {
      name: 'queue',
      run: () => closeQueue(),
    },
    {
      name: 'redis',
      run: () => closeRedisClient(),
    },
  ],
});

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

if (isMain) {
  start().catch((err) => {
    console.error('[server] Failed to start:', err && (err as Error).message ? (err as Error).message : err);
    process.exit(1);
  });
}

export default app;
