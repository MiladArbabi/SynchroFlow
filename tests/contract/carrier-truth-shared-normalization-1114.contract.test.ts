// tests/contract/carrier-truth-shared-normalization-1114.contract.test.ts
//
// DR-02 (#1114) — architecture/static contract.
//
// DR-01 audit finding: shippo.tracking.handler.ts and
// sendcloud.tracking.handler.ts independently re-implemented normalization
// interpretation (~90% structurally duplicated). DR-02 extracted the pure
// decision logic into carrierTrackingNormalization.ts.
//
// #1114 STEP 3 update: the handlers no longer call carrierTrackingNormalization
// directly at all — they are now thin adapters (parse provider payload ->
// build a provider-neutral observation -> ingestCarrierTrackingObservation).
// The shared DB-bound ingestion seam is the sole caller of
// carrierTrackingNormalization's decision functions. This file now pins
// THREE things instead of the handlers-call-normalization-directly shape it
// used to assert:
//   1. both handlers delegate to ingestCarrierTrackingObservation, not to
//      carrierTrackingNormalization directly, and carry no re-implemented
//      carrier-truth persistence/alert/Return-Job logic of their own;
//   2. the shared ingestion seam is the one place that calls
//      carrierTrackingNormalization's decision functions;
//   3. the identity-separation contracts (DR-02-CORRECTION-A/B/C) still hold,
//      now checked against whichever module actually owns that logic.

import fs from 'fs';
import path from 'path';

const REPO = path.resolve(__dirname, '../..');
const read = (rel: string): string => fs.readFileSync(path.join(REPO, rel), 'utf8');

const SHIPPO_HANDLER = 'apps/backend/src/api/webhooks/shippo.tracking.handler.ts';
const SENDCLOUD_HANDLER = 'apps/backend/src/api/webhooks/sendcloud.tracking.handler.ts';
const NORMALIZATION_MODULE = 'apps/backend/src/api/webhooks/carrierTrackingNormalization.ts';
const INGESTION_MODULE = 'apps/backend/src/api/webhooks/ingestCarrierTrackingObservation.ts';

