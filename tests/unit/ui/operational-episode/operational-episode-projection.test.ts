// Imported by relative path rather than '@lasyncro/shared': the frontend
// Jest project's moduleNameMapper has no generic '@lasyncro/shared/(.*)'
// rule (only '@lasyncro/shared/ui'), so the bare package import resolves
// to the package's built dist/index.js via normal node resolution rather
// than this module's TypeScript source, and would not see this slice's
// new export without a package build.
import {
  projectAddressCorrectionEpisode,
  projectInventoryOversellEpisode,
  aggregateOperationalEpisodes,
  resolveDominantEpisode,
  type OperationalEpisodeProjection,
  type OperationalEntityRef,
  type OperationalActionTarget,
} from '../../../../modules/shared/src/contracts/operational-episode';

const ORDER_51: OperationalEntityRef<'order'> = { kind: 'order', id: 'order-51' };
const ORDER_52: OperationalEntityRef<'order'> = { kind: 'order', id: 'order-52' };
const VARIANT_9: OperationalEntityRef<'variant'> = { kind: 'variant', id: 'variant-9' };
const PO_1: OperationalEntityRef<'po'> = { kind: 'po', id: 'po-1' };

const ORDER_51_TARGET: OperationalActionTarget = { kind: 'entity', entity: ORDER_51 };
const VARIANT_9_TARGET: OperationalActionTarget = { kind: 'entity', entity: VARIANT_9 };

describe('projectAddressCorrectionEpisode', () => {
  it('projects a blocking customer/incomplete_address episode for exactly the given order with zero spatial context', () => {
    const episode = projectAddressCorrectionEpisode({
      episodeId: 'ep-address-51',
      lifecycle: 'attention',
      severity: 'critical',
      order: ORDER_51,
      actionTarget: ORDER_51_TARGET,
      occurredAt: '2026-09-20T10:00:00.000Z',
    });

    expect(episode.problem).toEqual({ domain: 'customer', type: 'incomplete_address' });
    expect(episode.blocking).toBe(true);
    expect(episode.primaryEntity).toEqual(ORDER_51);
    expect(episode.affectedEntities).toEqual([ORDER_51]);
    expect(episode.spatialContext).toEqual([]);
  });

  it('emits an "order" kind primary/affected entity, matching the required OperationalEntityRef<"order"> input', () => {
    const episode = projectAddressCorrectionEpisode({
      episodeId: 'ep-address-role',
      lifecycle: 'attention',
      severity: 'warning',
      order: ORDER_51,
      actionTarget: ORDER_51_TARGET,
      occurredAt: '2026-09-20T10:00:00.000Z',
    });

    expect(episode.primaryEntity.kind).toBe('order');
    expect(episode.affectedEntities.every((ref) => ref.kind === 'order')).toBe(true);
  });
});

