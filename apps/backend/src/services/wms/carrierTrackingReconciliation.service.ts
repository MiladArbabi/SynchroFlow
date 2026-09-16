// apps/backend/src/services/wms/carrierTrackingReconciliation.service.ts
//
// #1114 STEP 7C — carrier tracking reconciliation orchestration.
//
// Fallback/self-healing path for the same canonical carrier-truth pipeline
// webhooks already feed: webhooks remain primary; this cycle repairs truth
// when a webhook was missed. It orchestrates ONLY discovery, tenant-safe
// re-fetch, credential resolution, and provider routing — every actual
// truth decision (carrier_status_map lookup, staleness/terminal guards,
// evidence insertion, alerts, Return Job creation, handoff confirmation,
// idempotency) belongs to the shared ingestCarrierTrackingObservation()
// seam (STEP 3) and is never duplicated here.
//
// Flow per candidate:
//   public.list_reconcilable_shipment_tenants() (SECURITY DEFINER locator —
//   exposes ONLY id/shop_id; never trusted for anything else)
//     -> tenant-scoped re-fetch of the real shipment row (withTenant)
//     -> resolveCarrierCredentials(trx, shopId, carrierCode) (STEP 5C —
//        exact (shop_id, carrier_code, is_active=true) tuple, no fallback)
//     -> provider.getTracking() OUTSIDE any open transaction (never hold a
//        Postgres transaction across an external HTTP call)
//     -> a SEPARATE withTenant scope calling ingestCarrierTrackingObservation
//
// Identity separation (STEP 7B ratified): Sendcloud reconciliation resolves
// its carrier_status_map lookup under statusNamespace='sendcloud_v3', but
// ALWAYS persists businessCarrierCode='sendcloud' — 'sendcloud_v3' must
// never reach a business-facing carrier/source value. Shippo always uses
// 'shippo' for both.
//
// Every row is isolated by its own try/catch: one provider timeout,
// credential failure, malformed response, or DB error never aborts later
// rows. There is no in-cycle retry — the next scheduled cycle is the retry.

import db, { withTenant, systemQuery } from '@lasyncro/backend-core/db.js';
import type { Knex } from 'knex';
import { resolveCarrierCredentials } from './carriers/carrierCredentials.service.js';
import { shippoCarrierService } from './carriers/shippo.carrier.service.js';
import { sendcloudCarrierService } from './carriers/sendcloud.carrier.service.js';
import type { CarrierCredentials, CarrierTrackingObservationInput } from './carriers/ICarrierProvider.js';
import { ingestCarrierTrackingObservation } from '../../api/webhooks/ingestCarrierTrackingObservation.js';

const SUPPORTED_CARRIERS = new Set(['shippo', 'sendcloud']);

export interface CarrierTrackingReconciliationCycleResult {
  candidates: number;
  reconciled: number;
  skipped: number;
  failed: number;
}

interface ReconciliationLocator {
  id: string;
  shop_id: number;
}

interface ReconciliationCandidate {
  shopId: number;
  shipmentTrackingId: string;
  trackingNumber: string;
  carrierCode: 'shippo' | 'sendcloud';
  providerCarrierCode: string | null;
  credentials: CarrierCredentials;
}

type PrepareOutcome = { kind: 'ready'; candidate: ReconciliationCandidate } | { kind: 'skipped' };

/**
 * Tenant-scoped re-fetch + credential resolution for ONE locator row.
 * Never trusts locator data beyond id/shop_id. Never reads the shipment
 * through a bare db/systemQuery call — always withTenant.
 */
async function prepareCandidate(locator: ReconciliationLocator): Promise<PrepareOutcome> {
  return withTenant(locator.shop_id, async (trx: Knex.Transaction) => {
    const shipment = await trx('order_shipment_tracking')
      .where({ id: locator.id, shop_id: locator.shop_id })
      .select('id', 'shop_id', 'tracking_number', 'carrier_code', 'provider_carrier_code')
      .first();

    if (!shipment) {
      // Vanished between locator discovery and processing.
      console.warn('[CARRIER_RECONCILIATION_SHIPMENT_NOT_FOUND]', {
        shopId: locator.shop_id,
        shipmentTrackingId: locator.id,
      });
      return { kind: 'skipped' as const };
    }

    if (!SUPPORTED_CARRIERS.has(shipment.carrier_code)) {
      // Should never arrive from migration 0182 — defense in depth only.
      console.warn('[CARRIER_RECONCILIATION_UNSUPPORTED_CARRIER]', {
        shopId: shipment.shop_id,
        shipmentTrackingId: shipment.id,
        carrierCode: shipment.carrier_code,
      });
      return { kind: 'skipped' as const };
    }

    if (shipment.carrier_code === 'shippo' && !shipment.provider_carrier_code) {
      // Migration 0182 already excludes this shape; defense in depth for a
      // row that reaches processing anyway. Never infer from carrier_zone,
      // tracking_number, or any display text.
      console.warn('[CARRIER_RECONCILIATION_SHIPPO_METADATA_MISSING]', {
        shopId: shipment.shop_id,
        shipmentTrackingId: shipment.id,
        trackingNumber: shipment.tracking_number,
      });
      return { kind: 'skipped' as const };
    }

    // Exact (shop_id, carrier_code, is_active=true) tuple — no fallback to
    // another active carrier. A resolver failure (e.g. settings deactivated
    // between discovery and this exact read) propagates to the caller's
    // per-row try/catch, never to a different carrier's credentials.
    const credentials = await resolveCarrierCredentials(trx, shipment.shop_id, shipment.carrier_code);

    return {
      kind: 'ready' as const,
      candidate: {
        shopId: shipment.shop_id,
        shipmentTrackingId: shipment.id,
        trackingNumber: shipment.tracking_number,
        carrierCode: shipment.carrier_code as 'shippo' | 'sendcloud',
        providerCarrierCode: shipment.provider_carrier_code,
        credentials,
      },
    };
  });
}

