// apps/frontend/src/pages/orders/ordersOperationalEpisodeVisual.ts
//
// SLICE D2A — Orders-owned pure VISUAL projection.
// SLICE D3A — added the just_resolved -> healthy/'✓' mapping (see
// resolveVisual() below). The production endpoint does not emit
// just_resolved yet (see useOperationalEpisodes.ts's D3A note), so this
// branch only activates once an internal caller opts into D0's
// justResolved policy — D2A's attention/verifying behavior is unchanged.
//
// D1 (ordersOperationalEpisodeProjection.ts) already answers "what episodes
// exist for this order, and which one dominates?" — canonical semantic
// truth, composed from D0's backend read seam. This module answers a
// strictly narrower question: "given that dominant episode's canonical
// lifecycle, what visual state/glyph should the Orders surface use?" It is
// a pure translation layer, not a second semantic derivation.
//
// NOT a physical-location projection. This module produces NOTHING about
// where an order sits physically — no operationalStateByLocation, no
// location codes, bins, stations, occupancy, or coordinates. That is out of
// scope for D2A entirely (would be a later, separate slice if ever needed).
//
// Pure: no React, no network, no clock, no rendering. This slice does not
// render anything — it only locks the canonical-lifecycle -> Orders-visual
// mapping for D2B to consume later.
import type { OperationalMapState } from '@lasyncro/shared/ui';
import type {
  OperationalEpisodeLifecycle,
  OperationalEpisodeProjection,
} from '@lasyncro/shared/contracts/operational-episode';
import type { OrdersOperationalEpisodeAggregate } from './ordersOperationalEpisodeProjection';

export type OrdersOperationalGlyph = '!' | '◌' | '✓';

export interface OrdersOperationalVisual {
  readonly orderId: string;
  readonly state: OperationalMapState;
  readonly glyph: OrdersOperationalGlyph;
  readonly episodeCount: number;
  readonly dominant: OperationalEpisodeProjection;
  readonly episodes: readonly OperationalEpisodeProjection[];
}

/**
 * LOCKED V1 MAPPING — canonical dominant.lifecycle -> Orders visual state.
 *
 *   attention      -> critical, '!'  — unresolved blocking problem needing action.
 *   verifying      -> active,   '◌'  — action already happened; canonical
 *                                      completion is pending and must remain
 *                                      visibly active but quieter than attention.
 *   just_resolved  -> healthy,  '✓'  — canonical resolution truth (D3A:
 *                                      order_constraints.resolved_at, via an
 *                                      opt-in caller policy the production
 *                                      endpoint does not yet supply).
 *
 * Deliberately NOT keyed on problem.domain, treatment, age, occurredAt,
 * money, or any frontend loading state — those never decide visual state
 * here. D1 already supplies severity='critical' for both V1 blocking
 * families; this module does not run a second severity algorithm. No
 * spatial field or map attribution is read or produced here.
 *
 * The switch is exhaustive over the FULL shared OperationalEpisodeLifecycle
 * union. Any lifecycle value this function cannot recognize falls through
 * the `default` branch and throws rather than silently reading as
 * neutral/healthy — an unknown lifecycle must never look like a healthy
 * order.
 */
function resolveVisual(lifecycle: OperationalEpisodeLifecycle): {
  state: OperationalMapState;
  glyph: OrdersOperationalGlyph;
} {
  switch (lifecycle) {
    case 'attention':
      return { state: 'critical', glyph: '!' };
    case 'verifying':
      return { state: 'active', glyph: '◌' };
    case 'just_resolved':
      return { state: 'healthy', glyph: '✓' };
    default: {
      // Fail closed: an unrecognized lifecycle must never read as healthy/normal.
      const exhaustiveCheck: never = lifecycle;
      throw new Error(
        `[ORDERS_OPERATIONAL_VISUAL_UNKNOWN_LIFECYCLE] unsupported lifecycle: ${String(exhaustiveCheck)}`
      );
    }
  }
}

/**
 * projectOrdersOperationalVisuals
 * ---------------------------------
 * D1 aggregates in, D2A visuals out — one per aggregate, in the SAME order
 * D1 produced them (no resort by severity/time in this layer). Identity
 * (orderId), every constituent episode, the dominant episode, and its
 * actionTarget are preserved exactly as D1 supplied them — no new route is
 * derived here.
 */
export function projectOrdersOperationalVisuals(
  aggregates: readonly OrdersOperationalEpisodeAggregate[]
): readonly OrdersOperationalVisual[] {
  return aggregates.map((aggregate) => {
    const { state, glyph } = resolveVisual(aggregate.dominant.lifecycle);

    return {
      orderId: aggregate.orderId,
      state,
      glyph,
      episodeCount: aggregate.episodes.length,
      dominant: aggregate.dominant,
      episodes: aggregate.episodes,
    };
  });
}
