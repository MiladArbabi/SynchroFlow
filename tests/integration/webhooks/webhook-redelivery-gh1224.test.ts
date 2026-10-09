// tests/integration/webhooks/webhook-redelivery-gh1224.test.ts
//
// GH-1224 / TIER-09 — failed webhook redelivery must be retryable.
//
// Real disposable PostgreSQL, real WebhookRouter, real WebhookLedgerService,
// real integration_webhook_events (forced RLS). Only the route handler is a
// bounded test handler registered through WebhookRouter.register().
//
// Ratified contract:
//   no row          → claim received → execute
//   existing failed → atomically reclaim failed → received → execute
//   received / processed / ignored → do NOT execute
//   success → processed (HTTP 200); failure → failed + processing_error
//   (HTTP 500), still retryable by a later provider redelivery.
//   Requests already concurrent against ONE failed event: exactly one may
//   invoke the handler during that wave, even when that owner FAILS. Only a
//   delivery arriving after the wave settled may retry again.

import crypto from 'crypto';
import request from 'supertest';
import type { Knex } from 'knex';

import db, {
  setTenantContext,
  systemQuery,
  systemTransaction,
  withTenant,
} from '@lasyncro/backend-core/db.js';
import { createTenantShop } from '@lasyncro/backend-core/services/pre-tenant.service.js';
import { createApp } from 'api-src/bootstrap/express';
import { WebhookRouter } from 'api-src/api/webhooks/webhookRouter';
import type { WebhookEnvelope } from 'api-src/api/webhooks/types';

jest.setTimeout(120000);

const TEST_INTEGRATION = 'gh1224-test';
const TEST_EVENT_TYPE = 'gh1224/probe';

type TestHandler = (envelope: WebhookEnvelope, trx: Knex.Transaction) => Promise<void>;

// Single registered route; each test swaps the bounded behaviour behind it.
let currentHandler: TestHandler = async () => {
  throw new Error('GH1224_NO_TEST_HANDLER_INSTALLED');
};
let handlerCalls = 0;

function installHandler(fn: TestHandler) {
  handlerCalls = 0;
  currentHandler = fn;
}

function deferred<T = void>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: NodeJS.Timeout;
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`GH1224_TIMEOUT: ${label} (${ms}ms)`)), ms);
    }),
  ]).finally(() => clearTimeout(timer));
}

async function createShop(label: string): Promise<{ shopId: number; unique: string }> {
  const unique = crypto.randomBytes(6).toString('hex');
  const shopId = await systemTransaction(async (trx) => {
    const id = await createTenantShop(trx, `gh1224-${label}-${unique}`);
    await setTenantContext(trx, id);
    return id;
  });
  return { shopId, unique };
}

function envelopeFor(shopId: number, eventId: string): WebhookEnvelope {
  // Fresh object per delivery: dispatch() mutates the envelope it receives.
  return {
    integration: TEST_INTEGRATION,
    eventId,
    eventType: TEST_EVENT_TYPE,
    verified: true,
    receivedAt: new Date(),
    shopId,
    rawPayload: { gh1224: true, eventId },
  };
}

async function ledgerRows(shopId: number, integration: string, eventId: string) {
  return withTenant(shopId, (trx) =>
    trx('integration_webhook_events')
      .where({ integration, external_event_id: eventId })
      .select('id', 'shop_id', 'processing_status', 'processing_error'),
  );
}

async function seedLedgerRow(
  shopId: number,
  eventId: string,
  status: 'received' | 'ignored' | 'failed',
  processingError: string | null,
) {
  await withTenant(shopId, (trx) =>
    trx('integration_webhook_events').insert({
      shop_id: shopId,
      integration: TEST_INTEGRATION,
      external_event_id: eventId,
      event_type: TEST_EVENT_TYPE,
      payload: { gh1224: true, eventId, seeded: status },
      idempotency_key: `${TEST_INTEGRATION}:${eventId}`,
      processing_status: status,
      verified: true,
      processing_error: processingError,
    }),
  );
}

async function settle(promise: Promise<unknown>) {
  try {
    await promise;
    return { ok: true as const };
  } catch (err: any) {
    return { ok: false as const, message: String(err?.message ?? err) };
  }
}

