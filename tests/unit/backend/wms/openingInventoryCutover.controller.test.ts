// tests/unit/backend/wms/openingInventoryCutover.controller.test.ts
//
// 4b-2b GRILL-03 — merchant cutover HTTP boundary.
//
// DB-free controller layer: the cutover services are mocked at their module
// boundaries so these tests prove only what the controller owns —
// authenticated identity authority, body validation, stable error mapping
// and read passthrough. GH-1179 E06: approval is Slice-D generation
// (readiness, acceptance, membership, absolute CAS requests) followed by the
// Slice-E orchestrator; both are integration-tested in tests/integration/
// inventory/opening-inventory-cutover-{regeneration,orchestration,
// modern-route}.service.test.ts. The legacy delta cutover is never called.
//
// Middleware registration order (GRILL-03G) is a source contract in
// tests/contract/opening-inventory-cutover-routes.contract.test.ts.

import request from 'supertest';
import express from 'express';

// DB-free: the real service module is loaded only for its pure classifier,
// so the backend-core DB client (which validates PG env at import) is stubbed.
jest.mock('@lasyncro/backend-core/db.js', () => ({
  __esModule: true,
  default: {},
  withTenant: jest.fn(),
  setTenantContext: jest.fn(),
  systemQuery: jest.fn(),
  systemTransaction: jest.fn(),
}));

// The pure public-error classifier is the REAL implementation (shared by
// POST and the GET read model); only the DB-touching service calls are mocked.
jest.mock('api-src/services/wms/openingInventoryCutover.service', () => {
  const actual = jest.requireActual('api-src/services/wms/openingInventoryCutover.service');
  return {
    classifyOpeningInventoryCutoverError: actual.classifyOpeningInventoryCutoverError,
    approveAndRunOpeningInventoryCutover: jest.fn(),
    getOpeningInventoryCutoverView: jest.fn(),
  };
});

// GH-1156 / GH-1179: the canonical shop-wide start orchestrator is mocked at
// its module boundary. It owns its own transactions (reserve → Shopify
// snapshot → atomic finalize); reservation, provider reads, snapshot lines,
// leases and cohort creation are integration-tested in
// tests/integration/inventory/opening-inventory-shopify-snapshot.service.test.ts
// and opening-recount-bootstrap-progress.test.ts.
jest.mock('api-src/services/wms/shopifyOpeningInventorySnapshot.service', () => ({
  startShopOpeningInventory: jest.fn(),
}));

// GH-1179 E06: the approval chain — Slice-D generation, then the Slice-E
// orchestrator — mocked at its module boundaries.
jest.mock('api-src/services/wms/openingInventoryCutoverGeneration.service', () => ({
  createOpeningInventoryCutoverGeneration: jest.fn(),
}));

jest.mock('api-src/services/wms/openingInventoryCutoverExecution.service', () => ({
  advanceOpeningInventoryCutoverExecution: jest.fn(),
}));

import { withTenant } from '@lasyncro/backend-core/db.js';
import { startShopOpeningInventory } from 'api-src/services/wms/shopifyOpeningInventorySnapshot.service';
import { createOpeningInventoryCutoverGeneration } from 'api-src/services/wms/openingInventoryCutoverGeneration.service';
import { advanceOpeningInventoryCutoverExecution } from 'api-src/services/wms/openingInventoryCutoverExecution.service';
import {
  approveAndRunOpeningInventoryCutover,
  classifyOpeningInventoryCutoverError,
  getOpeningInventoryCutoverView,
} from 'api-src/services/wms/openingInventoryCutover.service';
import {
  httpApproveOpeningInventoryCutover,
  httpGetOpeningInventoryProgress,
  httpStartOpeningInventoryReconciliation,
} from 'api-src/api/wms/openingInventoryCutover.controller';

const generationMock = createOpeningInventoryCutoverGeneration as jest.Mock;
const advanceMock = advanceOpeningInventoryCutoverExecution as jest.Mock;
const legacyApproveMock = approveAndRunOpeningInventoryCutover as jest.Mock;
const viewMock = getOpeningInventoryCutoverView as jest.Mock;
const startMock = startShopOpeningInventory as jest.Mock;
const withTenantMock = withTenant as jest.Mock;

const AUTH_USER = { shopId: 41, userId: 7 };

