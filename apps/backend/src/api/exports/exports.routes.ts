// apps/backend/src/api/exports/exports.routes.ts
//
// EXPORT ROUTES (GH #1014 — Sprint 1)
// -------------------------------------
// All routes require authentication + minimum tier.
//
// Tier gates (per playbook §4):
//   Core+   → CSV exports (orders, returns, finances)
//   Growth+ → PDF exports (brief)
//
// Mount point: /api/v1/exports  (see routes/index.ts)

import { Router } from 'express';
import { authenticateToken } from '@lasyncro/backend-core';
import { requireTier } from '../../middleware/require-entitlement.middleware.js';
import { requireAction } from '../../middleware/require-action.middleware.js';
import {
  exportOrders,
  exportReturns,
  exportFinances,
  exportProducts,
  exportColumns,
} from './exports.controller.js';

const router = Router();

// Column metadata for the frontend column picker — same gate as the
// exports themselves; the picker itself is entitlement-gated separately
// (Growth+) inside each POST handler, not here.
router.get(
  '/columns',
  authenticateToken,
  requireTier('core'),
  requireAction('exports:read'),
  exportColumns
);

// CSV exports — Core+
router.post(
  '/orders',
  authenticateToken,
  requireTier('core'),
  requireAction('exports:read'),
  exportOrders
);

router.post(
  '/returns',
  authenticateToken,
  requireTier('core'),
  requireAction('exports:read'),
  exportReturns
);

router.post(
  '/finances',
  authenticateToken,
  requireTier('core'),
  requireAction('exports:read'),
  exportFinances
);

router.post(
  '/products',
  authenticateToken,
  requireTier('core'),
  requireAction('exports:read'),
  exportProducts
);

export default router;