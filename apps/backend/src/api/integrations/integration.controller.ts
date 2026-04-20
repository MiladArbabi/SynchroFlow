/**
 * OAuth Migration Note (Dec 2025)
 * -------------------------------
 * This controller is being migrated from session-based OAuth
 * to stateless, DB-backed OAuth using `integration_oauth_states`.
 *
 * Current status:
 * - initiateOAuth: ✅ stateless + DB-backed
 * - handleOAuthCallback: ⏳ pending DB-backed validation
 *
 * DO NOT reintroduce sessions.
 * All OAuth state must be resolved via database lookups.
 */

// apps/backend/src/api/integrations/integration.controller.ts
import { Request, Response } from 'express';
import crypto from 'crypto';
import { encrypt } from '../../security/encryption.service.js';

import db from '@lasyncro/backend-core/db.js';
import axios from 'axios';
import { issueAuthTokens } from '../../api/auth/token.service.js';
import { requireAuthStrict } from '@lasyncro/backend-core/middleware/requireAuthStrict.js';

import { EntitlementsService } from '@lasyncro/backend-core/services/entitlements.service.js';
import { requireShopContextForUser } from '@lasyncro/backend-core/services/shop-resolution.service.js';
import { ShopifyAppService } from '@lasyncro/backend-core/services/shopify-app.service.js';
import { audit } from '../../utils/audit.js';
import { rateLimit } from '../../utils/rateLimit.js';
import { getQueueChannel, connection } from '../../queue.js';

// CENTRALIZED ENCRYPTION
// NOTE: Delegates to encryption.service (single source of truth)
const encryptToken = (token: string): string => {
  return encrypt(token);
};

/**
 * Normalizes shop domain to the correct format for Shopify OAuth
 */
