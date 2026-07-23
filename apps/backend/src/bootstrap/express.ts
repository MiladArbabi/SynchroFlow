// apps/backend/src/bootstrap/express.ts
import express, { Express, Request } from 'express';
import cookieParser from 'cookie-parser';
import db from '@lasyncro/backend-core/db.js';
import path from 'path';
import fs from 'fs';

import layoutRoutes from '../api/layouts/layout.routes.js';
import orderRoutes from '../api/orders/orders.routes.js';
import customerRoutes from '../api/customers/customers.routes.js';
import integrationRoutes from '../api/integrations/integration.routes.js';
import productsRoutes from '../api/products/products.routes.js';
import authRoutes from '../api/auth/auth.routes.js';
import userStateRoutes from '../api/user-state/user-state.routes.js';
import shopifyRoutes from '../api/shopify/shopify.routes.js';
import onboardingReadinessRouter from '../onboarding/readiness.router.js';
import { authenticateToken } from '@lasyncro/backend-core/middleware/auth.middleware.js';
import { registerActivationRoutes } from '../api/activation/activation.routes.js';
import { handleShopifyInstall } from '../api/integrations/integration.controller.js';
import specterRouter from '../api/specter/specter.routes.js';
import customersFt2Routes from '../api/customers/customers.ft2.routes.js';
import orderNexusRoutes from '../api/order-nexus/orderNexus.routes.js';
import productsFt2Routes from '../api/products/products.ft2.routes.js';
import overviewFt2Routes from '../api/overview/index.js';
import trustFt2Routes from '../api/trust/index.js';
import financesRoutes from '../api/finances/finances.routes.js';
import systemRoutes from '../api/system/system.routes.js';
import alertsRoutes from '../api/alerts/alerts.routes.js';
import ahaRoutes from '../api/aha/aha.routes.js';
import returnsRoutes from '../api/returns/returns.routes.js';
import cashflowRoutes from '../api/cashflow/cashflow.routes.js';
import customersLtvRoutes from '../api/customers/customers.ltv.routes.js';
import demandRoutes from '../api/demand/demand.routes.js';
import wmsRoutes from '../api/wms/wms.routes.js';
import suppliersRoutes from '../api/suppliers/suppliers.routes.js';
import floorPlanningRoutes from '../api/floor-planning/floor-planning.routes.js';
import notificationsRoutes from '../api/notifications/notifications.routes.js';
import membersRoutes from '../api/members/members.routes.js';
import currencyRoutes from '../api/currency/currency.routes.js';
import permissionsRoutes from '../api/settings/permissions.routes.js';
import operatorsRoutes from '../api/operators/operators.routes.js';
import shopifyBillingRoutes from '../api/shopify/shopify.billing.routes.js';
import exportsRoutes from '../api/exports/exports.routes.js';

import { getMyEntitlements } from '../api/entitlements/entitlements.controller.js';
import { httpRefundBackfill } from '../api/integrations/refundBackfill.controller.js';
import { stripeWebhookHandler } from '../api/billing/stripe.webhook.js';
import { verifyStripeSignature } from '../api/billing/stripe.verify.middleware.js';
import billingRoutes from '../api/billing/billing.routes.js';
import { registerLifecycleRoutes } from '../api/lifecycle/lifecycle.routes.js';
import waitlistRoutes from '../api/waitlist/waitlist.routes.js';
import pilotRoutes from '../api/pilot/pilot.routes.js';

