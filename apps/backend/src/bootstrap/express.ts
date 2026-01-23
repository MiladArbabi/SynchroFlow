// apps/backend/src/bootstrap/express.ts
import express, { Express } from 'express';
import cookieParser from 'cookie-parser';
import db from 'api-src/db';

// routes
import layoutRoutes from '../api/layouts/layout.routes';
import orderRoutes from '../api/orders/orders.routes';
import customerRoutes from '../api/customers/customers.routes';
import integrationRoutes from '../api/integrations/integration.routes';
import productsRoutes from '../api/products/products.routes';
import authRoutes from '../api/auth/auth.routes';
import userStateRoutes from '../api/user-state/user-state.routes';
import shopifyRoutes from '../api/shopify/shopify.routes';
import onboardingReadinessRouter from '../onboarding/readiness.router';
import { authenticateToken } from '../middleware/auth.middleware';
import { registerActivationRoutes } from '../api/activation/activation.routes';
import { registerLifecycleRoutes } from 'api-src/api/lifecycle';

// Specter routes (FT0)
import specterRouter from '../api/specter/specter.routes';
import customersFt2Routes from '../api/customers/customers.ft2.routes';

import orderNexusRoutes from '../api/order-nexus/orderNexus.routes';
import productsFt2Routes from '../api/products/products.ft2.routes';
import overviewFt2Routes from '../api/overview';
import trustFt2Routes from '../api/trust';
import financesRoutes from '../api/finances/finances.routes';

//entitlments and payment services
import { getMyEntitlements } from '../api/entitlements/entitlements.controller';
import { stripeWebhookHandler } from '../api/billing/stripe.webhook';
import { verifyStripeSignature } from 'api-src/api/billing/stripe.verify.middleware';

// Raw body capture for webhook verification
// -----------------------------------------
// Certain webhook providers (Stripe, Shopify) require HMAC verification
// over the *raw request body bytes*.
//
// This hook ensures req.rawBody is populated BEFORE JSON parsing,
// while preserving normal express.json() behavior for all routes.
//
// DO NOT remove or modify without updating webhook verification logic.

export function createApp(): Express {
  const app = express();
  app.use(
    express.json({
      verify: (req: any, _res, buf) => {
        req.rawBody = buf;
      },
    })
  );

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
  app.use('/api/v1/auth', authRoutes);
  app.use('/api/v1/user-state', userStateRoutes);
  app.use('/api/v1/shopify', shopifyRoutes);
/*   app.use('/api/v1/shopify', shopifyDevRoutes); */
  app.use('/api/v1/onboarding', onboardingReadinessRouter);
  app.use('/api/v1/modules/order-nexus', orderNexusRoutes);
  app.use('/api/v1/modules/customers', customersFt2Routes);
  app.use('/api/v1/modules/products', productsFt2Routes);
  app.use('/api/v1/modules/finances', financesRoutes);
  app.use('/api/v1/modules/overview', overviewFt2Routes);
  app.use('/api/v1/modules/trust', trustFt2Routes);
  
  registerActivationRoutes(app);
  registerLifecycleRoutes(app);

  // Mount Specter FT0 routes under /api/v1/specter
  app.use('/api/v1/specter', specterRouter);

  app.get(
    '/api/v1/entitlements/me',
    authenticateToken,
    getMyEntitlements
  );
  app.post(
    '/api/v1/billing/stripe/webhook',
    verifyStripeSignature,
    stripeWebhookHandler
  );

  // basic endpoints preserved
  app.get('/', (_req, res) => res.send('SynchroFlow API is running!'));
  app.get('/health', (_req, res) => res.status(200).send({ status: 'ok' }));

  return app;
}