/** Provider read + shared ingestion for one already-prepared candidate. */
async function processCandidate(candidate: ReconciliationCandidate): Promise<'reconciled' | 'skipped'> {
  const isShippo = candidate.carrierCode === 'shippo';
  const provider = isShippo ? shippoCarrierService : sendcloudCarrierService;

  const trackingInput: CarrierTrackingObservationInput = isShippo
    ? { trackingNumber: candidate.trackingNumber, providerCarrierCode: candidate.providerCarrierCode }
    : { trackingNumber: candidate.trackingNumber };

  // Deliberately OUTSIDE any open transaction — never hold a Postgres
  // transaction across an external provider HTTP call.
  const result = await provider.getTracking(trackingInput, candidate.credentials);

  const { eventTimestamp } = result;
  if (eventTimestamp === null) {
    // ingestCarrierTrackingObservation requires a real Date. Never
    // substitute new Date(), cycle-start time, or receipt time — that would
    // fabricate chronology the provider did not actually supply.
    console.warn('[CARRIER_RECONCILIATION_EVENT_TIMESTAMP_MISSING]', {
      shopId: candidate.shopId,
      shipmentTrackingId: candidate.shipmentTrackingId,
      carrierCode: candidate.carrierCode,
    });
    return 'skipped';
  }

  // Identity separation (STEP 7B ratified): 'sendcloud_v3' is a
  // carrier_status_map lookup namespace ONLY — business evidence always
  // persists carrier_code='sendcloud'.
  const statusNamespace = isShippo ? 'shippo' : 'sendcloud_v3';

  await withTenant(candidate.shopId, (trx: Knex.Transaction) =>
    ingestCarrierTrackingObservation(trx, {
      shopId: candidate.shopId,
      businessCarrierCode: candidate.carrierCode,
      statusNamespace,
      trackingNumber: candidate.trackingNumber,
      rawStatus: result.rawStatus,
      eventTimestamp,
      location: result.location,
      rawPayload: result.rawPayload,
    })
  );

  return 'reconciled';
}

/**
 * One reconciliation cycle: discover eligible shipments cross-tenant, then
 * process each under its own tenant context and its own failure boundary.
 * Never throws for an individual row's failure — only a failure of the
 * locator query itself (before any row-level isolation begins) rejects.
 */
export async function runCarrierTrackingReconciliationCycle(): Promise<CarrierTrackingReconciliationCycleResult> {
  const locatorResult = await systemQuery(db.raw('SELECT * FROM public.list_reconcilable_shipment_tenants()'));
  const locators = locatorResult.rows as ReconciliationLocator[];

  console.info('[CARRIER_RECONCILIATION_CYCLE_START]', { candidates: locators.length });

  let reconciled = 0;
  let skipped = 0;
  let failed = 0;

  for (const locator of locators) {
    try {
      const prepared = await prepareCandidate(locator);
      if (prepared.kind === 'skipped') {
        skipped++;
        continue;
      }

      const outcome = await processCandidate(prepared.candidate);
      if (outcome === 'skipped') {
        skipped++;
      } else {
        reconciled++;
      }
    } catch (err) {
      failed++;
      console.error('[CARRIER_RECONCILIATION_ROW_FAILED]', {
        shopId: locator.shop_id,
        shipmentTrackingId: locator.id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  const summary: CarrierTrackingReconciliationCycleResult = {
    candidates: locators.length,
    reconciled,
    skipped,
    failed,
  };

  console.info('[CARRIER_RECONCILIATION_CYCLE_OK]', summary);
  return summary;
}
