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
import financesRoutes from '../api/finances/index.js';

const router = Router();

router.use('/shops', shopRoutes);
router.use('/integrations', integrationRoutes);
router.use('/users', userRoutes);
router.use('/feedback', feedbackRoutes);
router.use('/orders', ordersRoutes);
router.use('/products', productsRoutes);
router.use('/customers', customersRoutes);
router.use('/user-state', userStateRoutes); 
router.use('/onboarding', onboardingReadinessRouter);

router.use('/v1/modules/order-nexus', orderNexusRoutes);
router.use('/v1/modules/finances', financesRoutes);
router.use('/v1/modules/overview', overviewRoutes);

// Mount under /api/v1/specter -> final path: GET /api/v1/specter/:shopId/state
router.use('/v1/specter', specterRouter);

export default router;