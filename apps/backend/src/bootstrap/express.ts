// apps/backend/src/bootstrap/express.ts
import express, { Express } from 'express';
import cookieParser from 'cookie-parser';
import session from 'express-session';
import connectPgSimple from 'connect-pg-simple';
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
import onboardingReadinessRouter from '../onboarding/readiness.router';
import { getMyEntitlements } from '../api/entitlements/entitlements.controller';

export function createApp(): Express {
  const app = express();
  app.use(express.json());

  const PGStore = connectPgSimple(session);
  // defensive: db.client may be a test mock that doesn't expose client.config.connection.
  // Prefer to pass undefined (connect-pg-simple will fallback) rather than throw when testing.
  const pgConObject = (db && (db as any).client && (db as any).client.config && (db as any).client.config.connection)
    ? (db as any).client.config.connection
    : undefined;

  const sessionStore = new PGStore({
    conObject: pgConObject,
    tableName: 'user_sessions',
  });
  
  app.use(cookieParser() as any);
  app.use(
    session({
      store: sessionStore,
      secret: process.env.SESSION_SECRET || 'fallback-secret-please-set-in-prod',
      resave: false,
      saveUninitialized: false,
      cookie: {
        secure: process.env.NODE_ENV === 'production',
        httpOnly: true,
        maxAge: 1000 * 60 * 60 * 24 * 7,
      },
    }) as any
  );

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
  app.use('/api/v1/onboarding', onboardingReadinessRouter);

  app.get('/api/v1/entitlements/me', getMyEntitlements);

  // basic endpoints preserved
  app.get('/', (_req, res) => res.send('SynchroFlow API is running!'));
  app.get('/health', (_req, res) => res.status(200).send({ status: 'ok' }));

  return app;
}
