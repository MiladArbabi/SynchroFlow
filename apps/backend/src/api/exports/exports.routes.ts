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
  exportBrief,
} from './exports.controller.js';

const router = Router();

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

// PDF brief — Growth+
router.post(
  '/brief',
  authenticateToken,
  requireTier('growth'),
  requireAction('exports:read'),
  exportBrief
);

export default router;