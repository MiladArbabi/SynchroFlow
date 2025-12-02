// packages/api/src/routes/index.ts
import { Router } from 'express';
// Placeholder routes - these will be implemented in future issues
import shopRoutes from './shops'; 
import integrationRoutes from './integrations';
import userRoutes from './users';
import dashboardRoutes from './dashboard';
import feedbackRoutes from './feedback'; 
import ordersRoutes from '../api/orders/orders.routes'
import productsRoutes from '../api/products/products.routes'
import customersRoutes from '../api/customers/customers.routes'
import productCostsRoutes from '../api/product-costs/product-costs.routes'
import userStateRoutes from '../api/user-state/user-state.routes'

const router = Router();

router.use('/shops', shopRoutes);
router.use('/integrations', integrationRoutes);
router.use('/users', userRoutes);
router.use('/dashboard', dashboardRoutes);
router.use('/feedback', feedbackRoutes);
router.use('/orders', ordersRoutes);
router.use('/products', productsRoutes);
router.use('/customers', customersRoutes);
router.use('/product-costs', productCostsRoutes);
router.use('/user-state', userStateRoutes); 

export default router;