beforeAll(() => {
  WebhookRouter.register({
    integration: TEST_INTEGRATION,
    eventType: TEST_EVENT_TYPE,
    handle: async (envelope, trx) => {
      handlerCalls += 1;
      await currentHandler(envelope, trx);
    },
  });
});

describe('GH-1224 — direct WebhookRouter ledger admission', () => {
  it('R1 FIRST SUCCESS: a first-seen event runs the handler once and is processed', async () => {
    const { shopId, unique } = await createShop('r1');
    const eventId = `gh1224-r1-${unique}`;
    installHandler(async () => {});

    await WebhookRouter.dispatch(envelopeFor(shopId, eventId));

    expect(handlerCalls).toBe(1);
    const rows = await ledgerRows(shopId, TEST_INTEGRATION, eventId);
    expect(rows).toHaveLength(1);
    expect(rows[0].shop_id).toBe(shopId);
    expect(rows[0].processing_status).toBe('processed');
    expect(rows[0].processing_error).toBeNull();
  });

  it('R2 PROCESSED REPLAY IS TERMINAL: replaying a processed event does not rerun the handler', async () => {
    const { shopId, unique } = await createShop('r2');
    const eventId = `gh1224-r2-${unique}`;
    installHandler(async () => {});

    await WebhookRouter.dispatch(envelopeFor(shopId, eventId));
    expect(handlerCalls).toBe(1);

    await expect(WebhookRouter.dispatch(envelopeFor(shopId, eventId))).resolves.toBeUndefined();

    expect(handlerCalls).toBe(1);
    const rows = await ledgerRows(shopId, TEST_INTEGRATION, eventId);
    expect(rows).toHaveLength(1);
    expect(rows[0].processing_status).toBe('processed');
  });

  it('R3 IGNORED REPLAY IS TERMINAL: an ignored ledger row does not run the handler', async () => {
    const { shopId, unique } = await createShop('r3');
    const eventId = `gh1224-r3-${unique}`;
    await seedLedgerRow(shopId, eventId, 'ignored', 'unsupported_event');
    installHandler(async () => {});

    await settle(WebhookRouter.dispatch(envelopeFor(shopId, eventId)));

    expect(handlerCalls).toBe(0);
    const rows = await ledgerRows(shopId, TEST_INTEGRATION, eventId);
    expect(rows).toHaveLength(1);
    expect(rows[0].processing_status).toBe('ignored');
  });

  it('R4 RECEIVED REPLAY DOES NOT CREATE SECOND OWNER: an in-flight received row does not run the handler', async () => {
    const { shopId, unique } = await createShop('r4');
    const eventId = `gh1224-r4-${unique}`;
    await seedLedgerRow(shopId, eventId, 'received', null);
    installHandler(async () => {});

    await settle(WebhookRouter.dispatch(envelopeFor(shopId, eventId)));

    expect(handlerCalls).toBe(0);
    const rows = await ledgerRows(shopId, TEST_INTEGRATION, eventId);
    expect(rows).toHaveLength(1);
    expect(rows[0].processing_status).toBe('received');
  });

  it('R5 FIRST HANDLER FAILURE PERSISTS RETRYABLE EVIDENCE: failed + error persisted, handler effects rolled back', async () => {
    const { shopId, unique } = await createShop('r5');
    const eventId = `gh1224-r5-${unique}`;
    const sideEffectEventId = `${eventId}-handler-side-effect`;

    installHandler(async (envelope, trx) => {
      // Transaction-local handler effect that the SAVEPOINT must roll back.
      await trx('integration_webhook_events').insert({
        shop_id: envelope.shopId,
        integration: TEST_INTEGRATION,
        external_event_id: sideEffectEventId,
        event_type: TEST_EVENT_TYPE,
        payload: { gh1224: 'handler-side-effect' },
        idempotency_key: `${TEST_INTEGRATION}:${sideEffectEventId}`,
        processing_status: 'processed',
        verified: true,
      });
      throw new Error('GH1224_TRANSIENT_FAILURE');
    });

    await expect(WebhookRouter.dispatch(envelopeFor(shopId, eventId))).rejects.toThrow(
      'GH1224_TRANSIENT_FAILURE',
    );

    expect(handlerCalls).toBe(1);
    const rows = await ledgerRows(shopId, TEST_INTEGRATION, eventId);
    expect(rows).toHaveLength(1);
    expect(rows[0].processing_status).toBe('failed');
    expect(rows[0].processing_error).toContain('GH1224_TRANSIENT_FAILURE');

    const sideEffectRows = await ledgerRows(shopId, TEST_INTEGRATION, sideEffectEventId);
    expect(sideEffectRows).toHaveLength(0);
  });

  it('R6 FAILED EVENT REDELIVERY MUST RERUN: same event after a failure is reclaimed and processed', async () => {
    const { shopId, unique } = await createShop('r6');
    const eventId = `gh1224-r6-${unique}`;

    let failNext = true;
    installHandler(async () => {
      if (failNext) {
        failNext = false;
        throw new Error('GH1224_TRANSIENT_FAILURE');
      }
    });

    await expect(WebhookRouter.dispatch(envelopeFor(shopId, eventId))).rejects.toThrow(
      'GH1224_TRANSIENT_FAILURE',
    );
    expect(handlerCalls).toBe(1);
    expect((await ledgerRows(shopId, TEST_INTEGRATION, eventId))[0].processing_status).toBe('failed');

    await expect(WebhookRouter.dispatch(envelopeFor(shopId, eventId))).resolves.toBeUndefined();

    expect(handlerCalls).toBe(2);
    const rows = await ledgerRows(shopId, TEST_INTEGRATION, eventId);
    expect(rows).toHaveLength(1);
    expect(rows[0].processing_status).toBe('processed');
    expect(rows[0].processing_error).toBeNull();
  });

  it('R7 REPEATED FAILURE REMAINS RETRYABLE: fail, fail, succeed on the same event', async () => {
    const { shopId, unique } = await createShop('r7');
    const eventId = `gh1224-r7-${unique}`;

    const outcomes = ['GH1224_TRANSIENT_FAILURE_ATTEMPT_1', 'GH1224_TRANSIENT_FAILURE_ATTEMPT_2', null];
    installHandler(async () => {
      const outcome = outcomes[handlerCalls - 1];
      if (outcome) throw new Error(outcome);
    });

    // Attempt 1 — fails.
    await expect(WebhookRouter.dispatch(envelopeFor(shopId, eventId))).rejects.toThrow(
      'GH1224_TRANSIENT_FAILURE_ATTEMPT_1',
    );
    expect(handlerCalls).toBe(1);
    expect((await ledgerRows(shopId, TEST_INTEGRATION, eventId))[0].processing_status).toBe('failed');

    // Attempt 2 — handler must run again and fail again.
    const attempt2 = await settle(WebhookRouter.dispatch(envelopeFor(shopId, eventId)));
    expect(handlerCalls).toBe(2);
    expect(attempt2).toEqual({ ok: false, message: 'GH1224_TRANSIENT_FAILURE_ATTEMPT_2' });
    let rows = await ledgerRows(shopId, TEST_INTEGRATION, eventId);
    expect(rows).toHaveLength(1);
    expect(rows[0].processing_status).toBe('failed');
    expect(rows[0].processing_error).toContain('GH1224_TRANSIENT_FAILURE_ATTEMPT_2');

    // Attempt 3 — handler succeeds.
    await expect(WebhookRouter.dispatch(envelopeFor(shopId, eventId))).resolves.toBeUndefined();
    expect(handlerCalls).toBe(3);
    rows = await ledgerRows(shopId, TEST_INTEGRATION, eventId);
    expect(rows).toHaveLength(1);
    expect(rows[0].processing_status).toBe('processed');
  });

  it('R8 CONCURRENT FAILED REDELIVERY HAS ONE OWNER: a waiter must not reclaim after the owner fails; a later delivery may', async () => {
    const { shopId, unique } = await createShop('r8');
    const eventId = `gh1224-r8-${unique}`;
    await seedLedgerRow(shopId, eventId, 'failed', 'GH1224_SEEDED_PRIOR_FAILURE');

    const ownerEntered = deferred<number>();
    const releaseOwner = deferred<void>();
    let phase: 'wave' | 'later' = 'wave';

    installHandler(async (_envelope, trx) => {
      if (phase === 'later') return; // redelivery C succeeds
      if (handlerCalls === 1) {
        // Owner A: report its backend pid, block until released, then FAIL.
        const pidResult = await trx.raw('SELECT pg_backend_pid() AS pid');
        ownerEntered.resolve(Number(pidResult.rows[0].pid));
        await releaseOwner.promise;
        throw new Error('GH1224_CONCURRENT_OWNER_FAILURE');
      }
      // Any second invocation inside the concurrent wave is a second owner.
      // It succeeds so that the violation is visible as a processed ledger.
    });

    let aPromise: Promise<void> | null = null;
    let bPromise: Promise<void> | null = null;
    try {
      // 1–3. Start A; it must claim the retry and enter (and block in) the handler.
      aPromise = WebhookRouter.dispatch(envelopeFor(shopId, eventId));
      const aSettledEarly = settle(aPromise).then((outcome) => ({ kind: 'A_SETTLED' as const, outcome }));
      const first = await withTimeout(
        Promise.race([
          ownerEntered.promise.then((pid) => ({ kind: 'ENTERED' as const, pid })),
          aSettledEarly,
        ]),
        10000,
        'redelivery A did not enter the handler',
      );
      if (first.kind !== 'ENTERED') {
        throw new Error(
          `GH1224_R8_A_DID_NOT_CLAIM_FAILED_EVENT: redelivery A settled without invoking the handler ` +
            `(handlerCalls=${handlerCalls}, outcome=${JSON.stringify(first.outcome)})`,
        );
      }
      const ownerPid = first.pid;
      expect(handlerCalls).toBe(1);

      // 4–5. Start B while A is still in flight and prove B is a concurrent
      // dispatch: it is either blocked by A's session or has already settled
      // without running the handler — both observed BEFORE A is released.
      bPromise = WebhookRouter.dispatch(envelopeFor(shopId, eventId));
      let bSettled = false;
      const bTracked = settle(bPromise).then((outcome) => {
        bSettled = true;
        return outcome;
      });

      const overlapDeadline = Date.now() + 10000;
      let bOverlap: 'BLOCKED_BY_OWNER' | 'SETTLED_WHILE_OWNER_IN_FLIGHT' | null = null;
      while (!bOverlap) {
        if (bSettled) {
          bOverlap = 'SETTLED_WHILE_OWNER_IN_FLIGHT';
          break;
        }
        const blocked = await systemQuery(
          db.raw(
            `SELECT a.pid FROM pg_stat_activity a
              WHERE a.pid <> ? AND ? = ANY(pg_blocking_pids(a.pid))
              LIMIT 1`,
            [ownerPid, ownerPid],
          ),
        );
        if (blocked.rows.length > 0) {
          bOverlap = 'BLOCKED_BY_OWNER';
          break;
        }
        if (Date.now() > overlapDeadline) {
          throw new Error('GH1224_TIMEOUT: redelivery B neither blocked on owner A nor settled (10000ms)');
        }
        await new Promise((r) => setTimeout(r, 25));
      }
      // While A is still in flight, B must not have run the handler.
      expect(handlerCalls).toBe(1);

      // 6–7. Release A so that it FAILS, then await both.
      releaseOwner.resolve();
      const [aOutcome] = await withTimeout(
        Promise.all([settle(aPromise), bTracked]),
        20000,
        'concurrent redeliveries A/B did not settle after owner release',
      );

      expect(aOutcome).toEqual({ ok: false, message: 'GH1224_CONCURRENT_OWNER_FAILURE' });
      // Exactly one owner across the A+B wave, even though A failed.
      expect(handlerCalls).toBe(1);
      let rows = await ledgerRows(shopId, TEST_INTEGRATION, eventId);
      expect(rows).toHaveLength(1);
      expect(rows[0].processing_status).toBe('failed');
      expect(rows[0].processing_error).toContain('GH1224_CONCURRENT_OWNER_FAILURE');

      // Later redelivery C, after the wave settled, may reclaim and succeed.
      phase = 'later';
      await expect(WebhookRouter.dispatch(envelopeFor(shopId, eventId))).resolves.toBeUndefined();
      expect(handlerCalls).toBe(2);
      rows = await ledgerRows(shopId, TEST_INTEGRATION, eventId);
      expect(rows).toHaveLength(1);
      expect(rows[0].processing_status).toBe('processed');
      expect(bOverlap).not.toBeNull();
    } finally {
      // Never leave a parked transaction behind on failure paths.
      releaseOwner.resolve();
      await Promise.allSettled([aPromise, bPromise].filter(Boolean) as Promise<void>[]);
    }
  });
});