function buildApp(user: Record<string, unknown> | null = AUTH_USER) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    if (user) (req as any).user = user;
    next();
  });
  app.get('/opening-inventory/progress', httpGetOpeningInventoryProgress);
  app.post('/opening-inventory/cutover', httpApproveOpeningInventoryCutover);
  app.post('/opening-inventory/start', httpStartOpeningInventoryReconciliation);
  return app;
}

const GENERATION = { generation_id: '11111111-1111-4111-8111-111111111111' };

// POST success returns the composed cutover view (existing GET shape).
const SNAPSHOT = {
  status: 'complete',
  physical_truth_accepted: true,
  error_code: null,
  error_message: null,
  completed_at: '2026-09-23T10:00:05.000Z',
};

function approvalSucceeds() {
  generationMock.mockResolvedValue(GENERATION);
  advanceMock.mockResolvedValue({ outcome: 'converged', state: 'converged' });
  viewMock.mockResolvedValue({ progress: {}, cutover: SNAPSHOT, shopify_synced_at: null });
}

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(() => {
  (console.error as jest.Mock).mockRestore?.();
});

describe('GRILL-03A — authenticated identity authority', () => {
  it('POST uses req.user shopId/userId only, ignoring forged body identity and economics', async () => {
    approvalSucceeds();

    const res = await request(buildApp())
      .post('/opening-inventory/cutover')
      .send({
        accept_physical_truth: true,
        shopId: 999,
        shop_id: 999,
        userId: 555,
        user_id: 555,
        actingUserId: 555,
        role: 'owner',
        delta: 100,
        location_id: 'gid://shopify/Location/1',
        variants: [{ id: 'v', delta: 5 }],
      })
      .expect(200);

    expect(generationMock).toHaveBeenCalledTimes(1);
    expect(generationMock).toHaveBeenCalledWith({
      shopId: 41,
      actingUserId: 7,
      acceptPhysicalTruth: true,
    });
    // Advances exactly the generation that approval created / replayed.
    expect(advanceMock).toHaveBeenCalledTimes(1);
    expect(advanceMock).toHaveBeenCalledWith({
      shopId: 41,
      generationId: GENERATION.generation_id,
    });
    expect(viewMock).toHaveBeenCalledWith(41);
    expect(legacyApproveMock).not.toHaveBeenCalled();
    expect(res.body).toEqual(SNAPSHOT);
  });

  it('GET uses req.user shopId only, ignoring forged query identity', async () => {
    viewMock.mockResolvedValue({ progress: {}, cutover: null, shopify_synced_at: null });

    await request(buildApp())
      .get('/opening-inventory/progress')
      .query({ shopId: 999, shop_id: 999 })
      .expect(200);

    expect(viewMock).toHaveBeenCalledTimes(1);
    expect(viewMock).toHaveBeenCalledWith(41);
  });

  it('absent acceptance is passed as false, never undefined/truthy', async () => {
    approvalSucceeds();

    await request(buildApp())
      .post('/opening-inventory/cutover')
      .send({})
      .expect(200);

    expect(generationMock).toHaveBeenCalledWith({
      shopId: 41,
      actingUserId: 7,
      acceptPhysicalTruth: false,
    });
  });

  it.each([
    ['GET', null],
    ['POST', null],
    ['GET', { shopId: 41 }],
    ['POST', { userId: 7 }],
  ])('%s without complete req.user identity => 401 and no service call', async (verb, user) => {
    const app = buildApp(user as Record<string, unknown> | null);
    const res = verb === 'GET'
      ? await request(app).get('/opening-inventory/progress')
      : await request(app).post('/opening-inventory/cutover').send({ accept_physical_truth: true });

    expect(res.status).toBe(401);
    expect(viewMock).not.toHaveBeenCalled();
    expect(generationMock).not.toHaveBeenCalled();
  });
});

describe('GRILL-03B — accept_physical_truth type validation', () => {
  it.each([['true'], [1], [0], [null], [{}], [['true']]])(
    'accept_physical_truth=%j => 400 and service never called',
    async (value) => {
      const res = await request(buildApp())
        .post('/opening-inventory/cutover')
        .send({ accept_physical_truth: value })
        .expect(400);

      expect(res.body.code).toBe('OPENING_CUTOVER_INVALID_REQUEST');
      expect(generationMock).not.toHaveBeenCalled();
    }
  );
});

