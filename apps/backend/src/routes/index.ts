// apps/backend/src/routes/index.ts
import { Router } from 'express';
// Placeholder routes - these will be implemented in future issues
import shopRoutes from './shops.js'; 
import integrationRoutes from './integrations.js';
import userRoutes from './users.js';
import feedbackRoutes from './feedback.js'; 
import ordersRoutes from '../api/orders/orders.routes.js';
import productsRoutes from '../api/products/products.routes.js';
import customersRoutes from '../api/customers/customers.routes.js';
import userStateRoutes from '../api/user-state/user-state.routes.js';
import onboardingReadinessRouter from '../onboarding/readiness.router.js';
import specterRouter from '../api/specter/specter.routes.js';
import orderNexusRoutes from '../api/order-nexus/orderNexus.routes.js';
import overviewRoutes from './overview.js';
import alertsRoutes from '../api/alerts/alerts.routes.js';
import ahaRoutes from '../api/aha/aha.routes.js';
import returnsRoutes from '../api/returns/returns.routes.js';
import financesRoutes from '../api/finances/index.js';
import systemRoutes from '../api/system/system.routes.js';

const router = Router();

router.use('/shops', shopRoutes);
router.use('/integrations', integrationRoutes);
router.use('/users', userRoutes);
router.use('/feedback', feedbackRoutes);

/**
 * Orders API — versioned at /api/v1/orders
 * Must match frontend call sites: /api/v1/orders/*
 */
router.use('/v1/orders', ordersRoutes);

// Legacy product list at /api/v1/products; FT2 at /api/v1/modules/products/ft2
router.use('/v1/products', productsRoutes);
router.use('/v1/modules/products', productsRoutes);

// Legacy customer list at /api/v1/customers; FT2 at /api/v1/modules/customers/ft2
router.use('/v1/customers', customersRoutes);
router.use('/v1/modules/customers', customersRoutes);

router.use('/user-state', userStateRoutes); 
router.use('/onboarding', onboardingReadinessRouter);

router.use('/v1/modules/order-nexus', orderNexusRoutes);
router.use('/v1/modules/finances', financesRoutes);
router.use('/v1/modules/overview', overviewRoutes);
// Alerts inbox — ranked operator signals, auto-resolved per snapshot cycle
router.use('/v1/alerts', alertsRoutes);
// Aha signal — 6-priority cascade, returns personalised first insight
router.use('/v1/aha', ahaRoutes);
// Returns intelligence — refund summary + per-variant breakdown
router.use('/v1/modules/returns', returnsRoutes);

// Mount under /api/v1/specter -> final path: GET /api/v1/specter/:shopId/state
router.use('/v1/specter', specterRouter);

/**
 * System Health API
 * GET /api/v1/system/health
 */
router.use('/v1/system', systemRoutes);

export default router;