// tests/integration/workers/carrier-tracking-reconciliation-1114.test.ts
//
// #1114 STEP 7B — carrier tracking reconciliation cycle/service, RED.
// PERMANENT regression contracts, authored RED.
// ===========================================================================
// Target future seam:
//   apps/backend/src/services/wms/carrierTrackingReconciliation.service.ts
//   export runCarrierTrackingReconciliationCycle(): Promise<...>
//
// Required flow under test:
//   public.list_reconcilable_shipment_tenants() (real, migration 0182, via
//   systemQuery — locator gives ONLY id/shop_id)
//     -> tenant-scoped re-fetch of the real shipment row (withTenant)
//     -> resolveCarrierCredentials(trx, shopId, carrierCode) (real, STEP 5C)
//     -> the correct ICarrierTrackingProvider.getTracking() (Shippo or
//        Sendcloud — mocked via jest.spyOn per GH-1114 convention; HTTP-level
//        correctness of getTracking itself is already covered by
//        carrier-provider-tracking-read-1114.test.ts and is NOT re-proven
//        here)
//     -> ingestCarrierTrackingObservation(trx, observation) (real, STEP 3),
//        with businessCarrierCode/statusNamespace routed per carrier:
//          shippo:    businessCarrierCode='shippo',    statusNamespace='shippo'
//          sendcloud: businessCarrierCode='sendcloud', statusNamespace='sendcloud_v3'
//
// Every webhook-parity assertion below (unknown status, exception alert,
// returned alert + Return Job, delivered->returned advance, stale-event
// non-regression) exercises this real DB state through the REAL shared
// ingestion seam — it does not reimplement shouldUpdateShipmentTruth or
// alert-shape logic; that is already exhaustively covered by
// carrier-tracking-recovery-1114.test.ts and carrier-tracking-namespace-
// separation-1114.test.ts (existing GREEN controls, not duplicated here).
//
// REQUIRED RED (at authoring time): the reconciliation service module does
// not exist yet. A controlled dynamic import + guard (matching the STEP 5B
// convention) surfaces this as a clean, attributable per-test failure —
// AFTER each test's own DB fixture setup has already completed — rather
// than a suite-collection-level module-resolution crash.

import crypto from 'crypto';
import db, {
  withTenant,
  setTenantContext,
  systemTransaction,
  systemQuery,
} from '@lasyncro/backend-core/db.js';
import { createTenantShop } from '@lasyncro/backend-core/services/pre-tenant.service.js';
import { encrypt } from 'api-src/security/encryption.service';
import { shippoCarrierService } from 'api-src/services/wms/carriers/shippo.carrier.service';
import { sendcloudCarrierService } from 'api-src/services/wms/carriers/sendcloud.carrier.service';

const now = new Date();

function daysAgo(n: number): Date {
  return new Date(Date.now() - n * 24 * 60 * 60 * 1000);
}

function encryptedField(secret: string): string {
  return JSON.stringify(encrypt(secret));
}

async function createShop(prefix: string): Promise<number> {
  const unique = crypto.randomBytes(6).toString('hex');
  return systemTransaction(async (trx) => {
    const id = await createTenantShop(trx, `${prefix}-${unique}`);
    await setTenantContext(trx, id);
    return id;
  });
}

async function seedOrder(shopId: number): Promise<string> {
  const orderId = crypto.randomUUID();
  await withTenant(shopId, async (trx) => {
    await trx('orders').insert({
      lasyncro_order_id: orderId,
      shop_id: shopId,
      payment_state: 'paid',
      currency: 'USD',
      total_price: '100.00',
      subtotal_price: '100.00',
      total_tax: '0.00',
      order_created_at: now,
      order_updated_at: now,
      created_at: now,
      updated_at: now,
    });

    await trx.raw(`SET LOCAL "synchroflow.projection" = 'true'`);

    await trx('order_fulfillment_status').insert({
      lasyncro_fulfillment_id: crypto.randomUUID(),
      lasyncro_order_id: orderId,
      status: 'pending',
      status_updated_at: now,
    });

    // Required by confirmShipmentFromCarrierHandoff, invoked whenever a
    // dispatched event maps to a CARRIER_HANDOFF_EVENTS type — same fixture
    // precedent as tests/integration/webhooks/carrier-tracking-recovery-1114.test.ts.
    await trx('order_warehouse_status').insert({
      lasyncro_order_id: orderId,
      status: 'packed',
      status_updated_at: now,
    });
  });
  return orderId;
}