describe('GRILL-03C/D/E — stable service error mapping', () => {
  it.each([
    ['[OPENING_CUTOVER_FORBIDDEN] Only owner/admin may approve opening inventory cutover', 403, 'OPENING_CUTOVER_FORBIDDEN'],
    ['[OPENING_CUTOVER_NOT_READY] Opening reconciliation state is counting', 409, 'OPENING_CUTOVER_NOT_READY'],
    ['[OPENING_CUTOVER_ACCEPTANCE_REQUIRED] Merchant must explicitly accept LaSyncro physical count as truth', 409, 'OPENING_CUTOVER_ACCEPTANCE_REQUIRED'],
    ['[OPENING_CUTOVER_PREFLIGHT] Shopify installation missing for shop 41', 409, 'OPENING_CUTOVER_PREFLIGHT'],
    ['[OPENING_CUTOVER_LOCATION] No active warehouse available for Shopify correction', 409, 'OPENING_CUTOVER_LOCATION'],
    ['[OPENING_CUTOVER_IDENTITY] Missing Shopify inventory item for variant v1', 409, 'OPENING_CUTOVER_IDENTITY'],
    ['[OPENING_CUTOVER_SHOPIFY] userErrors: [{"message":"x"}]', 502, 'OPENING_CUTOVER_SHOPIFY'],
    ['[OPENING_CUTOVER_EXECUTE] Batch 1 missing', 502, 'OPENING_CUTOVER_EXECUTE'],
  ])('%s => %i', async (message, status, code) => {
    generationMock.mockRejectedValue(new Error(message));

    const res = await request(buildApp())
      .post('/opening-inventory/cutover')
      .send({ accept_physical_truth: false });

    expect(res.status).toBe(status);
    expect(res.body.code).toBe(code);
    expect(typeof res.body.error).toBe('string');
    expect(res.body.error.length).toBeGreaterThan(0);
  });

  it('GRILL-03C: review_required without acceptance stays service-controlled (controller passes false, maps 409)', async () => {
    generationMock.mockRejectedValue(
      new Error('[OPENING_CUTOVER_ACCEPTANCE_REQUIRED] Merchant must explicitly accept LaSyncro physical count as truth')
    );

    const res = await request(buildApp())
      .post('/opening-inventory/cutover')
      .send({})
      .expect(409);

    expect(generationMock).toHaveBeenCalledWith({
      shopId: 41,
      actingUserId: 7,
      acceptPhysicalTruth: false,
    });
    expect(res.body.code).toBe('OPENING_CUTOVER_ACCEPTANCE_REQUIRED');
  });

  it('unknown/internal errors => 500 without leaking the raw internal message', async () => {
    generationMock.mockRejectedValue(new Error('connect ECONNREFUSED secret-host:5432 token=abc'));

    const res = await request(buildApp())
      .post('/opening-inventory/cutover')
      .send({ accept_physical_truth: true })
      .expect(500);

    expect(res.body.code).toBe('OPENING_CUTOVER_INTERNAL');
    expect(JSON.stringify(res.body)).not.toContain('secret-host');
    expect(JSON.stringify(res.body)).not.toContain('token=abc');
  });

  it('a stable prefix appearing mid-message is not treated as a mapped code', async () => {
    generationMock.mockRejectedValue(new Error('wrapped: [OPENING_CUTOVER_FORBIDDEN] nope'));

    const res = await request(buildApp())
      .post('/opening-inventory/cutover')
      .send({ accept_physical_truth: true });

    expect(res.status).toBe(500);
  });

  it('GET read failure => 500 with stable code', async () => {
    viewMock.mockRejectedValue(new Error('[OPENING_RECOUNT_SHOP_PROGRESS] shop_wms_settings missing for shop 41'));

    const res = await request(buildApp())
      .get('/opening-inventory/progress')
      .expect(500);

    expect(res.body.code).toBe('OPENING_CUTOVER_INTERNAL');
  });
});

describe('GRILL-03F — GET returns canonical progress + cutover status + synced marker', () => {
  it('passes the service view through unchanged', async () => {
    const view = {
      progress: {
        bootstrap_model: 'reconcile_opening_expectation_v2',
        reconciliation_required: true,
        started_at: '2026-09-20T00:00:00.000Z',
        state: 'review_required',
        total_bins: 4,
        complete_bins: 4,
        in_progress_bins: 0,
        needs_review_bins: 0,
        not_started_bins: 0,
        remaining_bins: 0,
        progress_pct: 100,
        all_bins_settled: true,
        difference_count: 1,
        differences: [
          { lasyncro_variant_id: 'v1', expected_quantity: 5, observed_quantity: 3, delta: -2 },
        ],
        bins: [],
      },
      cutover: {
        status: 'failed',
        physical_truth_accepted: true,
        error_code: 'OPENING_CUTOVER_SHOPIFY',
        error_message: 'Shopify did not accept the opening inventory update. Retry to resume the same sync.',
        completed_at: null,
      },
      shopify_synced_at: null,
    };
    viewMock.mockResolvedValue(view);

    const res = await request(buildApp())
      .get('/opening-inventory/progress')
      .expect(200);

    expect(res.body).toEqual(view);
    expect(generationMock).not.toHaveBeenCalled();
  });
});

