// apps/backend/src/api/exports/exports.routes.ts
//
// EXPORT ROUTES (GH #1014 — Sprint 1; COMMERCIAL-ACCESS-ARCH-01 P0-A3-1)
// -------------------------------------------------------------------
// All routes require authentication + the canonical exports.core capability.
//
// Canonical gate: requireCapability('exports.core') — @lasyncro/commercial-policy
// currently resolves this to Core+ (see packages/commercial-policy/src/capabilities.ts).
// Advanced/custom column selection (filters.columns) is a SEPARATE, narrower
// capability (exports.column_selection, currently Growth+) enforced inside
// each handler via enforceCapability() — see exports.controller.ts.
//
// Mount point: /api/v1/exports  (see routes/index.ts)

import { Router } from 'express';
import { authenticateToken } from '@lasyncro/backend-core';
import { requireCapability } from '../../middleware/require-entitlement.middleware.js';
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
  requireCapability('exports.core'),
  requireAction('exports:read'),
  exportColumns
);

// CSV exports — Core+
router.post(
  '/orders',
  authenticateToken,
  requireCapability('exports.core'),
  requireAction('exports:read'),
  exportOrders
);

router.post(
  '/returns',
  authenticateToken,
  requireCapability('exports.core'),
  requireAction('exports:read'),
  exportReturns
);

router.post(
  '/finances',
  authenticateToken,
  requireCapability('exports.core'),
  requireAction('exports:read'),
  exportFinances
);

router.post(
  '/products',
  authenticateToken,
  requireCapability('exports.core'),
  requireAction('exports:read'),
  exportProducts
);

export default router;