export const normalizeShopDomain = (shopInput: string): string => {
  let shop = shopInput.trim();
  
  // Remove protocol if present
  shop = shop.replace(/^https?:\/\//, '');
  
  // Remove path if present (like /admin)
  shop = shop.replace(/\/.*$/, '');
  
  // Ensure it has .myshopify.com suffix
  if (!shop.includes('.myshopify.com')) {
    shop = `${shop}.myshopify.com`;
  }
  
  return shop;
};

export const initiateOAuth = async (req: Request, res: Response) => {
  const { platform, shop } = req.query as { platform?: string; shop?: string };
  let userId: number;

  try {
    ({ userId } = requireAuthStrict(req));
  } catch {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  if (!platform) {
    return res.status(400).json({ error: 'Missing required query param: platform' });
  }

  if (platform === 'shopify' && !shop) {
    return res.status(400).json({ error: 'Missing required query param: shop' });
  }

    // --- Generate CSRF state ---
  const state = crypto.randomBytes(16).toString('hex');

  // --- Normalize shop domain (Shopify only) ---
  const shopDomain = platform === 'shopify'
    ? normalizeShopDomain(shop!)
    : null;

  // --- Hard expiry (10 minutes) ---
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000);

  // --- Opportunistic cleanup of expired OAuth states (defensive) ---
  await db('integration_oauth_states')
    .where('expires_at', '<', new Date())
    .andWhere({ user_id: userId, platform })
    .delete();

  // --- Persist OAuth intent (stateless) ---
  await db('integration_oauth_states').insert({
    user_id: userId,
    platform,
    state,
    shop_domain: shopDomain,
    expires_at: expiresAt,
  });

  const redirectUri = `${process.env.API_URL}/api/v1/integrations/oauth/callback/${platform}`;

  let authorizationUrl = '';

  if (platform === 'shopify') {
    const shopifyApiKey = process.env.SHOPIFY_API_KEY;
    if (!shopifyApiKey) {
      return res.status(500).json({ error: 'Shopify API key missing' });
    }

    const scopes = [
      'read_products',
      'read_orders',
      'read_refunds',
      'read_customers',
      'read_inventory',
      'read_payouts',
      'read_fulfillments',
      'write_fulfillments',
      'read_merchant_managed_fulfillment_orders',
      'write_merchant_managed_fulfillment_orders',
      'read_script_tags',
    ].join(',');

    authorizationUrl =
      `https://${shopDomain}/admin/oauth/authorize` +
      `?client_id=${shopifyApiKey}` +
      `&scope=${encodeURIComponent(scopes)}` +
      `&redirect_uri=${encodeURIComponent(redirectUri)}` +
      `&state=${state}`;
  } else {
    return res.status(400).json({ error: 'Unsupported platform' });
  }

  return res.status(200).json({ authorizationUrl });
};

// --- NEW HELPER FUNCTION (from our plan) ---
/**
 * Maps technical Shopify error codes to user-friendly messages.
 */
export const getHumanReadableError = (shopifyError: string, description: string): string => {
  const errorMap: Record<string, string> = {
    'access_denied': 'Authorization was canceled. Please try again and approve the installation.',
    'invalid_scope': 'The app requires additional permissions. Please contact support.',
    'shopify_plan_required': 'Your Shopify store needs an active paid plan to install this app.',
    'trial_store': 'This app cannot be installed on trial stores. Please upgrade your Shopify plan.',
    'suspended_store': 'Your Shopify store is currently suspended. Please resolve any billing issues.',
    'app_installation_failed': 'App installation failed. Please try again or contact Shopify support.',
    'invalid_request': 'The installation request was invalid. Please try again.',
    'unsupported_grant_type': 'Authentication configuration error. Please contact support.',
    'unauthorized_client': 'This app is not authorized to connect. Please contact support.',
    'invalid_shop': 'The store URL appears to be invalid. Please check and try again.',
    'shop_not_found': 'The store was not found. Please check the store name and try again.',
    'feature_disabled': 'This feature is not available for your store. Please contact Shopify support.',
  };
  
  return errorMap[shopifyError] || description || 'An unknown error occurred during installation.';
};

export const handleOAuthCallback = async (req: Request, res: Response) => {
  const { platform } = req.params as { platform: string };

 const ip =
   req.headers['x-forwarded-for']?.toString() ||
   req.socket.remoteAddress ||
   'unknown';

 const allowed = rateLimit(
   `oauth:${platform}:${ip}`,
    20,              // generous
    60_000
 );

 if (!allowed) {
   return res.status(429).json({
     error: 'OAUTH_RATE_LIMITED',
   });
 }

  const { code, state, shop, error, error_description } = req.query as {
    code: string;
    state: string;
    shop: string;
    error?: string;
    error_description?: string;
  };

  console.log('🔵 Starting OAuth callback for platform:', platform);

  // --- 1. Handle OAuth Failure (Sad Path) ---
  if (error) {
    console.log('❌ OAuth error detected:', error);
    const userFriendlyError = getHumanReadableError(error, error_description || '');
    const redirectUrl = new URL(`${process.env.FRONTEND_URL}/`);
    redirectUrl.searchParams.append('connect', 'error');
    redirectUrl.searchParams.append('message', userFriendlyError);
    return res.redirect(redirectUrl.toString());
  }

  // --- STEP 2.2.1: DB-backed OAuth state validation (NO token exchange yet) ---
  let oauthContext: {
    userId: number;
    shopDomain: string | null;
  };

  try {
    oauthContext = await db.transaction(async trx => {
      const row = await trx('integration_oauth_states')
        .where({
          platform,
          state,
        })
        .forUpdate()
        .first();

      if (!row) {
        console.warn('[OAuth] Invalid or replayed state', {
          platform,
          stateHash: crypto.createHash('sha256').update(state).digest('hex'),
        });
        throw new Error('OAUTH_STATE_NOT_FOUND');
      }

      if (row.expires_at < new Date()) {
        console.warn('[OAuth] Expired OAuth state', {
          platform,
          stateHash: crypto.createHash('sha256').update(state).digest('hex'),
          expiresAt: row.expires_at,
        });

        await trx('integration_oauth_states')
          .where({ id: row.id })
          .delete();

        throw new Error('OAUTH_STATE_EXPIRED');
      }

      // Burn the state immediately (replay protection)
      await trx('integration_oauth_states')
        .where({ id: row.id })
        .delete();

      return {
        userId: row.user_id,
        shopDomain: row.shop_domain,
      };
    });
  } catch (err: any) {
    const reason =
      err.message === 'OAUTH_STATE_NOT_FOUND'
        ? 'Invalid or reused OAuth state'
        : err.message === 'OAUTH_STATE_EXPIRED'
        ? 'Expired OAuth state'
        : 'OAuth state validation failed';

    audit({
      level: 'SECURITY',
      event: 'oauth_state_rejected',
      metadata: { platform, reason },
    });

    return res.status(403).json({ error: reason });
  }

    console.info('[OAuth] State validated — starting token exchange', {
    platform,
    userId: oauthContext.userId,
    shopDomain: oauthContext.shopDomain,
  });

  if (!code) {
    return res.status(400).json({ error: 'Missing OAuth authorization code' });
  }

  let shopifyAccessToken: string;
  let shopBaseCurrency = 'USD'; // set from Shopify shop.json at OAuth time, fallback to USD

  // --- Step 2.2.2.a: Token exchange (OUTSIDE DB transaction) ---
  try {
    if (platform === 'shopify') {
      const tokenUrl = `https://${oauthContext.shopDomain}/admin/oauth/access_token`;

      const tokenResponse = await axios.post(tokenUrl, {
        client_id: process.env.SHOPIFY_API_KEY,
        client_secret: process.env.SHOPIFY_API_SECRET,
        code,
      });

      shopifyAccessToken = tokenResponse.data?.access_token;

      // Fetch store currency from Shopify Admin API
      // Used to set shops.base_currency — conversion is display-only, never stored
      try {
        const shopInfoRes = await axios.get(
          `https://${oauthContext.shopDomain}/admin/api/2024-01/shop.json`,
          { headers: { 'X-Shopify-Access-Token': shopifyAccessToken } }
        );
        shopBaseCurrency = shopInfoRes.data?.shop?.currency ?? 'USD';
      } catch (err) {
        console.warn('[OAuth] Failed to fetch shop currency — defaulting to USD', err);
      }
    } else {
      return res.status(400).json({ error: 'Unsupported platform' });
    }

    if (!shopifyAccessToken) {
      throw new Error('ACCESS_TOKEN_MISSING');
    }
  } catch (err) {
    console.error('[OAuth] Token exchange failed', err);
    return res.status(502).json({ error: 'Failed to exchange OAuth token' });
  }

  // --- Step 2.2.2.b: Persist integration atomically ---
  try {
    const result = await db.transaction(async trx => {
      const { shopId } = await requireShopContextForUser(oauthContext.userId);

      // Persist shop base currency captured from Shopify at OAuth time
      await trx('shops')
        .where({ id: shopId })
        .update({ base_currency: shopBaseCurrency });

      const encryptedToken = encryptToken(shopifyAccessToken);

      const [integration] = await trx('integrations')
        .insert({
          shop_id: shopId,
          platform,
          platform_shop_name: oauthContext.shopDomain,
          access_token_encrypted: encryptedToken,
          updated_at: new Date(),
        })
        .onConflict(['shop_id', 'platform'])
        .merge({
          access_token_encrypted: encryptedToken,
          updated_at: new Date(),
        })
        .returning('*');

        // 🔐 SINGLE SOURCE OF TRUTH FOR SHOPIFY TOKEN
       await trx('shopify_app_installations')
        .insert({
          shop_id: shopId,
          shop_domain: oauthContext.shopDomain,
          access_token: encryptedToken,
          scopes: 
          'read_products,read_orders,read_returns,read_customers,read_inventory,read_fulfillments,write_fulfillments,read_merchant_managed_fulfillment_orders,write_merchant_managed_fulfillment_orders,write_script_tags',
          installed_at: new Date(),
        })
         .onConflict(['shop_domain'])
         .merge({
           access_token: encryptedToken,
           updated_at: new Date(),
        });

      return {
        integration,
        shopId,
      };
    });

    // --- Post-commit side effects ---
    await EntitlementsService.grantDefaultFreeTierForShop(result.shopId);

    /**
     * SYNC JOB ENQUEUE (REQUIRED)
     * ----------------------------
     * integration/sync_requested emits durability fact.
     * Sync worker still requires explicit queue job.
     *
     * Removing this breaks ingestion + lifecycle chain.
     */
    const syncChannel = getQueueChannel('sync_jobs');

    syncChannel.sendToQueue(
      'sync_jobs',
      Buffer.from(
        JSON.stringify({
          integrationId: result.integration.id,
        })
      ),
      { persistent: true }
    );

    console.info('[SYNC_JOB_ENQUEUED]', {
      integrationId: result.integration.id,
      shopId: result.shopId,
    });

    /**
     * DOMAIN EVENT EMISSION — SYNC REQUESTED
     * --------------------------------------
     * No direct queue publishing allowed.
     * Sync must originate from immutable domain event.
     * Projection or downstream worker is responsible for execution.
     */
    await db.transaction(async trx => {
      const externalEventId = `internal:integration/sync_requested:${result.integration.id}:${Date.now()}`;
      const traceId = `sync:${result.integration.id}:${Date.now()}`;

      const [event] = await trx('domain_events')
        .insert({
          shop_id: result.shopId,
          event_type: 'integration/sync_requested',
          event_payload: {
            integration_id: result.integration.id,
            trace_id: traceId,
          },
          event_time: trx.fn.now(),
          event_version: 1,
          external_event_id: externalEventId,
        })
        .returning(['id']);

      /**
       * OUTBOX OWNERSHIP (DB-ENFORCED)
       * --------------------------------
       * domain_event_outbox row is created automatically
       * via AFTER INSERT trigger on domain_events.
       *
       * Manual inserts are forbidden.
       * Guarantees exactly one outbox row per event.
       */
    });

    // 🔒 Security invariants
    if (!oauthContext.userId) {
      throw new Error('OAUTH_INVARIANT_VIOLATION: missing userId');
    }

    if (platform === 'shopify' && !oauthContext.shopDomain) {
      throw new Error('OAUTH_INVARIANT_VIOLATION: missing shop domain');
    }

    // 🔐 Issue fresh auth tokens (OAuth = login)
    let authTokens: { accessToken: any; refreshToken: any };

    try {
      authTokens = await issueAuthTokens({
      userId: oauthContext.userId,
      shopId: result.shopId,
      actorType: 'shop_user',
      authProvider: 'shopify',
      shopRoles: [],
      scopes: [],
      tokenVersion: 1,
    });
      } catch (err) {
        console.error('[OAuth] Token issuance invariant failed', err);
        throw new Error('OAUTH_FATAL: auth token issuance failed');
      }
  
    const { accessToken: userJwt, refreshToken } = authTokens;

    await ShopifyAppService.completePostInstallation(
      oauthContext.shopDomain!,
      result.shopId
    );

    console.info('[OAuth] Integration created successfully', {
      integrationId: result.integration.id,
      shopId: result.shopId,
    });

    audit({
      level: 'INFO',
      event: 'oauth_completed',
      userId: oauthContext.userId,
      shopId: result.shopId,
      metadata: {
        platform,
        integrationId: result.integration.id,
      },
    });

    // Set rotated refresh token cookie
    res.cookie('refreshToken', refreshToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: 7 * 24 * 60 * 60 * 1000,
    });

    return res.redirect(
       `${process.env.FRONTEND_URL}/?connect=success&token=${userJwt}`
    );
  } catch (err) {
    console.error('[OAuth] Integration persistence failed', err);
    return res.status(500).json({ error: 'Failed to finalize integration' });
  }
}