describe('GRILL-03H/03I — shared public error classifier (POST + GET read model)', () => {
  it('GRILL-03H unprefixed raw error => OPENING_CUTOVER_INTERNAL with generic message, raw text never exposed', () => {
    const result = classifyOpeningInventoryCutoverError('socket ECONNRESET secret-internal-detail');
    expect(result.code).toBe('OPENING_CUTOVER_INTERNAL');
    expect(result.message.length).toBeGreaterThan(0);
    expect(JSON.stringify(result)).not.toContain('secret-internal-detail');
    expect(JSON.stringify(result)).not.toContain('ECONNRESET');
  });

  it('GRILL-03I OPENING_CUTOVER_SHOPIFY => stable code + fixed public message, provider payload and prefix not exposed', () => {
    const result = classifyOpeningInventoryCutoverError(
      new Error('[OPENING_CUTOVER_SHOPIFY] userErrors: [{"message":"secret-provider-detail"}]')
    );
    expect(result.code).toBe('OPENING_CUTOVER_SHOPIFY');
    expect(result.message.length).toBeGreaterThan(0);
    expect(JSON.stringify(result)).not.toContain('secret-provider-detail');
    expect(result.message).not.toContain('[OPENING_CUTOVER_SHOPIFY]');
  });

  it('OPENING_CUTOVER_EXECUTE => fixed public message', () => {
    const result = classifyOpeningInventoryCutoverError('[OPENING_CUTOVER_EXECUTE] Batch 7 missing after Shopify success');
    expect(result.code).toBe('OPENING_CUTOVER_EXECUTE');
    expect(result.message).not.toContain('Batch 7');
  });

  it('descriptive service rejection keeps its merchant-facing text without the prefix', () => {
    const result = classifyOpeningInventoryCutoverError(
      '[OPENING_CUTOVER_LOCATION] Multiple active mapped Shopify warehouse locations require explicit distribution'
    );
    expect(result).toEqual({
      code: 'OPENING_CUTOVER_LOCATION',
      message: 'Multiple active mapped Shopify warehouse locations require explicit distribution',
    });
  });

  it('unknown bracketed prefix => INTERNAL', () => {
    expect(classifyOpeningInventoryCutoverError('[SOMETHING_ELSE] detail').code).toBe('OPENING_CUTOVER_INTERNAL');
  });

  it('POST 502 body carries the fixed Shopify message, never the provider payload', async () => {
    generationMock.mockRejectedValue(
      new Error('[OPENING_CUTOVER_SHOPIFY] userErrors: [{"message":"secret-provider-detail"}]')
    );

    const res = await request(buildApp())
      .post('/opening-inventory/cutover')
      .send({ accept_physical_truth: true })
      .expect(502);

    expect(res.body.code).toBe('OPENING_CUTOVER_SHOPIFY');
    expect(JSON.stringify(res.body)).not.toContain('secret-provider-detail');
  });
});