describe('projectInventoryOversellEpisode', () => {
  it('projects a blocking inventory/oversell episode for exactly the given order + variant', () => {
    const episode = projectInventoryOversellEpisode({
      episodeId: 'ep-oversell-51',
      lifecycle: 'attention',
      severity: 'critical',
      primaryOrder: ORDER_51,
      variant: VARIANT_9,
      actionTarget: VARIANT_9_TARGET,
      occurredAt: '2026-09-20T10:00:00.000Z',
    });

    expect(episode.problem).toEqual({ domain: 'inventory', type: 'oversell' });
    expect(episode.blocking).toBe(true);
    expect(episode.primaryEntity).toEqual(ORDER_51);
    expect(episode.affectedEntities).toEqual(
      expect.arrayContaining([ORDER_51, VARIANT_9]),
    );
  });

  it('emits exactly the expected entity kinds: primary is "order", variant is "variant", POs are "po"', () => {
    const episode = projectInventoryOversellEpisode({
      episodeId: 'ep-oversell-roles',
      lifecycle: 'attention',
      severity: 'critical',
      primaryOrder: ORDER_51,
      variant: VARIANT_9,
      affectedOrders: [ORDER_52],
      relatedPurchaseOrders: [PO_1],
      actionTarget: VARIANT_9_TARGET,
      occurredAt: '2026-09-20T10:00:00.000Z',
    });

    expect(episode.primaryEntity.kind).toBe('order');

    const kindsPresent = new Set(episode.affectedEntities.map((ref) => ref.kind));
    expect(kindsPresent).toEqual(new Set(['order', 'variant', 'po']));

    const poRefs = episode.affectedEntities.filter((ref) => ref.kind === 'po');
    expect(poRefs).toEqual([PO_1]);
    const variantRefs = episode.affectedEntities.filter((ref) => ref.kind === 'variant');
    expect(variantRefs).toEqual([VARIANT_9]);
  });

  it('does not manufacture spatial context when no location evidence is supplied', () => {
    const episode = projectInventoryOversellEpisode({
      episodeId: 'ep-oversell-no-spatial',
      lifecycle: 'attention',
      severity: 'warning',
      primaryOrder: ORDER_51,
      variant: VARIANT_9,
      actionTarget: VARIANT_9_TARGET,
      occurredAt: '2026-09-20T10:00:00.000Z',
    });

    expect(episode.spatialContext).toEqual([]);
  });

  it('preserves explicitly supplied canonical location codes exactly, with confidence=canonical', () => {
    const episode = projectInventoryOversellEpisode({
      episodeId: 'ep-oversell-spatial',
      lifecycle: 'attention',
      severity: 'warning',
      primaryOrder: ORDER_51,
      variant: VARIANT_9,
      canonicalLocationCodes: ['A-01-03'],
      actionTarget: VARIANT_9_TARGET,
      occurredAt: '2026-09-20T10:00:00.000Z',
    });

    expect(episode.spatialContext).toEqual([
      { kind: 'location', locationCode: 'A-01-03', confidence: 'canonical' },
    ]);
  });

  it('deduplicates repeated supplied entity refs and location codes deterministically', () => {
    const episode = projectInventoryOversellEpisode({
      episodeId: 'ep-oversell-dedupe',
      lifecycle: 'attention',
      severity: 'warning',
      primaryOrder: ORDER_51,
      variant: VARIANT_9,
      affectedOrders: [ORDER_52, ORDER_52, ORDER_51],
      relatedPurchaseOrders: [PO_1, PO_1],
      canonicalLocationCodes: ['A-01-03', 'A-01-03', 'B-02-01'],
      actionTarget: VARIANT_9_TARGET,
      occurredAt: '2026-09-20T10:00:00.000Z',
    });

    const orderRefs = episode.affectedEntities.filter((ref) => ref.kind === 'order');
    expect(orderRefs).toEqual(
      expect.arrayContaining([ORDER_51, ORDER_52]),
    );
    expect(orderRefs.length).toBe(2);

    const poRefs = episode.affectedEntities.filter((ref) => ref.kind === 'po');
    expect(poRefs).toEqual([PO_1]);

    expect(episode.spatialContext).toEqual([
      { kind: 'location', locationCode: 'A-01-03', confidence: 'canonical' },
      { kind: 'location', locationCode: 'B-02-01', confidence: 'canonical' },
    ]);
  });

  it('collapses multiple affected orders into exactly one episode, each order present once', () => {
    const episode = projectInventoryOversellEpisode({
      episodeId: 'ep-oversell-multi-order',
      lifecycle: 'attention',
      severity: 'critical',
      primaryOrder: ORDER_51,
      variant: VARIANT_9,
      affectedOrders: [ORDER_51, ORDER_52],
      actionTarget: VARIANT_9_TARGET,
      occurredAt: '2026-09-20T10:00:00.000Z',
    });

    const orderRefs = episode.affectedEntities.filter((ref) => ref.kind === 'order');
    expect(orderRefs.length).toBe(2);
    expect(orderRefs).toEqual(expect.arrayContaining([ORDER_51, ORDER_52]));
  });
});