/**
 * Endpoint for the "Pizza Tracker"
 * Fetches the current sync status for the user's Shopify integration.
 */
export const getSyncStatus = async (req: Request, res: Response) => {
  try {
    const { userId } = requireAuthStrict(req);

    let shopId: number;
    try {
      ({ shopId } = await requireShopContextForUser(userId));
    } catch {
      return res.status(200).json({
        status: 'NOT_FOUND',
        progress: { current: 0, total: 0, percentage: 0 },
        lastError: null,
      });
    }

    // Find the primary Shopify integration for this shop
    // In the future, we might support multiple, but for MVP, we take the first.
    const integration = await db('integrations')
      .where({ shop_id: shopId, platform: 'shopify' })
      .first(
        'sync_status',
        'sync_progress_current',
        'sync_progress_total',
        'sync_last_error'
      );

    if (!integration) {
      // This user has no integration, which is fine, but not what this endpoint is for.
      return res.status(200).json({
        "status": "NOT_FOUND",
        "progress": { "current": 0, "total": 0, "percentage": 0 },
        "lastError": null
      });
    }

    // Calculate percentage
    let percentage = 0;
    if (integration.sync_progress_total > 0) {
      percentage = Math.round(
        (integration.sync_progress_current / integration.sync_progress_total) * 100
      );
    } else if (integration.sync_status === 'COMPLETED') {
      percentage = 100;
    }

    // Fetch real entity counts for sync animation counters.
    // These are cheap COUNT queries — no joins, PK-indexed by shop_id.
    const [orderCount, variantCount, customerCount] = await Promise.all([
      db('orders').where({ shop_id: shopId }).count('* as count').first(),
      db('variants').where({ shop_id: shopId }).count('* as count').first(),
      db('customers').where({ shop_id: shopId }).count('* as count').first(),
    ]);

    res.json({
      status: integration.sync_status,
      progress: {
        current: integration.sync_progress_current,
        total: integration.sync_progress_total,
        percentage,
      },
      counts: {
        orders:    Number((orderCount as any)?.count ?? 0),
        variants:  Number((variantCount as any)?.count ?? 0),
        customers: Number((customerCount as any)?.count ?? 0),
      },
      lastError: integration.sync_last_error,
    });
  } catch (error) {
    console.error('[integration.controller] Error in getSyncStatus:', error);
    res.status(500).json({ error: 'Failed to fetch sync status.' });
  }
};