describe('GH-1156 — opening count start bridge', () => {
  const STARTED_PROGRESS = {
    bootstrap_model: 'reconcile_opening_expectation_v2',
    reconciliation_required: true,
    started_at: '2026-09-24T09:00:00.000Z',
    state: 'counting',
    total_bins: 3,
    not_started_bins: 3,
  };

  it('uses req.user identity plus explicit assigned_to, ignoring forged body scope and economics', async () => {
    startMock.mockResolvedValue(STARTED_PROGRESS);

    const res = await request(buildApp())
      .post('/opening-inventory/start')
      .send({
        shopId: 999,
        shop_id: 999,
        userId: 555,
        createdBy: 555,
        warehouse_id: 'wh-forged',
        warehouseId: 'wh-forged',
        location_codes: ['A-01'],
        bins: ['A-01'],
        cohort: [{ location_code: 'A-01' }],
        assigned_to: 555,
        quantities: { v1: 10 },
        delta: 100,
      })
      .expect(200);

    // The orchestrator owns its transactions; the controller opens none and
    // passes only server-authoritative params (no deps/transport override).
    expect(withTenantMock).not.toHaveBeenCalled();
    expect(startMock).toHaveBeenCalledTimes(1);
    expect(startMock.mock.calls[0]).toEqual([
      {
        shopId: 41,
        createdBy: 7,
        assignedTo: 555,
      },
    ]);
    expect(res.body).toEqual(STARTED_PROGRESS);
    expect(generationMock).not.toHaveBeenCalled();
  });

  it.each([
    ['missing', {}],
    ['null', { assigned_to: null }],
    ['zero', { assigned_to: 0 }],
    ['negative', { assigned_to: -1 }],
    ['fractional', { assigned_to: 1.5 }],
    ['string', { assigned_to: '555' }],
  ])(
    'rejects %s assigned_to before entering the start service',
    async (_label, body) => {
      const res = await request(buildApp())
        .post('/opening-inventory/start')
        .send(body);

      expect(res.status).toBe(400);
      expect(res.body.code).toBe('OPENING_START_INVALID_REQUEST');
      expect(startMock).not.toHaveBeenCalled();
    }
  );

  it.each([[null], [{ shopId: 41 }], [{ userId: 7 }]])(
    'without complete req.user identity (%j) => 401 and no start',
    async (user) => {
      const res = await request(buildApp(user as Record<string, unknown> | null))
        .post('/opening-inventory/start')
        .send({});

      expect(res.status).toBe(401);
      expect(startMock).not.toHaveBeenCalled();
    }
  );

  it.each([
    ['[OPENING_RECOUNT_SHOP_START] Initial inventory reconciliation requires at least one active bin'],
    ['[OPENING_RECOUNT_SHOP_START] bootstrap_model must be reconcile_opening_expectation_v2, got "legacy_opening_balance_v1"'],
    ['[OPENING_RECOUNT_SHOP_START] Snapshot anchor exists but opening tasks are missing'],
  ])('service rejection %s => 409 stable code, raw service text never exposed', async (message) => {
    startMock.mockRejectedValue(new Error(message));

    const res = await request(buildApp())
      .post('/opening-inventory/start')
      .send({ assigned_to: 555 })
      .expect(409);

    expect(res.body.code).toBe('OPENING_START_REJECTED');
    expect(typeof res.body.error).toBe('string');
    expect(res.body.error.length).toBeGreaterThan(0);
    expect(JSON.stringify(res.body)).not.toContain('[OPENING_RECOUNT_SHOP_START]');
    expect(JSON.stringify(res.body)).not.toContain(message.replace('[OPENING_RECOUNT_SHOP_START] ', ''));
  });

  it.each([
    ['OPENING_START_IN_PROGRESS', 409],
    ['OPENING_START_SHOPIFY_FAILED', 502],
  ])('GH-1179 [%s] => %i with a fixed merchant-safe message, raw detail never exposed', async (code, status) => {
    const responses: unknown[] = [];

    for (const detail of [
      'COLLECTION_IN_PROGRESS: snapshot 7d1f-secret-uuid lease held',
      'SHOPIFY_GRAPHQL_ERROR: Throttled provider-secret-detail',
    ]) {
      startMock.mockReset();
      startMock.mockRejectedValue(new Error(`[${code}] ${detail}`));

      const res = await request(buildApp())
        .post('/opening-inventory/start')
        .send({ assigned_to: 555 });

      expect(res.status).toBe(status);
      expect(res.body.code).toBe(code);
      expect(typeof res.body.error).toBe('string');
      expect(res.body.error.length).toBeGreaterThan(0);
      expect(JSON.stringify(res.body)).not.toContain(`[${code}]`);
      expect(JSON.stringify(res.body)).not.toContain('secret');
      responses.push(res.body);
    }

    // Fixed public message: independent of the internal/provider detail.
    expect(responses[0]).toEqual(responses[1]);
  });

  it.each([
    ['connect ECONNREFUSED secret-host:5432'],
    ['wrapped: [OPENING_RECOUNT_SHOP_START] mid-message prefix'],
  ])('unclassified failure %s => 500 stable code, raw text never exposed', async (message) => {
    startMock.mockRejectedValue(new Error(message));

    const res = await request(buildApp())
      .post('/opening-inventory/start')
      .send({ assigned_to: 555 })
      .expect(500);

    expect(res.body.code).toBe('OPENING_START_INTERNAL');
    expect(JSON.stringify(res.body)).not.toContain('secret-host');
    expect(JSON.stringify(res.body)).not.toContain('mid-message');
  });
});
