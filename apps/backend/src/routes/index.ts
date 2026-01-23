// apps/backend/src/routes/index.ts
import { Router } from 'express';
// Placeholder routes - these will be implemented in future issues
import shopRoutes from './shops'; 
import integrationRoutes from './integrations';
import userRoutes from './users';

import feedbackRoutes from './feedback'; 
import ordersRoutes from '../api/orders/orders.routes'
import productsRoutes from '../api/products/products.routes'
import customersRoutes from '../api/customers/customers.routes'
import userStateRoutes from '../api/user-state/user-state.routes'
import onboardingReadinessRouter from '../onboarding/readiness.router';
import specterRouter from '../api/specter/specter.routes';
import orderNexusRoutes from '../api/order-nexus/orderNexus.routes';
import financesRoutes from 'api-src/api/finances';
import overviewRoutes from './overview';

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