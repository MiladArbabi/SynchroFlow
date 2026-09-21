// modules/shared/src/contracts/operational-episode.ts
//
// ARCHITECTURAL BOUNDARY
// -----------------------------------------------------------------------
// This module is PROJECTION ONLY. It has no knowledge of, and must never
// gain knowledge of: domain truth, DB rows, network calls, React, or any
// backend service. Callers (Orders, Inventory, Overview, WMS, ...) own
// domain truth and supply already-decided facts (lifecycle, severity,
// entities, spatial evidence). This module only shapes those facts into a
// canonical cross-surface episode, and deterministically aggregates /
// ranks episodes that callers hand it.
//
// Do NOT import backend services here. Do NOT query DB/network here.
// Do NOT infer intervention outcome here — that remains
// interventionOutcome.service.ts's job, unmodified and unreferenced.
// Do NOT infer spatial context from SKU/variant/order/PO/occupancy — a
// spatialContext entry exists only when a caller passes an explicit
// canonical location code.
// -----------------------------------------------------------------------

/** Where an episode currently sits in its cross-surface lifecycle. */
export type OperationalEpisodeLifecycle =
  | 'attention'
  | 'verifying'
  | 'just_resolved';

/** How urgent an episode is, independent of lifecycle. */
export type OperationalEpisodeSeverity = 'warning' | 'critical';

/** Which product/business domain an episode's problem belongs to. */
export type OperationalEpisodeDomain = 'customer' | 'inventory' | 'operational';

/** Canonical entity kinds an episode may reference. */
export type OperationalEntityKind = 'order' | 'variant' | 'location' | 'po';

/**
 * A reference to one canonical entity, caller-supplied. Generic over the
 * entity kind so adapter inputs can require the exact kind they need
 * (e.g. `OperationalEntityRef<'order'>`) instead of accepting any kind.
 */
export interface OperationalEntityRef<
  K extends OperationalEntityKind = OperationalEntityKind,
> {
  readonly kind: K;
  readonly id: string;
}

/**
 * Spatial evidence for an episode. Only ever constructed from a location
 * code the caller explicitly supplied as canonical physical evidence —
 * never derived/inferred by this module.
 */
export interface OperationalSpatialContext {
  readonly kind: 'location';
  readonly locationCode: string;
  readonly confidence: 'canonical';
}

/**
 * Projection-safe navigation/action payload. This module never derives a
 * route or target from problem/treatment type — the caller supplies the
 * exact entity/navigation/workflow target it wants surfaced, verbatim.
 */
export type OperationalActionTarget =
  | {
      readonly kind: 'entity';
      readonly entity: OperationalEntityRef;
    }
  | {
      readonly kind: 'navigate';
      readonly route: string;
    }
  | {
      readonly kind: 'workflow';
      readonly workflow: string;
      readonly entity?: OperationalEntityRef;
    };

/** The canonical cross-surface operational episode shape. */
export interface OperationalEpisodeProjection {
  readonly episodeId: string;
  readonly lifecycle: OperationalEpisodeLifecycle;
  readonly severity: OperationalEpisodeSeverity;
  readonly problem: {
    readonly domain: OperationalEpisodeDomain;
    readonly type: string;
  };
  readonly blocking: boolean;
  readonly primaryEntity: OperationalEntityRef;
  readonly affectedEntities: readonly OperationalEntityRef[];
  readonly spatialContext: readonly OperationalSpatialContext[];
  readonly actionTarget: OperationalActionTarget;
  readonly occurredAt: string;
}