describe('aggregateOperationalEpisodes + resolveDominantEpisode', () => {
  const addressEpisode = projectAddressCorrectionEpisode({
    episodeId: 'ep-address-51',
    lifecycle: 'attention',
    severity: 'warning',
    order: ORDER_51,
    actionTarget: ORDER_51_TARGET,
    occurredAt: '2026-09-20T10:00:00.000Z',
  });

  const stockoutEpisode = projectInventoryOversellEpisode({
    episodeId: 'ep-oversell-51',
    lifecycle: 'attention',
    severity: 'critical',
    primaryOrder: ORDER_51,
    variant: VARIANT_9,
    actionTarget: VARIANT_9_TARGET,
    occurredAt: '2026-09-20T10:00:00.000Z',
  });

  it('retains two distinct episodes for the same order rather than manufacturing a mega-episode', () => {
    const [aggregate] = aggregateOperationalEpisodes(
      [addressEpisode, stockoutEpisode],
      () => ORDER_51.id,
    );

    expect(aggregate.episodes).toHaveLength(2);
    expect(aggregate.episodes).toEqual(
      expect.arrayContaining([addressEpisode, stockoutEpisode]),
    );
  });

  it('resolved address + active stockout: active stockout remains dominant', () => {
    const resolvedAddress: OperationalEpisodeProjection = {
      ...addressEpisode,
      lifecycle: 'just_resolved',
    };

    const dominant = resolveDominantEpisode([resolvedAddress, stockoutEpisode]);
    expect(dominant).toEqual(stockoutEpisode);
  });

  it('verifying + active blocker: active blocker remains dominant', () => {
    const verifying: OperationalEpisodeProjection = {
      ...addressEpisode,
      lifecycle: 'verifying',
    };

    const dominant = resolveDominantEpisode([verifying, stockoutEpisode]);
    expect(dominant).toEqual(stockoutEpisode);
  });

  it('blocking attention beats non-blocking attention within the same lifecycle', () => {
    const nonBlockingAttention: OperationalEpisodeProjection = {
      ...stockoutEpisode,
      episodeId: 'ep-non-blocking',
      blocking: false,
    };

    const dominant = resolveDominantEpisode([nonBlockingAttention, addressEpisode]);
    expect(dominant).toEqual(addressEpisode);
  });

  it('critical beats warning within the same precedence class', () => {
    const criticalTwin: OperationalEpisodeProjection = {
      ...addressEpisode,
      episodeId: 'ep-critical-twin',
      severity: 'critical',
    };

    const dominant = resolveDominantEpisode([addressEpisode, criticalTwin]);
    expect(dominant).toEqual(criticalTwin);
  });

  it('newer occurredAt wins when class and severity are equal', () => {
    const older: OperationalEpisodeProjection = {
      ...addressEpisode,
      episodeId: 'ep-older',
      occurredAt: '2026-09-20T09:00:00.000Z',
    };
    const newer: OperationalEpisodeProjection = {
      ...addressEpisode,
      episodeId: 'ep-newer',
      occurredAt: '2026-09-20T11:00:00.000Z',
    };

    const dominant = resolveDominantEpisode([older, newer]);
    expect(dominant).toEqual(newer);
  });

  it('exact timestamp tie: lexicographically greatest episodeId wins', () => {
    const timestamp = '2026-09-20T10:00:00.000Z';
    const episodeA: OperationalEpisodeProjection = {
      ...addressEpisode,
      episodeId: 'ep-aaa',
      occurredAt: timestamp,
    };
    const episodeB: OperationalEpisodeProjection = {
      ...addressEpisode,
      episodeId: 'ep-zzz',
      occurredAt: timestamp,
    };

    const dominant = resolveDominantEpisode([episodeA, episodeB]);
    expect(dominant.episodeId).toBe('ep-zzz');
  });

  it('A. compares real chronological instants, not lexical order, across differing UTC offsets', () => {
    // chronologicallyEarlier = 2026-09-20T09:00:00-02:00 = 2026-09-20T11:00:00.000Z
    // chronologicallyLater   = 2026-09-20T08:00:00-05:00 = 2026-09-20T13:00:00.000Z
    // As raw strings, 'T09' > 'T08', so the chronologically EARLIER episode
    // has the lexically GREATER occurredAt string — a naive string compare
    // would (wrongly) pick it as dominant.
    const chronologicallyEarlier: OperationalEpisodeProjection = {
      ...addressEpisode,
      episodeId: 'ep-chrono-earlier',
      occurredAt: '2026-09-20T09:00:00-02:00',
    };
    const chronologicallyLater: OperationalEpisodeProjection = {
      ...addressEpisode,
      episodeId: 'ep-chrono-later',
      occurredAt: '2026-09-20T08:00:00-05:00',
    };

    // Sanity: lexical string order disagrees with chronological order here.
    expect(chronologicallyLater.occurredAt < chronologicallyEarlier.occurredAt).toBe(true);

    const dominant = resolveDominantEpisode([chronologicallyEarlier, chronologicallyLater]);
    expect(dominant.episodeId).toBe('ep-chrono-later');
  });

  it('B. same instant expressed with different offsets compares equal, then episodeId tie-breaks', () => {
    const utcForm: OperationalEpisodeProjection = {
      ...addressEpisode,
      episodeId: 'ep-aaa-offset',
      occurredAt: '2026-09-20T10:00:00.000Z',
    };
    const offsetForm: OperationalEpisodeProjection = {
      ...addressEpisode,
      episodeId: 'ep-zzz-offset',
      occurredAt: '2026-09-20T12:00:00.000+02:00', // same instant as 10:00Z
    };

    const dominant = resolveDominantEpisode([utcForm, offsetForm]);
    expect(dominant.episodeId).toBe('ep-zzz-offset');
  });

  it('C. a valid timestamp outranks a malformed timestamp when all earlier precedence dimensions tie', () => {
    const malformed: OperationalEpisodeProjection = {
      ...addressEpisode,
      episodeId: 'ep-malformed',
      occurredAt: 'not-a-real-timestamp',
    };
    const valid: OperationalEpisodeProjection = {
      ...addressEpisode,
      episodeId: 'ep-valid',
      occurredAt: '2026-09-20T10:00:00.000Z',
    };

    expect(resolveDominantEpisode([malformed, valid])).toEqual(valid);
    expect(resolveDominantEpisode([valid, malformed])).toEqual(valid);
  });

  it('generic aggregation groups by a caller-supplied key without embedding surface-specific semantics', () => {
    const byOrder = aggregateOperationalEpisodes(
      [addressEpisode, stockoutEpisode],
      (episode) => episode.primaryEntity.id,
    );
    expect(byOrder).toHaveLength(1);
    expect(byOrder[0].key).toBe(ORDER_51.id);
    expect(byOrder[0].episodes).toHaveLength(2);

    const locationTagged = projectInventoryOversellEpisode({
      episodeId: 'ep-oversell-located',
      lifecycle: 'attention',
      severity: 'warning',
      primaryOrder: ORDER_52,
      variant: VARIANT_9,
      canonicalLocationCodes: ['A-01-03'],
      actionTarget: VARIANT_9_TARGET,
      occurredAt: '2026-09-20T10:00:00.000Z',
    });

    const bySpatialContextOnly = aggregateOperationalEpisodes(
      [addressEpisode, stockoutEpisode, locationTagged],
      (episode) => episode.spatialContext[0]?.locationCode ?? 'none',
    );

    const locatedGroup = bySpatialContextOnly.find((group) => group.key === 'A-01-03');
    const unlocatedGroup = bySpatialContextOnly.find((group) => group.key === 'none');

    expect(locatedGroup?.episodes).toEqual([locationTagged]);
    expect(unlocatedGroup?.episodes).toHaveLength(2);
  });
});