async function seedCarrierSettings(
  shopId: number,
  carrierCode: 'shippo' | 'sendcloud',
  fields: { publicKey?: string; privateKey?: string; apiToken?: string },
  isActive = true
): Promise<void> {
  await withTenant(shopId, (trx) =>
    trx('shop_carrier_settings').insert({
      shop_id: shopId,
      carrier_code: carrierCode,
      public_key: fields.publicKey ? encryptedField(fields.publicKey) : null,
      private_key: fields.privateKey ? encryptedField(fields.privateKey) : null,
      api_token: fields.apiToken ? encryptedField(fields.apiToken) : null,
      is_active: isActive,
    })
  );
}

interface ShipmentFixture {
  shopId: number;
  orderId: string;
  carrierCode: 'shippo' | 'sendcloud' | 'ups';
  trackingNumber: string | null;
  latestStatus?: string | null;
  latestEventAt?: Date | null;
  createdAt?: Date;
  providerCarrierCode?: string | null;
  isStalled?: boolean;
}

async function seedShipment(fixture: ShipmentFixture): Promise<string> {
  const id = crypto.randomUUID();
  await withTenant(fixture.shopId, (trx) =>
    trx('order_shipment_tracking').insert({
      id,
      shop_id: fixture.shopId,
      lasyncro_order_id: fixture.orderId,
      carrier_code: fixture.carrierCode,
      tracking_number: fixture.trackingNumber,
      latest_status: fixture.latestStatus ?? null,
      latest_event_at: fixture.latestEventAt ?? null,
      created_at: fixture.createdAt ?? daysAgo(0),
      provider_carrier_code: fixture.providerCarrierCode ?? null,
      is_stalled: fixture.isStalled ?? false,
    })
  );
  return id;
}

async function getShipment(shopId: number, id: string) {
  return withTenant(shopId, (trx) => trx('order_shipment_tracking').where({ id }).first());
}

async function trackingEvents(shopId: number, shipmentTrackingId: string) {
  return withTenant(shopId, (trx) => trx('parcel_tracking_events').where({ shipment_tracking_id: shipmentTrackingId }).select('*'));
}

async function stalledAlert(shopId: number, shipmentTrackingId: string) {
  return withTenant(shopId, (trx) =>
    trx('alerts').where({ shop_id: shopId, alert_key: `carrier_webhook:${shipmentTrackingId}:carrier_stalled` }).first()
  );
}

async function unknownStatusAlert(shopId: number, shipmentTrackingId: string) {
  return withTenant(shopId, (trx) =>
    trx('alerts').where({ shop_id: shopId, alert_key: `carrier_webhook:${shipmentTrackingId}:carrier_unknown_status` }).first()
  );
}

async function returnAlert(shopId: number, shipmentTrackingId: string) {
  return withTenant(shopId, (trx) =>
    trx('alerts').where({ shop_id: shopId, alert_key: `carrier_webhook:${shipmentTrackingId}:carrier_return` }).first()
  );
}

async function returnJobsForOrder(shopId: number, orderId: string) {
  return withTenant(shopId, (trx) => trx('return_jobs').where({ lasyncro_order_id: orderId, origin: 'undelivered_return' }).select('*'));
}

/** Confirms the real SECURITY DEFINER selector (migration 0182) actually sees this shipment id. */
async function selectorSees(shipmentId: string): Promise<boolean> {
  const result = await systemQuery(db.raw('SELECT id FROM public.list_reconcilable_shipment_tenants()'));
  return result.rows.some((r: any) => String(r.id) === shipmentId);
}

/**
 * Dynamic import so a missing service module fails cleanly INSIDE a
 * running test (after that test's own DB fixtures have already been
 * seeded successfully), matching the STEP 5B resolveCarrierCredentials RED
 * convention — not a suite-collection-level crash.
 */