describe('GH-1224 — real Shopify HTTP redelivery (POST /api/v1/shopify/webhooks)', () => {
  const app = createApp();
  const savedSecrets: Record<string, string | undefined> = {};
  const WEBHOOK_SECRET = 'gh1224-test-webhook-secret';
  const API_SECRET = 'gh1224-test-api-secret';

  beforeAll(() => {
    savedSecrets.SHOPIFY_WEBHOOK_SECRET = process.env.SHOPIFY_WEBHOOK_SECRET;
    savedSecrets.SHOPIFY_API_SECRET = process.env.SHOPIFY_API_SECRET;
    process.env.SHOPIFY_WEBHOOK_SECRET = WEBHOOK_SECRET;
    process.env.SHOPIFY_API_SECRET = API_SECRET;
  });

  afterAll(() => {
    for (const [key, value] of Object.entries(savedSecrets)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  it('R9 HTTP 500 → same-id retry → 200 reruns the handler once, then stays terminal', async () => {
    const { shopId, unique } = await createShop('r9');
    const shopDomain = `gh1224-r9-${unique}.myshopify.com`;
    await withTenant(shopId, (trx) =>
      trx('shopify_app_installations').insert({
        shop_id: shopId,
        shop_domain: shopDomain,
        scopes: 'read_products',
      }),
    );

    // Overwrite the production (shopify, products/update) registration that
    // createApp() loaded with the bounded test handler.
    let calls = 0;
    WebhookRouter.register({
      integration: 'shopify',
      eventType: 'products/update',
      handle: async () => {
        calls += 1;
        if (calls === 1) throw new Error('GH1224_SHOPIFY_TRANSIENT_FAILURE');
        // calls === 2 succeeds; calls === 3 would be an unsafe extra execution.
      },
    });

    const webhookId = `gh1224-http-${unique}`;
    const rawBody = JSON.stringify({
      id: 1224000 + crypto.randomInt(1, 999),
      title: 'GH-1224 redelivery probe',
      updated_at: '2026-10-07T00:00:00Z',
    });
    const hmac = crypto.createHmac('sha256', API_SECRET).update(Buffer.from(rawBody, 'utf8')).digest('base64');

    const deliver = () =>
      request(app)
        .post('/api/v1/shopify/webhooks')
        .set('Content-Type', 'application/json')
        .set('X-Shopify-Topic', 'products/update')
        .set('X-Shopify-Shop-Domain', shopDomain)
        .set('X-Shopify-Webhook-Id', webhookId)
        .set('X-Shopify-Hmac-Sha256', hmac)
        .send(rawBody);

    // Request 1 — handler fails → 500, ledger failed.
    const res1 = await deliver();
    expect(res1.status).toBe(500);
    expect(calls).toBe(1);
    let rows = await ledgerRows(shopId, 'shopify', webhookId);
    expect(rows).toHaveLength(1);
    expect(rows[0].shop_id).toBe(shopId);
    expect(rows[0].processing_status).toBe('failed');

    // Request 2 — same id, same signed body: must actually recover.
    const res2 = await deliver();
    const afterRequest2 = { status: res2.status, calls, rows: await ledgerRows(shopId, 'shopify', webhookId) };
    expect(afterRequest2.status).toBe(200);
    expect(afterRequest2.calls).toBe(2);
    expect(afterRequest2.rows).toHaveLength(1);
    expect(afterRequest2.rows[0].processing_status).toBe('processed');

    // Request 3 — processed is terminal.
    const res3 = await deliver();
    expect(res3.status).toBe(200);
    expect(calls).toBe(2);
    rows = await ledgerRows(shopId, 'shopify', webhookId);
    expect(rows).toHaveLength(1);
    expect(rows[0].processing_status).toBe('processed');
  });
});