describe('mutation safety', () => {
  it('does not mutate frozen caller-supplied input objects/arrays during projection and aggregation', () => {
    const order = Object.freeze({ kind: 'order', id: 'order-frozen-1' } as const);
    const variant = Object.freeze({ kind: 'variant', id: 'variant-frozen-1' } as const);
    const affectedOrders = Object.freeze([
      Object.freeze({ kind: 'order', id: 'order-frozen-2' } as const),
    ]);
    const relatedPOs = Object.freeze([
      Object.freeze({ kind: 'po', id: 'po-frozen-1' } as const),
    ]);
    const canonicalLocationCodes = Object.freeze(['A-01-03', 'A-01-03']);
    const actionTarget = Object.freeze({ kind: 'entity', entity: variant } as const);

    const input = Object.freeze({
      episodeId: 'ep-frozen',
      lifecycle: 'attention' as const,
      severity: 'critical' as const,
      primaryOrder: order,
      variant,
      affectedOrders,
      relatedPurchaseOrders: relatedPOs,
      canonicalLocationCodes,
      actionTarget,
      occurredAt: '2026-09-20T10:00:00.000Z',
    });

    expect(() => projectInventoryOversellEpisode(input)).not.toThrow();

    const episode = projectInventoryOversellEpisode(input);

    // Caller-supplied structures are untouched.
    expect(order).toEqual({ kind: 'order', id: 'order-frozen-1' });
    expect(affectedOrders).toEqual([{ kind: 'order', id: 'order-frozen-2' }]);
    expect(canonicalLocationCodes).toEqual(['A-01-03', 'A-01-03']);

    const episodesArray = Object.freeze([episode]);
    expect(() =>
      aggregateOperationalEpisodes(episodesArray, (e) => e.primaryEntity.id),
    ).not.toThrow();
    expect(episodesArray).toEqual([episode]);
  });
});
