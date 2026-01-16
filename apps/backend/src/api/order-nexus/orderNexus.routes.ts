import { Router } from 'express';
import { authenticateToken } from 'api-src/middleware/auth.middleware';
import { requireFt2 } from 'api-src/middleware/require-ft2.middleware';

import orderNexusFt2Controller from './orderNexusFt2.controller';
import {
  orderNexusFt2TimeseriesController,
  orderNexusFt2DistributionController,
  orderNexusFt2CoverageController,
} from './orderNexusFt2Facts.controller';

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

export default router;