import { Router } from 'express';

import orderNexusFt2Controller from './orderNexusFt2.controller.js';
import {
  orderNexusFt2TimeseriesController,
  orderNexusFt2DistributionController,
  orderNexusFt2CoverageController,
} from './orderNexusFt2Facts.controller.js';

import orderNexusRevenueController
  from './orderNexusRevenue.controller.js';

import orderNexusRevenueEpistemicController
  from './orderNexusRevenueEpistemic.controller.js';
import { authenticateToken } from '@lasyncro/backend-core/middleware/auth.middleware.js';
import { requireFt2 } from '../../middleware/require-ft2.middleware.js';
import { httpGetOrdersOperatorSummary } from './orders.operator.controller.js';
import { httpPrioritiseOrders, httpDeprioritiseOrders } from './orderNexusPrioritise.controller.js';
import { requireAction } from '../../middleware/require-action.middleware.js';

const router = Router();

/**
 * Order-Nexus FT2 Routes
 * ---------------------
 * Read-only FT2 truth surfaces.
 */

// Canonical FT2 snapshot (unchanged)
router.get(
  '/ft2',
  authenticateToken,
  requireFt2,
  orderNexusFt2Controller
);

// FT2 fact windows (read-only)
router.get(
  '/ft2/facts/timeseries',
  authenticateToken,
  requireFt2,
  orderNexusFt2TimeseriesController
);

router.get(
  '/ft2/facts/distribution',
  authenticateToken,
  requireFt2,
  orderNexusFt2DistributionController
);

router.get(
  '/ft2/facts/coverage',
  authenticateToken,
  requireFt2,
  orderNexusFt2CoverageController
);

/**
 * Phase 6 — Execution-Aware Revenue
 * --------------------------------
 * Explicit, mode-gated, non-FT2 surface.
 */
router.get(
  '/revenue',
  authenticateToken,
  requireFt2, // still requires FT2 eligibility
  orderNexusRevenueController
);

/**
 * Phase 3 — Epistemic Revenue (Additive)
 * -------------------------------------
 * Truth-preserving epistemic surface.
 */
router.get(
  '/revenue/epistemic',
  authenticateToken,
  requireFt2,
  orderNexusRevenueEpistemicController
);

/**
 * Operator Summary
 * ----------------
 * Purpose-built operator surface — no FTEP constraints.
 * Raw counts, named entities, actionable breakdown.
 * See: services/orders-operator/OrdersOperatorSummary.provider.ts
 */
router.get(
  '/operator-summary',
  authenticateToken,
  httpGetOrdersOperatorSummary
);

/**
 * Priority flagging (ON-01)
 * -------------------------
 * Sets/clears is_priority_flagged on order_fulfillment_status.
 * Owner/admin only — operators don't manage order prioritisation.
 */
router.post(
  '/prioritise',
  authenticateToken,
  requireAction('orders:prioritise'),
  httpPrioritiseOrders
);

router.post(
  '/deprioritise',
  authenticateToken,
  requireAction('orders:prioritise'),
  httpDeprioritiseOrders
);

export default router;