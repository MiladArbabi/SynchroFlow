// apps/backend/src/bootstrap/express.ts
import express, { Express } from 'express';
import cookieParser from 'cookie-parser';
import db from '../db';

// routes
import layoutRoutes from '../api/layouts/layout.routes';
import orderRoutes from '../api/orders/orders.routes';
import customerRoutes from '../api/customers/customers.routes';
import integrationRoutes from '../api/integrations/integration.routes';
import productsRoutes from '../api/products/products.routes';
import productCostsRoutes from '../api/product-costs/product-costs.routes';
import authRoutes from '../api/auth/auth.routes';
import dashboardRoutes from '../api/dashboard/dashboard.routes';
import userStateRoutes from '../api/user-state/user-state.routes';
import shopifyRoutes from '../api/shopify/shopify.routes';
/* import shopifyDevRoutes from '../api/shopify/dev.routes'; */
import onboardingReadinessRouter from '../onboarding/readiness.router';
import { getMyEntitlements } from '../api/entitlements/entitlements.controller';
import { authenticateToken } from '../middleware/auth.middleware';

import { registerActivationRoutes } from '../api/activation/activation.routes';

import { registerLifecycleRoutes } from 'api-src/api/lifecycle';

// Specter routes (FT0)
import specterRouter from '../api/specter/specter.routes';
import customersFt2Routes from '../api/customers/customers.ft2.routes';

// Order routes
import orderNexusRoutes from '../api/order-nexus/orderNexus.routes';

export function createApp(): Express {
  const app = express();
  app.use(express.json());

  // defensive: db.client may be a test mock that doesn't expose client.config.connection.
  // Prefer to pass undefined (connect-pg-simple will fallback) rather than throw when testing.
  const pgConObject = (db && (db as any).client && (db as any).client.config && (db as any).client.config.connection)
    ? (db as any).client.config.connection
    : undefined;
  
  app.use(cookieParser() as any);

  //TEMP
  app.use((req, _res, next) => {
    console.log('[ROUTE HIT]', req.method, req.path);
    next();
  });

  // Register routes
  app.use('/api/v1/layouts', layoutRoutes);
  app.use('/api/v1/orders', orderRoutes);
  app.use('/api/v1/customers', customerRoutes);
  app.use('/api/v1/integrations', integrationRoutes);
  app.use('/api/v1/products', productsRoutes);
  app.use('/api/v1/product-costs', productCostsRoutes);
  app.use('/api/v1/auth', authRoutes);
  app.use('/api/v1/dashboard', dashboardRoutes);
  app.use('/api/v1/user-state', userStateRoutes);
  app.use('/api/v1/shopify', shopifyRoutes);
/*   app.use('/api/v1/shopify', shopifyDevRoutes); */
  app.use('/api/v1/onboarding', onboardingReadinessRouter);

  // ─────────────────────────────────────────────
  // Modules (read-only truth surfaces)
  // ─────────────────────────────────────────────
  app.use('/api/v1/modules/order-nexus', orderNexusRoutes);
  app.use('/api/v1/modules/customers', customersFt2Routes);
  
  registerActivationRoutes(app);
  registerLifecycleRoutes(app);

  // Mount Specter FT0 routes under /api/v1/specter
  app.use('/api/v1/specter', specterRouter);

  app.get(
    '/api/v1/entitlements/me',
    authenticateToken,
    getMyEntitlements
  );

  // basic endpoints preserved
  app.get('/', (_req, res) => res.send('SynchroFlow API is running!'));
  app.get('/health', (_req, res) => res.status(200).send({ status: 'ok' }));

  return app;
}
