// apps/frontend/src/pages/orders/ordersOperationalEpisodeProjection.ts
//
// SLICE D1 — pure Orders-surface projector.
//
// Converts D0's backend OperationalEpisodeItem[] (GET
// /api/v1/operations/episodes) into the shared cross-surface
// OperationalEpisodeProjection contract (modules/shared/src/contracts/
// operational-episode.ts), then aggregates by order using that module's own
// aggregateOperationalEpisodes() precedence. No map rendering, no routing,
// no UI concerns — this is presentation-agnostic semantic projection only.
//
// PURE: no React, no network, no clock. lifecycle and occurredAt are copied
// verbatim from the backend row on every path — this module infers neither.
//
// SEVERITY NOTE: both V1 episode families D0 exposes (customer/
// incomplete_address, inventory/oversell) are canonical BLOCKING order
// constraints — order_constraints rows that keep the order from shipping,
// not a graded risk signal. severity='critical' here is this Orders
// surface's own SEMANTIC mapping of that canonical blocking fact onto the
// shared contract's severity axis; it is NOT a renderer color choice (no
// component in this slice reads it to pick a color), and it is never
// derived from treatment string, episode age, monetary value, or any
// frontend state.
import {
  projectAddressCorrectionEpisode,
  projectInventoryOversellEpisode,
  aggregateOperationalEpisodes,
  type OperationalEpisodeProjection,
  type OperationalActionTarget,
} from '@lasyncro/shared/contracts/operational-episode';
import type { OperationalEpisodeItem } from './useOperationalEpisodes';

export interface OrdersOperationalEpisodeAggregate {
  readonly orderId: string;
  readonly episodes: readonly OperationalEpisodeProjection[];
  readonly dominant: OperationalEpisodeProjection;
}

/**
 * D2 prep: both V1 families point at the exact same order entity target so
 * a later map click can open the existing Order Entity Modal. No route or
 * workflow string is introduced here.
 */
function orderActionTarget(lasyncroOrderId: string): OperationalActionTarget {
  return { kind: 'entity', entity: { kind: 'order', id: lasyncroOrderId } };
}

/**
 * Converts one backend row into a shared episode, or null when the row
 * should be omitted (fail closed): an unsupported constraintType/blockType
 * pairing, or an inventory/oversell row with no usable targetId. Never
 * invents a variant, location, PO, or sibling order.
 */
function projectOne(item: OperationalEpisodeItem): OperationalEpisodeProjection | null {
  if (item.constraintType === 'customer' && item.blockType === 'incomplete_address') {
    return projectAddressCorrectionEpisode({
      episodeId: item.episodeId,
      lifecycle: item.lifecycle,
      severity: 'critical',
      order: { kind: 'order', id: item.lasyncroOrderId },
      actionTarget: orderActionTarget(item.lasyncroOrderId),
      occurredAt: item.occurredAt,
    });
  }

  if (item.constraintType === 'inventory' && item.blockType === 'oversell') {
    if (!item.targetId) return null; // fail closed — never infer a variant target

    return projectInventoryOversellEpisode({
      episodeId: item.episodeId,
      lifecycle: item.lifecycle,
      severity: 'critical',
      primaryOrder: { kind: 'order', id: item.lasyncroOrderId },
      variant: { kind: 'variant', id: item.targetId },
      // Deliberately no canonicalLocationCodes, PO refs, or affected
      // sibling orders — D1 supplies only what the backend row itself
      // proves for THIS order.
      actionTarget: orderActionTarget(item.lasyncroOrderId),
      occurredAt: item.occurredAt,
    });
  }

  return null; // unsupported constraintType/blockType pairing — fail closed
}

/**
 * projectOrdersOperationalEpisodes
 * ---------------------------------
 * Pure: D0 items in, aggregated shared episodes out. Grouped by
 * episode.primaryEntity.id (== lasyncroOrderId for both V1 families) via
 * the shared generic aggregateOperationalEpisodes() — this module does not
 * reimplement grouping or precedence.
 */
export function projectOrdersOperationalEpisodes(
  items: readonly OperationalEpisodeItem[]
): readonly OrdersOperationalEpisodeAggregate[] {
  const episodes: OperationalEpisodeProjection[] = [];

  for (const item of items) {
    const episode = projectOne(item);
    if (!episode) continue;

    // Construction invariant, not inference: both adapters above always
    // build primaryEntity with kind 'order'. Asserted rather than trusted
    // silently, since the shared projection type only guarantees this
    // generically, not per-caller.
    if (episode.primaryEntity.kind !== 'order') {
      throw new Error(
        `[ORDERS_OPERATIONAL_EPISODE_PRIMARY_ENTITY_INVARIANT] expected primaryEntity.kind === 'order', got '${episode.primaryEntity.kind}' for episodeId=${episode.episodeId}`
      );
    }

    episodes.push(episode);
  }

  const aggregates = aggregateOperationalEpisodes(episodes, (episode) => episode.primaryEntity.id);

  return aggregates.map((aggregate) => ({
    orderId: aggregate.key,
    episodes: aggregate.episodes,
    dominant: aggregate.dominant,
  }));
}