import sendcloudTrackingRouter from '../api/webhooks/sendcloud.tracking.router.js';
import { verifySendcloudTrackingWebhook } from '../api/webhooks/sendcloud.tracking.verify.middleware.js';
import shippoTrackingRouter from '../api/webhooks/shippo.tracking.router.js';

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

  /**
   * REQUEST LOGGER (LOG-01)
   * -----------------------
   * Gated behind LOG_LEVEL=debug to suppress noise in development.
   * Set LOG_LEVEL=debug in .env to enable per-request logging.
   * Always disabled in production.
   */
  if (process.env.LOG_LEVEL === 'debug' && process.env.NODE_ENV !== 'production') {
    app.use((req, _res, next) => {
      console.log('[ROUTE HIT]', req.method, req.path);
      next();
    });
  }

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
  app.use('/api/v1/system', systemRoutes);
  app.use('/api/v1/alerts', alertsRoutes);
  app.use('/api/v1/aha', ahaRoutes);
  app.use('/api/v1/modules/returns', returnsRoutes);
  app.use('/api/v1/modules/cashflow', cashflowRoutes);
  app.use('/api/v1/modules/customers', customersLtvRoutes);
  app.use('/api/v1/modules/demand', demandRoutes);
  app.use('/api/v1/wms', wmsRoutes);
  app.use('/api/v1/suppliers', suppliersRoutes);
  app.use('/api/v1/floor-planning', floorPlanningRoutes);
  app.use('/api/v1/notifications', notificationsRoutes);
  app.use('/api/v1/members', membersRoutes);
  app.use('/api/v1/currency', currencyRoutes);
  app.use('/api/v1/settings/permissions', permissionsRoutes);
  app.use('/api/v1/operators', operatorsRoutes);
  // Historical refund ingestion — idempotent, one-shot per shop
  app.post('/api/v1/integrations/refund-backfill', authenticateToken, httpRefundBackfill);
  app.use('/api/v1/billing', billingRoutes);
  app.use('/api/v1/shopify-billing', shopifyBillingRoutes);
  app.use('/api/v1/exports', exportsRoutes);

  app.use('/api/v1/webhooks/carriers/sendcloud/tracking', sendcloudTrackingRouter);
  app.use('/api/v1/webhooks/carriers/shippo/tracking', shippoTrackingRouter);

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
app.get('/health', (_req, res) => res.status(200).send({ status: 'ok' }));

// Public waitlist signup — no auth, called from landing page via marketing proxy
app.use('/api/v1/waitlist', waitlistRoutes);
// AUD-1023: Public pilot application signup — no auth, called from /pilot via marketing proxy
app.use('/api/v1/pilot-applications', pilotRoutes);

/**
 * FRONTEND SPA SERVING
 * --------------------
 * In production, Fly serves both the API and the React frontend from this
 * Express app. API routes must be registered before this block.
 *
 * This allows deep links such as:
 *   /login
 *   /register
 *   /overview
 *
 * to return the React index.html instead of Express 404.
 */
/**
 * ROUTE-01: SHOPIFY APP STORE INSTALL DETECTION
 * -----------------------------------------------
 * Shopify sends real install requests as GET to the exact App URL
 * configured in the Partner Dashboard (this app's is the bare root,
 * https://app.lasyncro.com) with shop, hmac, and timestamp query
 * params appended. Without this check, those requests fell straight
 * through to the SPA catch-all below, silently discarding the install
 * params — no HMAC verification, no ghost-shop creation, no
 * billing_provider stamping ever ran for a real App Store install.
 *
 * handleShopifyInstall is self-contained (own param extraction, own
 * HMAC validation, no auth middleware dependency — see its own HARD
 * RULES comment), so it's safe to call directly here rather than
 * duplicating its logic or issuing an HTTP redirect to itself.
 *
 * Checked before the SPA catch-all in every branch below so this
 * applies in production, and in dev/no-frontend-build fallbacks too —
 * install detection should never depend on which branch is active.
 */
function isShopifyInstallRequest(req: Request): boolean {
  return req.path === '/' && !!req.query.shop && !!req.query.hmac;
}

if (process.env.NODE_ENV === 'production') {
  const frontendDistPath = path.resolve(process.cwd(), 'apps/frontend/dist');
  const frontendIndexPath = path.join(frontendDistPath, 'index.html');

  if (fs.existsSync(frontendIndexPath)) {
    // ROUTE-01: must run BEFORE express.static — serve-static (which
    // express.static wraps) serves index.html for '/' by default,
    // intercepting the request before it ever reaches the app.get('*')
    // catch-all below. A real Shopify install request to bare '/' was
    // being served the SPA here, never reaching this check at all.
    app.get('/', (req, res, next) => {
      if (isShopifyInstallRequest(req)) return handleShopifyInstall(req, res);
      next();
    });

    app.use(express.static(frontendDistPath));

    app.get('*', (req, res, next) => {
      if (req.path.startsWith('/api/')) return next();
      res.sendFile(frontendIndexPath);
    });
  } else {
    console.warn('[frontend] dist/index.html not found:', frontendIndexPath);

    app.get('/', (req, res) => {
      if (isShopifyInstallRequest(req)) return handleShopifyInstall(req, res);
      res.send('SynchroFlow API is running!');
    });
  }
} else {
  app.get('/', (req, res) => {
    if (isShopifyInstallRequest(req)) return handleShopifyInstall(req, res);
    res.send('laSyncro API is running!');
  });
}

return app;
}