async function importReconciliationCycle(): Promise<() => Promise<unknown>> {
  try {
    const mod: any = await import('api-src/services/wms/carrierTrackingReconciliation.service');
    if (typeof mod.runCarrierTrackingReconciliationCycle !== 'function') {
      throw new Error('runCarrierTrackingReconciliationCycle export missing from carrierTrackingReconciliation.service');
    }
    return mod.runCarrierTrackingReconciliationCycle;
  } catch (err) {
    throw new Error(
      `[CARRIER_RECONCILIATION_SERVICE_SEAM_MISSING] runCarrierTrackingReconciliationCycle does not exist yet: ${(err as Error).message}`
    );
  }
}

describe('#1114 STEP 7B — carrier tracking reconciliation cycle (RED)', () => {
  let shippoSpy: jest.SpyInstance;
  let sendcloudSpy: jest.SpyInstance;
  let logSpy: jest.SpyInstance;
  let warnSpy: jest.SpyInstance;
  let errorSpy: jest.SpyInstance;

  beforeEach(() => {
    shippoSpy = jest.spyOn(shippoCarrierService, 'getTracking');
    sendcloudSpy = jest.spyOn(sendcloudCarrierService, 'getTracking');
    logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  // ── A. Shippo missed-webhook repair ──────────────────────────────────
  it('A: repairs a missed Shippo webhook — provider read routed with exact tracking number + providerCarrierCode, evidence and projection advance', async () => {
    const shopId = await createShop('reconA');
    const orderId = await seedOrder(shopId);
    await seedCarrierSettings(shopId, 'shippo', { apiToken: 'shippo-secret-reconA' });
    const shipmentId = await seedShipment({
      shopId, orderId, carrierCode: 'shippo', trackingNumber: 'TN-RECON-A',
      latestStatus: 'in_transit', latestEventAt: daysAgo(5), providerCarrierCode: 'usps',
    });

    const newerEventTime = daysAgo(1);
    shippoSpy.mockResolvedValue({
      rawStatus: 'DELIVERED',
      eventTimestamp: newerEventTime,
      location: 'Stockholm, AB, SE',
      rawPayload: { fixture: 'reconA' },
    });

    const runCycle = await importReconciliationCycle();
    await runCycle();

    expect(shippoSpy).toHaveBeenCalledWith(
      expect.objectContaining({ trackingNumber: 'TN-RECON-A', providerCarrierCode: 'usps' }),
      expect.objectContaining({ apiToken: 'shippo-secret-reconA' })
    );

    const events = await trackingEvents(shopId, shipmentId);
    expect(events).toHaveLength(1);
    expect(events[0].carrier_code).toBe('shippo');
    expect(events[0].event_type).toBe('delivered');

    const shipment = await getShipment(shopId, shipmentId);
    expect(shipment.latest_status).toBe('delivered');
    expect(new Date(shipment.latest_event_at).getTime()).toBe(newerEventTime.getTime());
  });

  // ── B. Sendcloud v3 namespace separation ─────────────────────────────
  it('B: Sendcloud reconciliation resolves via the sendcloud_v3 namespace but persists business identity as sendcloud', async () => {
    const shopId = await createShop('reconB');
    const orderId = await seedOrder(shopId);
    await seedCarrierSettings(shopId, 'sendcloud', { publicKey: 'sc-pub-reconB', privateKey: 'sc-priv-reconB' });
    const shipmentId = await seedShipment({
      shopId, orderId, carrierCode: 'sendcloud', trackingNumber: 'TN-RECON-B',
      latestStatus: 'announced', latestEventAt: daysAgo(3),
    });

    // 'Parcel en route' exists ONLY under carrier_code='sendcloud_v3' in
    // carrier_status_map (migration 0180) — proves the lookup genuinely
    // used the v3 namespace, not the plain 'sendcloud' webhook vocabulary.
    sendcloudSpy.mockResolvedValue({
      rawStatus: 'Parcel en route',
      eventTimestamp: daysAgo(1),
      location: null,
      rawPayload: { fixture: 'reconB' },
    });

    const runCycle = await importReconciliationCycle();
    await runCycle();

    const events = await trackingEvents(shopId, shipmentId);
    expect(events).toHaveLength(1);
    expect(events[0].event_type).toBe('in_transit');
    // Business-facing identity is 'sendcloud' — 'sendcloud_v3' must never leak.
    expect(events[0].carrier_code).toBe('sendcloud');
    expect(events[0].carrier_code).not.toBe('sendcloud_v3');

    const shipment = await getShipment(shopId, shipmentId);
    expect(shipment.carrier_code).toBe('sendcloud');
    expect(shipment.latest_status).toBe('in_transit');

    // No business-facing value anywhere equals the lookup namespace.
    const alerts = await withTenant(shopId, (trx) => trx('alerts').where({ shop_id: shopId }).select('source'));
    for (const alert of alerts) expect(alert.source).not.toBe('sendcloud_v3');
  });

  // ── C/D. Repeated-event idempotency + stale-event non-regression ────
  it('C/D: a repeated identical provider event stays idempotent, and a subsequently-returned OLDER event cannot regress truth', async () => {
    const shopId = await createShop('reconCD');
    const orderId = await seedOrder(shopId);
    await seedCarrierSettings(shopId, 'sendcloud', { publicKey: 'sc-pub-reconCD', privateKey: 'sc-priv-reconCD' });
    const shipmentId = await seedShipment({
      shopId, orderId, carrierCode: 'sendcloud', trackingNumber: 'TN-RECON-CD',
      latestStatus: 'in_transit', latestEventAt: daysAgo(5),
    });

    const advancingEventTime = daysAgo(2);
    sendcloudSpy.mockResolvedValue({
      rawStatus: 'Driver en route', // sendcloud_v3 -> out_for_delivery
      eventTimestamp: advancingEventTime,
      location: null,
      rawPayload: { fixture: 'reconCD-advance' },
    });

    const runCycle = await importReconciliationCycle();

    // Cycle 1 — advances truth.
    await runCycle();
    let shipment = await getShipment(shopId, shipmentId);
    expect(shipment.latest_status).toBe('out_for_delivery');
    let events = await trackingEvents(shopId, shipmentId);
    expect(events).toHaveLength(1);

    // Cycle 2 — EXACT same provider event repeated (idempotent: no
    // duplicate evidence row, no artifact duplication).
    await runCycle();
    events = await trackingEvents(shopId, shipmentId);
    expect(events).toHaveLength(1);
    shipment = await getShipment(shopId, shipmentId);
    expect(shipment.latest_status).toBe('out_for_delivery');

    // Cycle 3 — provider now returns an OLDER event than current truth.
    // Evidence may be retained; the projection must NOT regress.
    sendcloudSpy.mockResolvedValue({
      rawStatus: 'Announced',
      eventTimestamp: daysAgo(4),
      location: null,
      rawPayload: { fixture: 'reconCD-stale' },
    });
    await runCycle();
    shipment = await getShipment(shopId, shipmentId);
    expect(shipment.latest_status).toBe('out_for_delivery');
    expect(new Date(shipment.latest_event_at).getTime()).toBe(advancingEventTime.getTime());
  });

  // ── E. Unknown provider status is honest ─────────────────────────────
  it('E: an unmapped provider raw status is recorded honestly, with the existing carrier_unknown_status alert shape', async () => {
    const shopId = await createShop('reconE');
    const orderId = await seedOrder(shopId);
    await seedCarrierSettings(shopId, 'sendcloud', { publicKey: 'sc-pub-reconE', privateKey: 'sc-priv-reconE' });
    const shipmentId = await seedShipment({
      shopId, orderId, carrierCode: 'sendcloud', trackingNumber: 'TN-RECON-E',
      latestStatus: 'announced', latestEventAt: daysAgo(3),
    });

    sendcloudSpy.mockResolvedValue({
      rawStatus: 'RECON_1114_UNMAPPED_STATUS',
      eventTimestamp: daysAgo(1),
      location: null,
      rawPayload: { fixture: 'reconE' },
    });

    const runCycle = await importReconciliationCycle();
    await runCycle();

    const events = await trackingEvents(shopId, shipmentId);
    expect(events).toHaveLength(1);
    expect(events[0].event_type).toBe('unknown');
    expect(events[0].event_type).not.toBe('in_transit');
    expect(events[0].event_type).not.toBe('exception');

    const shipment = await getShipment(shopId, shipmentId);
    expect(shipment.latest_status).toBe('unknown');

    const alert = await unknownStatusAlert(shopId, shipmentId);
    expect(alert).toBeTruthy();
    expect(alert.source).toBe('carrier_webhook');
    expect(alert.severity).toBe('warning');
  });

  // ── F. Exception parity ──────────────────────────────────────────────
  it('F: a mapped exception reproduces the existing carrier_stalled alert contract exactly', async () => {
    const shopId = await createShop('reconF');
    const orderId = await seedOrder(shopId);
    await seedCarrierSettings(shopId, 'shippo', { apiToken: 'shippo-secret-reconF' });
    const shipmentId = await seedShipment({
      shopId, orderId, carrierCode: 'shippo', trackingNumber: 'TN-RECON-F',
      latestStatus: 'in_transit', latestEventAt: daysAgo(3), providerCarrierCode: 'usps',
    });

    shippoSpy.mockResolvedValue({
      rawStatus: 'FAILURE',
      eventTimestamp: daysAgo(1),
      location: null,
      rawPayload: { fixture: 'reconF' },
    });

    const runCycle = await importReconciliationCycle();
    await runCycle();

    const shipment = await getShipment(shopId, shipmentId);
    expect(shipment.latest_status).toBe('exception');
    expect(shipment.is_stalled).toBe(true);

    const alert = await stalledAlert(shopId, shipmentId);
    expect(alert).toBeTruthy();
    expect(alert.source).toBe('carrier_webhook');
    expect(alert.alert_type).toBe('carrier_stalled');
    expect(alert.severity).toBe('critical');
  });

  // ── G/H. Returned parity + delivered -> later returned ───────────────
  it('G/H: a genuinely later returned event advances delivered truth and fires the existing carrier_return alert + Return Job', async () => {
    const shopId = await createShop('reconGH');
    const orderId = await seedOrder(shopId);
    await seedCarrierSettings(shopId, 'sendcloud', { publicKey: 'sc-pub-reconGH', privateKey: 'sc-priv-reconGH' });
    const shipmentId = await seedShipment({
      shopId, orderId, carrierCode: 'sendcloud', trackingNumber: 'TN-RECON-GH',
      latestStatus: 'delivered', latestEventAt: daysAgo(5),
    });

    sendcloudSpy.mockResolvedValue({
      rawStatus: 'Returned to sender',
      eventTimestamp: daysAgo(1),
      location: null,
      rawPayload: { fixture: 'reconGH' },
    });

    const runCycle = await importReconciliationCycle();
    await runCycle();

    const shipment = await getShipment(shopId, shipmentId);
    expect(shipment.latest_status).toBe('returned');

    const alert = await returnAlert(shopId, shipmentId);
    expect(alert).toBeTruthy();
    expect(alert.source).toBe('carrier_webhook');
    expect(alert.alert_type).toBe('carrier_return');

    const jobs = await returnJobsForOrder(shopId, orderId);
    expect(jobs).toHaveLength(1);
    expect(jobs[0].source).toBe('carrier_webhook');
  });

  // ── I. Returned never regresses — selector excludes it entirely ─────
  it('I: an already-returned shipment is excluded by the real selector, so the cycle never calls the provider for it', async () => {
    const shopId = await createShop('reconI');
    const orderId = await seedOrder(shopId);
    await seedCarrierSettings(shopId, 'sendcloud', { publicKey: 'sc-pub-reconI', privateKey: 'sc-priv-reconI' });

    const returnedShipmentId = await seedShipment({
      shopId, orderId, carrierCode: 'sendcloud', trackingNumber: 'TN-RECON-I-RETURNED',
      latestStatus: 'returned', latestEventAt: daysAgo(1),
    });
    const eligibleShipmentId = await seedShipment({
      shopId, orderId, carrierCode: 'sendcloud', trackingNumber: 'TN-RECON-I-ELIGIBLE',
      latestStatus: 'announced', latestEventAt: daysAgo(1),
    });

    expect(await selectorSees(returnedShipmentId)).toBe(false);
    expect(await selectorSees(eligibleShipmentId)).toBe(true);

    sendcloudSpy.mockResolvedValue({
      rawStatus: 'Parcel en route',
      eventTimestamp: daysAgo(0.5),
      location: null,
      rawPayload: { fixture: 'reconI' },
    });

    const runCycle = await importReconciliationCycle();
    await runCycle();

    // The provider must have been called at most once — for the eligible
    // row only. If it were ever called with the returned row's tracking
    // number, the selector-exclusion guarantee would be violated.
    for (const call of sendcloudSpy.mock.calls) {
      expect(call[0].trackingNumber).not.toBe('TN-RECON-I-RETURNED');
    }

    const returnedRow = await getShipment(shopId, returnedShipmentId);
    expect(returnedRow.latest_status).toBe('returned');
  });

  // ── Failure isolation ─────────────────────────────────────────────────
  it('one provider read failure does not abort the cycle — the next row still reconciles, and the failure is logged without plaintext credentials', async () => {
    const shopId = await createShop('reconFail');
    const orderId = await seedOrder(shopId);
    const plaintextSecret = 'sc-priv-reconFail-do-not-leak';
    await seedCarrierSettings(shopId, 'sendcloud', { publicKey: 'sc-pub-reconFail', privateKey: plaintextSecret });

    const failingShipmentId = await seedShipment({
      shopId, orderId, carrierCode: 'sendcloud', trackingNumber: 'TN-RECON-FAIL-1',
      latestStatus: 'announced', latestEventAt: daysAgo(3),
    });
    const succeedingShipmentId = await seedShipment({
      shopId, orderId, carrierCode: 'sendcloud', trackingNumber: 'TN-RECON-FAIL-2',
      latestStatus: 'announced', latestEventAt: daysAgo(3),
    });

    sendcloudSpy.mockImplementation(async (input: { trackingNumber: string }) => {
      if (input.trackingNumber === 'TN-RECON-FAIL-1') {
        throw new Error('[SENDCLOUD] Tracking HTTP 500: fixture failure');
      }
      return { rawStatus: 'Parcel en route', eventTimestamp: daysAgo(1), location: null, rawPayload: { fixture: 'reconFail-ok' } };
    });

    const runCycle = await importReconciliationCycle();
    await expect(runCycle()).resolves.toBeDefined();

    const failingRow = await getShipment(shopId, failingShipmentId);
    expect(failingRow.latest_status).toBe('announced'); // untouched by the failure

    const succeedingRow = await getShipment(shopId, succeedingShipmentId);
    expect(succeedingRow.latest_status).toBe('in_transit'); // still reconciled

    const allLogged = [...logSpy.mock.calls, ...warnSpy.mock.calls, ...errorSpy.mock.calls]
      .flat()
      .map((arg) => (typeof arg === 'string' ? arg : JSON.stringify(arg)));

    expect(allLogged.some((s) => s.includes('CARRIER_RECONCILIATION_ROW_FAILED'))).toBe(true);
    expect(allLogged.some((s) => s.includes(plaintextSecret))).toBe(false);
  });

  // ── Credential race — settings deactivated between discovery/processing ──
  it('a carrier whose active settings are removed between discovery and processing is skipped, with no cross-carrier credential fallback', async () => {
    const shopId = await createShop('reconCredRace');
    const orderId = await seedOrder(shopId);
    // Shop has an ACTIVE shippo carrier too — proves no fallback to it.
    await seedCarrierSettings(shopId, 'shippo', { apiToken: 'shippo-secret-reconCredRace' });
    await seedCarrierSettings(shopId, 'sendcloud', { publicKey: 'sc-pub-reconCredRace', privateKey: 'sc-priv-reconCredRace' });

    const shipmentId = await seedShipment({
      shopId, orderId, carrierCode: 'sendcloud', trackingNumber: 'TN-RECON-CREDRACE',
      latestStatus: 'announced', latestEventAt: daysAgo(1),
    });

    // Confirmed eligible under the real selector at discovery time...
    expect(await selectorSees(shipmentId)).toBe(true);

    // ...then the merchant deactivates Sendcloud before processing runs —
    // simulating the exact race resolveCarrierCredentials must handle
    // safely (never fall back to the shop's still-active Shippo settings).
    await withTenant(shopId, (trx) =>
      trx('shop_carrier_settings').where({ shop_id: shopId, carrier_code: 'sendcloud' }).update({ is_active: false })
    );

    const runCycle = await importReconciliationCycle();
    await expect(runCycle()).resolves.toBeDefined();

    // The suite shares one disposable DB and the selector is intentionally
    // cross-tenant, so the global spy also accumulates calls from OTHER
    // tests' still-eligible fixtures — scope the assertion to THIS test's
    // own tracking number rather than the spy's global call count.
    const sendcloudCallsForThisFixture = sendcloudSpy.mock.calls.filter(
      (call: any[]) => call[0].trackingNumber === 'TN-RECON-CREDRACE'
    );
    const shippoCallsForThisFixture = shippoSpy.mock.calls.filter(
      (call: any[]) => call[0].trackingNumber === 'TN-RECON-CREDRACE'
    );
    expect(sendcloudCallsForThisFixture).toHaveLength(0);
    expect(shippoCallsForThisFixture).toHaveLength(0);

    const shipment = await getShipment(shopId, shipmentId);
    expect(shipment.latest_status).toBe('announced'); // untouched
  });

  // ── Missing Shippo metadata defense-in-depth ──────────────────────────
  it('a Shippo shipment reaching processing with no provider_carrier_code is skipped, never calling the provider or guessing a token', async () => {
    // Migration 0182 already excludes provider_carrier_code IS NULL Shippo
    // rows from the real selector — this is a defense-in-depth contract at
    // the service boundary itself, exercised directly against a shipment
    // shaped exactly like the excluded case, rather than depending on
    // selector bypass (which correctly cannot happen through real data).
    const shopId = await createShop('reconShippoMeta');
    const orderId = await seedOrder(shopId);
    await seedCarrierSettings(shopId, 'shippo', { apiToken: 'shippo-secret-reconShippoMeta' });
    const shipmentId = await seedShipment({
      shopId, orderId, carrierCode: 'shippo', trackingNumber: 'TN-RECON-SHIPPO-META',
      latestStatus: 'in_transit', latestEventAt: daysAgo(1), providerCarrierCode: null,
    });

    // Confirmed excluded by the real selector — consistent with migration 0182.
    expect(await selectorSees(shipmentId)).toBe(false);

    const runCycle = await importReconciliationCycle();
    await expect(runCycle()).resolves.toBeDefined();

    // Scoped to this test's own tracking number — see the credential-race
    // test above for why the global spy count can't be asserted directly
    // in a suite that shares one disposable DB with a cross-tenant selector.
    const shippoCallsForThisFixture = shippoSpy.mock.calls.filter(
      (call: any[]) => call[0].trackingNumber === 'TN-RECON-SHIPPO-META'
    );
    expect(shippoCallsForThisFixture).toHaveLength(0);
    const shipment = await getShipment(shopId, shipmentId);
    expect(shipment.latest_status).toBe('in_transit'); // untouched
  });

  // ── Null provider event timestamp — load-bearing, never fabricated ────
  it('a provider tracking result with a null eventTimestamp is never ingested, and shipment truth is never mutated with a fabricated timestamp', async () => {
    const shopId = await createShop('reconNullTs');
    const orderId = await seedOrder(shopId);
    await seedCarrierSettings(shopId, 'sendcloud', { publicKey: 'sc-pub-reconNullTs', privateKey: 'sc-priv-reconNullTs' });
    const seededLatestEventAt = daysAgo(3);

    const shipmentId = await seedShipment({
      shopId, orderId, carrierCode: 'sendcloud', trackingNumber: 'TN-RECON-NULLTS',
      latestStatus: 'announced', latestEventAt: seededLatestEventAt,
    });

    // ICarrierTrackingProvider permits eventTimestamp: Date | null (for a
    // future provider that genuinely has none) — the reconciliation
    // service must never substitute new Date() or cycle receipt time.
    sendcloudSpy.mockResolvedValue({
      rawStatus: 'Parcel en route',
      eventTimestamp: null,
      location: null,
      rawPayload: { fixture: 'reconNullTs' },
    });

    const runCycle = await importReconciliationCycle();
    await expect(runCycle()).resolves.toBeDefined();

    const events = await trackingEvents(shopId, shipmentId);
    expect(events).toHaveLength(0); // no evidence fabricated

    const shipment = await getShipment(shopId, shipmentId);
    expect(shipment.latest_status).toBe('announced'); // untouched
    expect(new Date(shipment.latest_event_at).getTime()).toBe(seededLatestEventAt.getTime());

    const allLogged = [...logSpy.mock.calls, ...warnSpy.mock.calls, ...errorSpy.mock.calls]
      .flat()
      .map((arg) => (typeof arg === 'string' ? arg : JSON.stringify(arg)));
    expect(allLogged.some((s) => s.includes('CARRIER_RECONCILIATION_EVENT_TIMESTAMP_MISSING'))).toBe(true);
  });

  // ── Tenant isolation ───────────────────────────────────────────────────
  it('reconciles two shops independently, even with a colliding tracking_number, without cross-tenant leakage', async () => {
    const shopA = await createShop('reconTenantA');
    const shopB = await createShop('reconTenantB');
    const orderA = await seedOrder(shopA);
    const orderB = await seedOrder(shopB);

    await seedCarrierSettings(shopA, 'sendcloud', { publicKey: 'sc-pub-tenantA', privateKey: 'sc-priv-tenantA' });
    await seedCarrierSettings(shopB, 'sendcloud', { publicKey: 'sc-pub-tenantB', privateKey: 'sc-priv-tenantB' });

    const collidingTrackingNumber = 'TN-RECON-TENANT-COLLISION';
    const shipmentA = await seedShipment({
      shopId: shopA, orderId: orderA, carrierCode: 'sendcloud', trackingNumber: collidingTrackingNumber,
      latestStatus: 'announced', latestEventAt: daysAgo(3),
    });
    const shipmentB = await seedShipment({
      shopId: shopB, orderId: orderB, carrierCode: 'sendcloud', trackingNumber: collidingTrackingNumber,
      latestStatus: 'announced', latestEventAt: daysAgo(3),
    });

    // Each provider call is scoped by (shopId, carrierCode) credentials, not
    // by tracking number — the shared ingestion seam matches the DB row by
    // (shop_id, tracking_number), so a shared response fed to both calls
    // must still update ONLY the shop whose transaction issued that call.
    sendcloudSpy.mockResolvedValue({
      rawStatus: 'Driver en route',
      eventTimestamp: daysAgo(1),
      location: null,
      rawPayload: { fixture: 'reconTenant' },
    });

    const runCycle = await importReconciliationCycle();
    await runCycle();

    // Scoped to this test's own (intentionally colliding) tracking number —
    // the shared disposable DB accumulates other tests' eligible shipments
    // too, so the global spy call count is not this test's contract.
    const callsForCollidingTrackingNumber = sendcloudSpy.mock.calls.filter(
      (call: any[]) => call[0].trackingNumber === collidingTrackingNumber
    );
    expect(callsForCollidingTrackingNumber).toHaveLength(2);

    const rowA = await getShipment(shopA, shipmentA);
    const rowB = await getShipment(shopB, shipmentB);
    expect(rowA.latest_status).toBe('out_for_delivery');
    expect(rowB.latest_status).toBe('out_for_delivery');

    // Cross-tenant leak check: neither shop's row was written under the
    // OTHER shop's tenant context (RLS would have hidden it entirely if
    // withTenant(shopB, ...) had somehow been used to update shop A's row).
    const crossA = await withTenant(shopB, (trx) => trx('order_shipment_tracking').where({ id: shipmentA }).first());
    const crossB = await withTenant(shopA, (trx) => trx('order_shipment_tracking').where({ id: shipmentB }).first());
    expect(crossA).toBeUndefined();
    expect(crossB).toBeUndefined();
  });
});
