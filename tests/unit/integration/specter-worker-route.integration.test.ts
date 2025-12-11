// tests/unit/integration/specter-worker-route.integration.test.ts
/**
 * Lightweight integration test:
 * - Uses the running Express app (createApp / server export)
 * - Invokes the Specter ingestion worker processor with a real message
 * - Calls the protected metrics endpoint to assert the worker wrote state (events + session)
 *
 * This keeps the test fast and deterministic by directly calling the worker's message
 * processor rather than wiring RabbitMQ.
 */

import request from 'supertest';

const APP_PATH = 'api-src/server';
const WORKER_PATH = 'api-src/workers/specter-ingestion.worker';

describe('Specter worker ↔ route integration (lightweight)', () => {
  let app: any;
  let token: string;
  let worker: any;

  beforeAll(async () => {
    // load app
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    app = require(APP_PATH).default;

    // Acquire dev token (seed creates a user with id 1)
    const devRes = await request(app).get('/api/v1/auth/dev-token');
    token = devRes.body?.token;
    if (!token) throw new Error('Failed to obtain dev token');

    // load worker module
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    worker = require(WORKER_PATH);
    // ensure worker started (idempotent)
    if (typeof worker.startSpecterIngestionWorker === 'function') {
      await worker.startSpecterIngestionWorker();
    }
  });

  afterAll(async () => {
    // stop worker if available
    try {
      if (worker && typeof worker.stopSpecterIngestionWorker === 'function') {
        await worker.stopSpecterIngestionWorker();
      }
    } catch (_) {
      // ignore
    }
  });

  test('worker processes message -> metrics endpoint reflects event + session', async () => {
    const shopId = 42;
    const ts = Date.now();

    // build message payload that the worker understands (Buffer content)
    const msgPayload = {
      shopId,
      type: 'sync.complete',
      payload: { ok: true },
      sessionDelta: {
        sessionId: 's-int-1',
        createdAt: new Date().toISOString(),
        exitIntent: false,
        pagesViewed: ['/', '/product/1']
      },
      timestamp: ts
    };

    // call the worker's processor directly (simulates a message from the queue)
    expect(typeof worker.processSpecterMessage).toBe('function');
    await worker.processSpecterMessage({ content: Buffer.from(JSON.stringify(msgPayload)) });

    // allow microtasks / fire-and-forget tasks to complete
    await new Promise((r) => setImmediate(r));

    // hit the protected metrics endpoint using the dev token
    const res = await request(app)
      .get(`/api/v1/specter/${shopId}/state`)
      .set('Authorization', `Bearer ${token}`)
      .expect('Content-Type', /json/)
      .expect(200);

    // basic assertions
    expect(res.body).toHaveProperty('shopId', shopId);
    expect(res.body).toHaveProperty('events');
    expect(Array.isArray(res.body.events)).toBe(true);
    // newest-first: first event should be our sync.complete
    expect(res.body.events.length).toBeGreaterThanOrEqual(1);
    expect(res.body.events[0]).toHaveProperty('type', 'sync.complete');
    // session should be present and match sessionId
    expect(res.body.session).toBeTruthy();
    expect(res.body.session).toHaveProperty('sessionId', 's-int-1');
    // meta should include lastSync matching our timestamp (number or string convertible)
    expect(res.body.meta).toHaveProperty('lastSync');
    const lastSync = res.body.meta.lastSync;
    expect(Number(lastSync)).toBeGreaterThanOrEqual(ts);
  });
});