describe('DR-02 (#1114) — shared carrier tracking normalization', () => {
  it('the shared normalization module exists', () => {
    expect(() => read(NORMALIZATION_MODULE)).not.toThrow();
  });

  it('#1114 STEP 3: the shared ingestion module exists', () => {
    expect(() => read(INGESTION_MODULE)).not.toThrow();
  });

  it.each([SHIPPO_HANDLER, SENDCLOUD_HANDLER])(
    '%s delegates to ingestCarrierTrackingObservation rather than calling carrierTrackingNormalization directly',
    (handlerPath) => {
      const src = read(handlerPath);
      expect(src).toMatch(/from ['"]\.\/ingestCarrierTrackingObservation\.js['"]/);
      expect(src).toContain('ingestCarrierTrackingObservation(');
      // The handler is a thin adapter now — the decision functions belong
      // solely to the shared ingestion seam.
      expect(src).not.toMatch(/from ['"]\.\/carrierTrackingNormalization\.js['"]/);
      expect(src).not.toContain('resolveCanonicalEventType');
      expect(src).not.toContain('shouldUpdateShipmentTruth');
    }
  );

  it.each([SHIPPO_HANDLER, SENDCLOUD_HANDLER])(
    '%s carries no re-implemented carrier-truth persistence, alert, or Return-Job logic of its own',
    (handlerPath) => {
      const src = read(handlerPath);
      // These table/service calls now live exclusively in
      // ingestCarrierTrackingObservation.ts — a handler reintroducing any of
      // them would mean the DR-01 duplication has silently returned.
      expect(src).not.toContain("trx('order_shipment_tracking')");
      expect(src).not.toContain("trx('parcel_tracking_events')");
      expect(src).not.toContain("trx('alerts')");
      expect(src).not.toContain('confirmShipmentFromCarrierHandoff');
      expect(src).not.toContain('createReturnJobFromCarrierEvent');
    }
  );

  it('the shared ingestion seam is the one place that calls carrierTrackingNormalization\'s decision functions', () => {
    const src = read(INGESTION_MODULE);
    expect(src).toMatch(/from ['"]\.\/carrierTrackingNormalization\.js['"]/);
    expect(src).toContain('resolveCanonicalEventType');
    expect(src).toContain('shouldUpdateShipmentTruth');
    expect(src).toContain('toAuditEventType');
    expect(src).toContain('toProjectionStatus');
  });

  it('the shared ingestion seam owns Return Job creation and shipment handoff confirmation, delegated to the existing services', () => {
    const src = read(INGESTION_MODULE);
    expect(src).toContain('createReturnJobFromCarrierEvent');
    expect(src).toMatch(/from ['"]\.\.\/\.\.\/services\/returns\/returnJobs\.service\.js['"]/);
    expect(src).toContain('confirmShipmentFromCarrierHandoff');
    expect(src).toMatch(/from ['"]\.\.\/\.\.\/services\/wms\/shipConfirmation\.service\.js['"]/);
  });

  it('#1114 CRITICAL IDENTITY SEPARATION: the ingestion seam accepts businessCarrierCode and statusNamespace as independent parameters', () => {
    const src = read(INGESTION_MODULE);
    expect(src).toContain('businessCarrierCode');
    expect(src).toContain('statusNamespace');
    // The persisted business identity (parcel_tracking_events.carrier_code)
    // must read from businessCarrierCode, never from statusNamespace.
    expect(src).toMatch(/carrier_code:\s*businessCarrierCode/);
    // The carrier_status_map lookup must key off statusNamespace, never off
    // businessCarrierCode — collapsing these would let a future
    // 'sendcloud_v3' lookup silently become the persisted business identity.
    expect(src).toMatch(/carrier_status_map['"]\)\s*\n\s*\.where\(\{\s*carrier_code:\s*statusNamespace/);
  });

  it.each([SHIPPO_HANDLER, SENDCLOUD_HANDLER])(
    '%s no longer contains the pre-DR-02 silent unmapped-to-in_transit fallback comment',
    (handlerPath) => {
      const src = read(handlerPath);
      // Pre-DR-02 sendcloud handler: `?? 'in_transit'; // unmapped codes default to in_transit rather than dropping the event`
      // Pre-DR-02 shippo handler: `statusMap?.event_type ?? 'in_transit';` with no honest-unknown handling at all.
      // Neither handler computes its own local eventType fallback anymore —
      // it no longer computes eventType at all (that's the ingestion seam's job).
      expect(src).not.toMatch(/statusMap\?\.event_type\s*\?\?\s*'in_transit'/);
    }
  );

  it('DR-02-CORRECTION-B: the Sendcloud handler no longer imports or references the removed receipt-time dedup heuristic', () => {
    const src = read(SENDCLOUD_HANDLER);
    expect(src).not.toContain('isLikelyRecentSendcloudDuplicate');
    expect(src).not.toContain('SENDCLOUD_RECEIPT_TIME_DEDUP_WINDOW_MS');
  });

  it('the normalization module never maps an unmapped status to delivery_exception (exception) automatically', () => {
    const src = read(NORMALIZATION_MODULE);
    // toProjectionStatus and toAuditEventType must be the ONLY places a
    // null (unmapped) mappedEventType is resolved to a concrete value, and
    // neither may resolve it to 'exception'.
    expect(src).toMatch(/mappedEventType \?\? 'unknown'/g);
    expect(src).not.toMatch(/mappedEventType \?\? 'exception'/);
    expect(src).not.toMatch(/mappedEventType \?\? 'in_transit'/);
  });

  it('DR-02-CORRECTION-A: toAuditEventType no longer falls back to in_transit for an unmapped status', () => {
    const src = read(NORMALIZATION_MODULE);
    expect(src).not.toMatch(/toAuditEventType[\s\S]{0,200}'in_transit'/);
  });

  it('DR-02-CORRECTION-C: the normalization module no longer blanket-locks delivered as a terminal type', () => {
    const src = read(NORMALIZATION_MODULE);
    expect(src).not.toMatch(/TERMINAL_EVENT_TYPES\s*:\s*ReadonlySet<CanonicalEventType>\s*=\s*new Set\(\[\s*'delivered'/);
    expect(src).toContain('ABSOLUTE_TERMINAL_EVENT_TYPES');
  });

  it('#1114: the shared ingestion seam creates the returned-event Return Job/alert unconditionally on mappedEventType, never nested inside the projection-applied branch', () => {
    const src = read(INGESTION_MODULE);
    const returnedBranchStart = src.indexOf("mappedEventType === 'returned'");
    expect(returnedBranchStart).toBeGreaterThan(-1);

    // The 'returned' branch must be a sibling of, not nested inside, the
    // `if (applyProjection)` block — find the applyProjection block's
    // extent and confirm the returned-branch starts after it closes.
    const applyProjectionIndex = src.indexOf('if (applyProjection)');
    expect(applyProjectionIndex).toBeGreaterThan(-1);
    expect(applyProjectionIndex).toBeLessThan(returnedBranchStart);

    // The `else` for the stale/terminal warning log must close before the
    // returned-artifact block begins — i.e. the returned branch is not
    // textually inside either arm of the applyProjection if/else.
    const staleWarningIndex = src.indexOf('CARRIER_TRACKING_PROJECTION_SKIPPED_STALE_OR_TERMINAL');
    expect(staleWarningIndex).toBeGreaterThan(applyProjectionIndex);
    expect(staleWarningIndex).toBeLessThan(returnedBranchStart);
  });
});