/**
 * Endpoint for the "Pre-flight Check"
 * Checks if all necessary services (DB, Queue, Env) are ready.
 */
export const preFlightCheck = async (req: Request, res: Response) => {
  const issues: string[] = [];
  let dbReady = false;
  let queueReady = false;

  // 1. Check DB Connection
  try {
    await db.raw('SELECT 1');
    dbReady = true;
  } catch (error) {
    console.error('[preFlightCheck] DB connection failed:', (error as Error).message);
    issues.push('Database connection error.');
  }

  // 2. Check Queue Connection
  if (!connection) {
    console.warn('RabbitMQ connection not initialized; skipping queue operations');
    queueReady = false;
  } else {
    queueReady = typeof connection.isConnected === 'function' ? connection.isConnected() : false;
  }

  // 3. Check ENV Vars
  if (!process.env.SHOPIFY_API_KEY || !process.env.SHOPIFY_API_SECRET) {
    issues.push('Server configuration incomplete.');
  }

  const isReady = dbReady && queueReady && issues.length === 0;

  if (isReady) {
    return res.status(200).json({ ready: true, issues: [] });
  } else {
    // 503 Service Unavailable is the correct status code for a temporary failure
    return res.status(503).json({ ready: false, issues });
  }
};

export const triggerManualSync = async (req: Request, res: Response) => {
  try {
    const { userId } = requireAuthStrict(req);

    const rawIntegrationId = req.params.integrationId;
    const integrationId = Array.isArray(rawIntegrationId)
      ? rawIntegrationId[0]
      : rawIntegrationId;

    let shopId: number;
    try {
      ({ shopId } = await requireShopContextForUser(userId));
    } catch {
      return res.status(403).json({ error: 'User shop not found.' });
    }

    // Verify the integration belongs to the user's shop
    const integration = await db('integrations')
      .where({ id: integrationId, shop_id: shopId })
      .first();

    if (!integration) {
      return res.status(404).json({ error: 'Integration not found.' });
    }

    /**
     * DOMAIN EVENT EMISSION — MANUAL SYNC REQUESTED
     * ---------------------------------------------
     * Direct queue publishing is forbidden.
     * Manual sync must originate from immutable domain event.
     */
    await db.transaction(async trx => {
      const externalEventId = `internal:integration/manual_sync_requested:${integrationId}:${Date.now()}`;

      const [event] = await trx('domain_events')
        .insert({
          shop_id: shopId,
          event_type: 'integration/manual_sync_requested',
          event_payload: {
            integration_id: parseInt(integrationId),
          },
          event_time: trx.fn.now(),
          event_version: 1,
          external_event_id: externalEventId,
        })
        .returning(['id']);

      console.info('[OUTBOX_TRIGGER_EXPECTED]', {
        domainEventId: event.id,
        eventType: 'integration/manual_sync_requested',
      });

      /**
       * OUTBOX HANDLED BY DB TRIGGER
       * ----------------------------
       * domain_event_auto_outbox AFTER INSERT trigger
       * guarantees exactly one outbox row.
       *
       * Manual inserts are forbidden and will cause
       * domain_event_outbox_domain_event_unique violations.
       */
    });

    console.info('[integration][manual_sync_requested]', {
      integrationId: parseInt(integrationId),
    });
    
    console.log(`Manually queued sync job for integration ID: ${integrationId}`);
    
    res.json({ 
      message: 'Sync job queued successfully',
      integrationId: integrationId
    });
  } catch (error) {
    console.error('[integration.controller] Error triggering manual sync:', error);
    res.status(500).json({ error: 'Failed to trigger sync.' });
  }
};