function dedupeEntityRefs(
  refs: readonly OperationalEntityRef[],
): readonly OperationalEntityRef[] {
  const seen = new Set<string>();
  const result: OperationalEntityRef[] = [];
  for (const ref of refs) {
    const key = `${ref.kind}:${ref.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push({ kind: ref.kind, id: ref.id });
  }
  return result;
}

function dedupeLocationCodes(
  codes: readonly string[],
): readonly OperationalSpatialContext[] {
  const seen = new Set<string>();
  const result: OperationalSpatialContext[] = [];
  for (const code of codes) {
    if (seen.has(code)) continue;
    seen.add(code);
    result.push({ kind: 'location', locationCode: code, confidence: 'canonical' });
  }
  return result;
}

/** Caller-supplied facts for adapter 1 — address correction. */
export interface AddressCorrectionEpisodeInput {
  readonly episodeId: string;
  readonly lifecycle: OperationalEpisodeLifecycle;
  readonly severity: OperationalEpisodeSeverity;
  readonly order: OperationalEntityRef<'order'>;
  readonly actionTarget: OperationalActionTarget;
  readonly occurredAt: string;
}

/**
 * V1 ADAPTER 1 — Address correction.
 * Always customer/incomplete_address, always blocking, always zero
 * spatial context. Never infers a warehouse/bin/location.
 */
export function projectAddressCorrectionEpisode(
  input: AddressCorrectionEpisodeInput,
): OperationalEpisodeProjection {
  const order: OperationalEntityRef = { kind: input.order.kind, id: input.order.id };
  return {
    episodeId: input.episodeId,
    lifecycle: input.lifecycle,
    severity: input.severity,
    problem: { domain: 'customer', type: 'incomplete_address' },
    blocking: true,
    primaryEntity: order,
    affectedEntities: [order],
    spatialContext: [],
    actionTarget: input.actionTarget,
    occurredAt: input.occurredAt,
  };
}

/** Caller-supplied facts for adapter 2 — inventory oversell. */
export interface InventoryOversellEpisodeInput {
  readonly episodeId: string;
  readonly lifecycle: OperationalEpisodeLifecycle;
  readonly severity: OperationalEpisodeSeverity;
  readonly primaryOrder: OperationalEntityRef<'order'>;
  readonly variant: OperationalEntityRef<'variant'>;
  readonly affectedOrders?: readonly OperationalEntityRef<'order'>[];
  readonly relatedPurchaseOrders?: readonly OperationalEntityRef<'po'>[];
  /** Canonical location codes explicitly supplied by the caller. Never inferred. */
  readonly canonicalLocationCodes?: readonly string[];
  readonly actionTarget: OperationalActionTarget;
  readonly occurredAt: string;
}

/**
 * V1 ADAPTER 2 — Inventory oversell.
 * Always inventory/oversell, always blocking, exactly one episode
 * regardless of how many affected orders/POs are supplied. Spatial
 * context is produced ONLY from explicitly supplied canonical location
 * codes — never derived from variant/order/PO/occupancy.
 */
export function projectInventoryOversellEpisode(
  input: InventoryOversellEpisodeInput,
): OperationalEpisodeProjection {
  const primaryOrder: OperationalEntityRef = {
    kind: input.primaryOrder.kind,
    id: input.primaryOrder.id,
  };
  const variant: OperationalEntityRef = { kind: input.variant.kind, id: input.variant.id };

  const affectedOrders = input.affectedOrders ?? [];
  const relatedPOs = input.relatedPurchaseOrders ?? [];

  const affectedEntities = dedupeEntityRefs([
    primaryOrder,
    variant,
    ...affectedOrders,
    ...relatedPOs,
  ]);

  const spatialContext = dedupeLocationCodes(input.canonicalLocationCodes ?? []);

  return {
    episodeId: input.episodeId,
    lifecycle: input.lifecycle,
    severity: input.severity,
    problem: { domain: 'inventory', type: 'oversell' },
    blocking: true,
    primaryEntity: primaryOrder,
    affectedEntities,
    spatialContext,
    actionTarget: input.actionTarget,
    occurredAt: input.occurredAt,
  };
}

/**
 * One aggregate: all constituent episodes for a caller-supplied key,
 * plus the dominant one selected by precedence. Constituents are never
 * merged into a synthetic episode.
 */
export interface OperationalEpisodeAggregate<K> {
  readonly key: K;
  readonly episodes: readonly OperationalEpisodeProjection[];
  readonly dominant: OperationalEpisodeProjection;
}

/**
 * Generic aggregation grouped by a CALLER-SUPPLIED key. Shared code must
 * not hard-code any one surface's grouping semantics (order vs.
 * variant/location vs. spatial-context-only) — that decision belongs to
 * each caller's keySelector.
 */
export function aggregateOperationalEpisodes<K>(
  episodes: readonly OperationalEpisodeProjection[],
  keySelector: (episode: OperationalEpisodeProjection) => K,
): readonly OperationalEpisodeAggregate<K>[] {
  const order: K[] = [];
  const groups = new Map<K, OperationalEpisodeProjection[]>();

  for (const episode of episodes) {
    const key = keySelector(episode);
    const existing = groups.get(key);
    if (existing) {
      existing.push(episode);
    } else {
      groups.set(key, [episode]);
      order.push(key);
    }
  }

  return order.map((key) => {
    const groupEpisodes = groups.get(key) as OperationalEpisodeProjection[];
    return {
      key,
      episodes: groupEpisodes.slice(),
      dominant: resolveDominantEpisode(groupEpisodes),
    };
  });
}

const LIFECYCLE_BLOCKING_RANK: Record<string, number> = {
  'attention:true': 0,
  'attention:false': 1,
  'verifying:true': 2,
  'verifying:false': 2,
  'just_resolved:true': 3,
  'just_resolved:false': 3,
};

function precedenceRank(episode: OperationalEpisodeProjection): number {
  return LIFECYCLE_BLOCKING_RANK[`${episode.lifecycle}:${episode.blocking}`];
}

const SEVERITY_RANK: Record<OperationalEpisodeSeverity, number> = {
  critical: 0,
  warning: 1,
};

/**
 * Deterministic precedence resolver.
 *
 * Highest wins:
 *   1. attention + blocking
 *   2. attention + non-blocking
 *   3. verifying
 *   4. just_resolved
 *
 * Within the same class: critical > warning; newer occurredAt (compared as
 * an actual ISO-8601 instant, not lexically) > older; equal instants (or
 * two equally malformed timestamps) fall through to episodeId tie-break.
 *
 * This is intentionally NOT "normal live work" resolution — existing map
 * operational-state logic stays separate and will consume this
 * projection's output in a later slice.
 */
export function resolveDominantEpisode(
  episodes: readonly OperationalEpisodeProjection[],
): OperationalEpisodeProjection {
  if (episodes.length === 0) {
    throw new Error('resolveDominantEpisode requires at least one episode');
  }

  let dominant = episodes[0];
  for (let i = 1; i < episodes.length; i += 1) {
    const candidate = episodes[i];
    if (compareEpisodePrecedence(candidate, dominant) > 0) {
      dominant = candidate;
    }
  }
  return dominant;
}

/**
 * Parses an ISO-8601 timestamp to epoch milliseconds. Pure string parsing
 * only — Date.parse never reads the current clock. Returns null when the
 * string is not a parseable instant.
 */
function parseEpochMillis(occurredAt: string): number | null {
  const parsed = Date.parse(occurredAt);
  return Number.isNaN(parsed) ? null : parsed;
}

/**
 * Compares two occurredAt values as actual instants rather than strings,
 * so differing UTC offsets that denote the same or an out-of-lexical-order
 * moment still compare correctly.
 *
 *   valid vs valid     -> compare epoch milliseconds
 *   valid vs invalid   -> the valid timestamp wins (a malformed timestamp
 *                          must never silently outrank a canonical one)
 *   invalid vs invalid -> deterministic lexical fallback on the raw string
 *   equal instant       -> 0 (falls through to episodeId tie-break)
 */
function compareOccurredAt(
  a: OperationalEpisodeProjection,
  b: OperationalEpisodeProjection,
): number {
  const epochA = parseEpochMillis(a.occurredAt);
  const epochB = parseEpochMillis(b.occurredAt);

  if (epochA !== null && epochB !== null) {
    if (epochA !== epochB) return epochA > epochB ? 1 : -1;
    return 0;
  }
  if (epochA !== null) return 1;
  if (epochB !== null) return -1;

  if (a.occurredAt !== b.occurredAt) {
    return a.occurredAt > b.occurredAt ? 1 : -1;
  }
  return 0;
}

function compareEpisodePrecedence(
  a: OperationalEpisodeProjection,
  b: OperationalEpisodeProjection,
): number {
  const rankA = precedenceRank(a);
  const rankB = precedenceRank(b);
  if (rankA !== rankB) return rankB - rankA;

  const severityA = SEVERITY_RANK[a.severity];
  const severityB = SEVERITY_RANK[b.severity];
  if (severityA !== severityB) return severityB - severityA;

  const occurredAtCompare = compareOccurredAt(a, b);
  if (occurredAtCompare !== 0) return occurredAtCompare;

  if (a.episodeId !== b.episodeId) {
    return a.episodeId > b.episodeId ? 1 : -1;
  }

  return 0;
}
