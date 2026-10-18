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
import bcrypt from 'bcrypt';

import db, {
  setTenantContext,
  systemQuery,
  systemTransaction,
  withTenant,
} from '@lasyncro/backend-core/db.js';
import { issueAuthTokens } from '../../api/auth/token.service.js';
import { requireAuthStrict } from '@lasyncro/backend-core/middleware/requireAuthStrict.js';

import { EntitlementsService } from '@lasyncro/backend-core/services/entitlements.service.js';
import { requireShopContextForUser } from '@lasyncro/backend-core/services/shop-resolution.service.js';
import { registerWebhooksForShop } from '../../services/shopify/shopifyWebhook.service.js';
import { modulesForTier, flagsForTier } from '@lasyncro/commercial-policy';
import { audit } from '../../utils/audit.js';
import { rateLimit } from '../../utils/rateLimit.js';
import { isActionAllowed } from '../../services/permissions/permissionCache.service.js';
import { connection } from '../../queue.js';
import { recordShopifySyncDispatchIntent } from '../../services/shopify/shopifyIntegrationStatus.service.js';
import { createTenantShop } from '@lasyncro/backend-core/services/pre-tenant.service.js';
import { transitionShopSubscription } from '../../services/billing/subscriptionTransition.service.js';
import { applyShopifyBillingState } from '../../services/shopify/applyShopifyBillingState.service.js';
import {
  SHOPIFY_REQUIRED_SCOPE_STRING,
} from '../../services/shopify/shopifyScopes.js';
import {
  acquireShopifyOAuthCredentials,
  ShopifyOAuthAcquisitionError,
  type ShopifyOAuthAcquisition,
} from '../../services/shopify/shopifyOAuthAcquisition.service.js';
import { persistShopifyAdminCredentials } from '../../services/shopify/shopifyAdminCredential.repository.js';
import { assertShopifyReconnectExecutorReady } from '../../services/shopify/shopifyReconnectExecutor.db.js';
import {
  prepareShopifyAdminCredentialReconnect,
  finalizeShopifyAdminCredentialReconnect,
  settleShopifyAdminCredentialReconnect,
  type ShopifyAdminCredentialReconnectPrepared,
} from '../../services/shopify/shopifyAdminCredentialLifecycle.service.js';

/**
 * SHOP-REVIEW-OAUTH-REGRESSION-162 (Slice 162C) — recognise the two
 * scope-contract failures thrown by `normalizeAndValidateShopifyGrantedScopes`
 * (shopifyScopes.ts, owned by Slice 162A) so the callback can fail closed with a
 * distinct 403 + SECURITY audit instead of a generic token-exchange 502. Reads
 * only the internal Error message — never a provider payload.
 */
const classifyScopeFailure = (
  err: unknown
): { reason: string; missing: string[] } | null => {
  if (!(err instanceof Error)) return null;
  if (err.message === 'SHOPIFY_GRANTED_SCOPES_MISSING') {
    return { reason: 'no_granted_scopes', missing: [] };
  }
  const prefix = 'SHOPIFY_REQUIRED_SCOPES_MISSING:';
  if (err.message.startsWith(prefix)) {
    const missing = err.message
      .slice(prefix.length)
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    return { reason: 'required_scopes_missing', missing };
  }
  return null;
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

// SCOPE-01: scopes here MUST exactly match [access_scopes] in shopify.app.toml.
// Shopify grants only the intersection of the two lists — a mismatch silently
// breaks whatever feature depends on the missing scope. Last audited 2026-07-24:
// write_inventory -> stow cascade sync. NOTE: refund data (shopifyRefundBackfill.service.ts)
// is covered by read_orders — there is no separate "read_refunds" scope in Shopify's
// system. Do not re-add it; Shopify's app deploy validation will reject it outright.

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

 // BILL-19 / OAUTH-RECONNECT-01: this endpoint is reachable by any authenticated
  // user with a freeform `shop` param. Shopify App Store review requirement 2.3.1
  // prohibits initiating installs via manual myshopify.com entry — fresh Shopify
  // installs MUST originate from handleShopifyInstall (App-Store-owned surface).
  // This endpoint may ONLY be used today to reconnect a shop the requesting user
  // already owns/belongs to. Non-Shopify platforms (future: WooCommerce, Amazon,
  // NetSuite, Etsy) are intentionally exempt — this restriction is Shopify-specific.
  //
  // FUTURE (multi-Shopify-store consolidation, not yet built): when a merchant can
  // connect a SECOND, independent Shopify store from within laSyncro, this "must
  // already own an installation for this exact shop_domain" check will need to
  // change to something like "this shop_domain isn't already owned by a DIFFERENT
  // user" — otherwise this endpoint will incorrectly reject legitimate new-store
  // connections. Revisit this block first when building that feature. New-store
  // connections through this path still won't satisfy 2.3.1 on their own — that
  // will need its own App-Store-style safeguard (e.g. confirming installation via
  // Shopify's install redirect rather than a typed domain), not just an ownership
  // check.
  
  if (platform === 'shopify') {
    const shopId = req.user?.shopId;
    if (!shopId) return res.status(401).json({ error: 'Unauthorized' });

    const ownedInstallation = await withTenant(shopId, (trx) =>
      trx('shopify_app_installations')
        .join('shop_memberships', 'shop_memberships.shop_id', 'shopify_app_installations.shop_id')
        .where('shop_memberships.user_id', userId)
        .andWhere('shopify_app_installations.shop_domain', shopDomain)
        .first('shopify_app_installations.shop_id')
    );

    if (!ownedInstallation) {
      console.warn('[OAUTH_RECONNECT_DENIED]', { userId, shopDomain });
      return res.status(403).json({
        error: 'This endpoint only supports reconnecting an existing Shopify installation.',
      });
    }
  }

  // --- Hard expiry (10 minutes) ---
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000);

  // --- Opportunistic cleanup of expired OAuth states (defensive) ---
  await systemQuery(
    db('integration_oauth_states')
      .where('expires_at', '<', new Date())
      .andWhere({ user_id: userId, platform })
      .delete()
  );

  // --- Persist OAuth intent (stateless) ---
  await systemQuery(
    db('integration_oauth_states').insert({
      user_id: userId,
      platform,
      state,
      shop_domain: shopDomain,
      expires_at: expiresAt,
      install_source: platform === 'shopify' ? 'reconnect' : null,
    })
  );

  const redirectUri = `${process.env.API_URL}/api/v1/integrations/oauth/callback/${platform}`;

  let authorizationUrl = '';

  if (platform === 'shopify') {
    const shopifyApiKey = process.env.SHOPIFY_API_KEY;
    if (!shopifyApiKey) {
      return res.status(500).json({ error: 'Shopify API key missing' });
    }

    authorizationUrl =
      `https://${shopDomain}/admin/oauth/authorize` +
      `?client_id=${shopifyApiKey}` +
      `&scope=${encodeURIComponent(SHOPIFY_REQUIRED_SCOPE_STRING)}` +
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

  // Shopify's signed callback is a separate trust boundary from OAuth state.
  // Inspect the wire query as well as Express's parsed values: coercing arrays,
  // objects, or first/last duplicate values would make the signature ambiguous.
  if (platform === 'shopify') {
    const raw = new URLSearchParams(req.originalUrl.split('?')[1] ?? '');
    const seen = new Set<string>();
    const critical = new Set(['code', 'state', 'shop', 'hmac', 'timestamp',
      'error', 'error_description', 'host']);
    for (const [key, value] of raw) {
      const root = key.split('[')[0];
      if (seen.has(key) || (critical.has(root) && key !== root)
        || typeof req.query[key] !== 'string' || req.query[key] !== value) {
        return res.status(400).json({ error: 'Ambiguous OAuth callback parameters' });
      }
      seen.add(key);
    }
    if (Object.keys(req.query).length !== seen.size
      || !state?.trim() || !shop || !raw.get('hmac') || !raw.get('timestamp')
      || (error !== undefined && !error.trim())
      || (error && code !== undefined)
      || (!error && !code?.trim())
      || (error_description !== undefined && !error)) {
      return res.status(400).json({ error: 'Invalid OAuth callback parameters' });
    }

    const hmac = raw.get('hmac')!;
    const timestamp = raw.get('timestamp')!;
    if (hmac.length !== 64 || !/^[a-fA-F0-9]{64}$/.test(hmac)
      || timestamp !== timestamp.trim() || !/^\d+$/.test(timestamp) || !Number.isSafeInteger(Number(timestamp))
      || Number(timestamp) <= 0) {
      return res.status(400).json({ error: 'Malformed OAuth callback signature parameters' });
    }
    // One DNS label, no scheme, port, path, extra suffix, or embedded authority.
    if (shop !== shop.trim()
      || !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.myshopify\.com$/i.test(shop)) {
      return res.status(400).json({ error: 'Invalid Shopify shop hostname' });
    }
    const secret = process.env.SHOPIFY_API_SECRET;
    if (!secret) {
      return res.status(500).json({ error: 'Shopify OAuth is not configured' });
    }
    // Reuse the install endpoint's decoded, sorted key=value canonicalization.
    const message = [...raw.entries()].filter(([key]) => key !== 'hmac')
      .sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
      .map(([key, value]) => `${key}=${value}`).join('&');
    const expected = crypto.createHmac('sha256', secret).update(message).digest();
    if (!crypto.timingSafeEqual(Buffer.from(hmac, 'hex'), expected)) {
      audit({ level: 'SECURITY', event: 'shopify_callback_hmac_invalid' });
      return res.status(401).json({ error: 'Invalid OAuth callback signature' });
    }
  }

  console.log('🔵 Starting OAuth callback for platform:', platform);

  // --- 1. Handle OAuth Failure (Sad Path) ---
  if (error && platform !== 'shopify') {
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
      installSource: 'app_store' | 'reconnect' | null;
    };

  try {
    oauthContext = await systemTransaction(async trx => {
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

      if (platform === 'shopify' && (
        typeof row.shop_domain !== 'string'
        || row.shop_domain.toLowerCase() !== shop.toLowerCase()
      )) {
        throw new Error('OAUTH_SHOP_MISMATCH');
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

      // Only authenticated, shop-bound success callbacks burn the locked state.
      // A signed denial safely redirects without invalidating a pending install.
      if (!error) {
        await trx('integration_oauth_states')
          .where({ id: row.id })
          .delete();
      }

      return {
        userId: row.user_id,
        shopDomain: row.shop_domain,
        installSource: (row.install_source ?? null) as 'app_store' | 'reconnect' | null,
      };
    });
  } catch (err: any) {
    const reason =
      err.message === 'OAUTH_STATE_NOT_FOUND'
        ? 'Invalid or reused OAuth state'
        : err.message === 'OAUTH_STATE_EXPIRED'
        ? 'Expired OAuth state'
        : err.message === 'OAUTH_SHOP_MISMATCH'
        ? 'OAuth shop does not match authorization state'
        : 'OAuth state validation failed';

    audit({
      level: 'SECURITY',
      event: 'oauth_state_rejected',
      metadata: { platform, reason },
    });

    return res.status(403).json({ error: reason });
  }

  if (error) {
    const redirectUrl = new URL(`${process.env.FRONTEND_URL}/`);
    redirectUrl.searchParams.append('connect', 'error');
    redirectUrl.searchParams.append('message', getHumanReadableError(error, error_description || ''));
    return res.redirect(redirectUrl.toString());
  }

    console.info('[OAuth] State validated — starting token exchange', {
    platform,
    userId: oauthContext.userId,
    shopDomain: oauthContext.shopDomain,
  });

  if (!code) {
    return res.status(400).json({ error: 'Missing OAuth authorization code' });
  }

  if (platform !== 'shopify') {
    return res.status(400).json({ error: 'Unsupported platform' });
  }

  // Resolve only the consumed state's user membership before any Shopify acquisition.
  let shopId: number;
  let reconnect: ShopifyAdminCredentialReconnectPrepared | undefined;
  try {
    const shopContext = await requireShopContextForUser(oauthContext.userId);
    shopId = shopContext.shopId;
    // Reconnect intent does not preserve a permission revoked after initiation.
    // App Store completion has no pre-existing browser JWT and retains its flow.
    if (oauthContext.installSource === 'reconnect') {
      const allowed = await withTenant(shopId, () =>
        isActionAllowed(shopId, 'integrations:write', shopContext.role, { freshDb: true }));
      if (!allowed) {
        return res.status(403).json({ error: 'ACTION_FORBIDDEN', action: 'integrations:write' });
      }
    }
    const preparation = await prepareShopifyAdminCredentialReconnect({
      shopId, shopDomain: oauthContext.shopDomain!, now: new Date(),
    });
    if (preparation.kind === 'REFRESH_IN_PROGRESS' || preparation.kind === 'RETRYABLE') {
      return res.status(409).json({ error: 'SHOPIFY_RECONNECT_IN_PROGRESS', retryable: true });
    }
    if (preparation.kind === 'RECONNECT_PREPARED') {
      reconnect = preparation;
      try {
        await assertShopifyReconnectExecutorReady();
      } catch {
        // No acquisition has started: release only this prepared owner's lease.
        await settleShopifyAdminCredentialReconnect({
          ...reconnect, outcome: { kind: 'DEFINITIVE_NO_ISSUANCE' },
        });
        throw new Error('SHOPIFY_RECONNECT_EXECUTOR_REJECTED');
      }
    }
  } catch (err) {
    console.error('[OAuth] Credential preparation failed', { message: 'Shopify credential preparation failed' });
    return res.status(500).json({ error: 'Failed to prepare Shopify integration' });
  }

  let acquisition: ShopifyOAuthAcquisition;

  // Preparation has committed: no tenant transaction is held over acquisition/GID HTTP.
  try {
    acquisition = await acquireShopifyOAuthCredentials(oauthContext.shopDomain!, code);
  } catch (err) {
    if (reconnect) {
      try {
        await settleShopifyAdminCredentialReconnect({ ...reconnect, outcome: {
          kind: err instanceof ShopifyOAuthAcquisitionError
            ? err.issuance : 'POSSIBLY_ISSUED',
        } });
      } catch (cleanupError) {
        console.error('[OAuth] Reconnect cleanup failed', { message: 'Shopify reconnect cleanup failed' });
        return res.status(500).json({ error: 'Failed to settle Shopify integration' });
      }
    }
    // OBS-162B-2: an incomplete Shopify grant is a permissions problem, not a
    // token-endpoint failure — fail closed with a distinct 403 + SECURITY audit.
    const scopeFailure = classifyScopeFailure(err);
    if (scopeFailure) {
      audit({
        level: 'SECURITY',
        event: 'oauth_scopes_insufficient',
        userId: oauthContext.userId,
        metadata: {
          platform,
          reason: scopeFailure.reason,
          ...(scopeFailure.missing.length > 0
            ? { missing: scopeFailure.missing }
            : {}),
        },
      });
      return res
        .status(403)
        .json({ error: 'Shopify did not grant all required permissions' });
    }

    if (err instanceof ShopifyOAuthAcquisitionError && err.kind === 'SHOP_IDENTITY_FAILURE') {
      console.warn('[OAuth] Failed to fetch Shopify currency/identity/GID', err.diagnostics);
      return res.status(502).json({ error: 'Failed to verify Shopify shop identity' });
    }

    console.error('[OAuth] Token exchange failed',
      err instanceof ShopifyOAuthAcquisitionError
        ? err.diagnostics : { message: 'Shopify OAuth acquisition failed' });
    return res.status(502).json({ error: 'Failed to exchange OAuth token' });
  }

  const shopBaseCurrency = acquisition.shopIdentity.currencyCode ?? 'USD';
  const shopTimezone = acquisition.shopIdentity.ianaTimezone;
  const shopRealName = acquisition.shopIdentity.name;
  const shopContactEmail = acquisition.shopIdentity.contactEmail;
  const shopGid = acquisition.shopIdentity.gid;
  const shopifyGrantedScopes = acquisition.grantedScopes;

  // --- Step 2.2.2.b: Persist integration atomically ---
  let reconnectFinalized = false;
  try {
    let result: { integration: { id: number }; shopId: number };
    if (reconnect) {
      const completion = await finalizeShopifyAdminCredentialReconnect({ ...reconnect, credentials: acquisition });
      if (completion.kind === 'STALE_RESULT') {
        return res.status(409).json({ error: 'SHOPIFY_RECONNECT_STALE', retryable: true });
      }
      if (completion.kind !== 'RECONNECTED') throw new Error('SHOPIFY_RECONNECT_EXECUTOR_REJECTED');
      result = { integration: completion.integration, shopId };
      reconnectFinalized = true;
    } else {
      // First install and legacy bootstrap preserve GREEN-2 persistence/generation zero.
      result = await withTenant(shopId, async trx => {

        // Persist shop base currency captured from Shopify at OAuth time.
        await trx('shops')
          .where({ id: shopId })
          .update({ base_currency: shopBaseCurrency });

        // SRC-05a: timezone is a SEPARATE statement because it carries a guard
        // the currency write must not inherit. Folding both into one update with
        // a trailing .where(timezone_source) would skip the currency refresh
        // entirely for any shop that had set its own timezone.
        // Only overwrite when Shopify supplied a zone AND the merchant hasn't
        // chosen one — a re-install must never clobber a deliberate choice.
        if (shopTimezone) {
          await trx('shops')
            .where({ id: shopId, timezone_source: 'shopify' })
            .update({ timezone: shopTimezone });
        }

        const [integration] = await trx('integrations')
          .insert({
            shop_id: shopId,
            platform,
            platform_shop_name: oauthContext.shopDomain,
            updated_at: new Date(),
          })
          .onConflict(['shop_id', 'platform'])
          .merge({
            updated_at: new Date(),
          })
          .returning('*');

        // Stable installation identity and lifecycle metadata; credentials persist separately.
        const [installation] = await trx('shopify_app_installations')
          .insert({
            shop_id: shopId,
            shop_domain: oauthContext.shopDomain,
            shop_gid: shopGid,
            scopes: shopifyGrantedScopes,
            installed_at: new Date(),
            uninstalled_at: null,
          })
          .onConflict(['shop_domain'])
          .merge({
            scopes: shopifyGrantedScopes,
            shop_gid: shopGid,
            // SHB-08a: reinstall must clear uninstalled_at — otherwise
            // manualSync.controller.ts's `uninstalled_at IS NULL` sync gate
            // permanently blocks any shop that ever uninstalled once,
            // even after a legitimate reinstall.
            uninstalled_at: null,
            updated_at: new Date(),
          })
          .returning('id');

        await persistShopifyAdminCredentials(trx, installation.id, shopId, acquisition);

        // GH-1068 T3-B: the durable sync intent commits with the integration.
        await recordShopifySyncDispatchIntent(trx, {
          shopId, integrationId: Number(integration.id), installationId: Number(installation.id),
        });

        return {
          integration,
          shopId,
        };
      });
    }

    // --- Post-commit side effects ---
    await EntitlementsService.grantDefaultFreeTierForShop(result.shopId);
    /**
     * GHOST IDENTITY BACKFILL (App Store installs only)
     * ----------------------------------------------------
     * Replaces the placeholder @lasyncro.internal email/empty name with
     * real Shopify-provided data, fetched defensively above. Only touches
     * users whose email still matches the ghost pattern — never overwrites
     * a real direct-signup user's data on a reconnect through this same
     * callback. Failure here is non-fatal; OAuth has already succeeded.
     */
    try {
      const currentUser = await withTenant(result.shopId, (trx) =>
        trx('users')
          .where({ id: oauthContext.userId, shop_id: result.shopId })
          .first('email')
      );
      const isGhostEmail = currentUser?.email?.startsWith('shopify-install+') && currentUser.email.endsWith('@lasyncro.internal');
      if (isGhostEmail && shopContactEmail) {
        await withTenant(result.shopId, (trx) =>
          trx('users')
            .where({ id: oauthContext.userId, shop_id: result.shopId })
            .update({ email: shopContactEmail, updated_at: new Date() })
        );
      }
      if (isGhostEmail && shopRealName) {
        await withTenant(result.shopId, (trx) =>
          trx('shops')
            .where({ id: result.shopId })
            .update({ name: shopRealName })
        );
      }
    } catch (err) {
      console.warn('[OAuth] Ghost identity backfill failed (non-fatal)', { shopId: result.shopId, err });
    }

    /**
     * SYNC DISPATCH (GH-1068 T3-B)
     * ----------------------------
     * The durable integration/sync_dispatch_requested intent has already
     * committed: inside the 0216 reconnect finalizer, or inside the first-install
     * persistence transaction above. The domain-event outbox dispatcher alone
     * publishes it to sync_jobs with broker confirmation. No post-commit step
     * here, including a failure below, can lose or duplicate that intent.
     */

    /**
     * DOMAIN EVENT EMISSION — SYNC REQUESTED (OBSERVABILITY)
     * ------------------------------------------------------
     * Lifecycle visibility only; it does not dispatch sync.
     */
    await withTenant(result.shopId, async trx => {
      /**
       * TENANT CONTEXT (REQUIRED)
       * -------------------------
       * Must be set before domain_events INSERT so the auto_create_domain_event_outbox
       * trigger can pass the outbox RLS policy check (subquery scoped to current_tenant).
       * Without this, the trigger fires as sf_app with tenant=0 → RLS violation.
       */
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

    /**
     * COMMERCIAL RECONCILIATION — BILL-ENTITLEMENT-01 / P0-B3
     * ------------------------------------------------------
     * A Shopify install/reconnect must not complete merely by stamping
     * billing_provider='shopify'.
     *
     * Production proved the gap: a reviewer tenant sat at scale/active/stripe,
     * a reconnect migrated ownership to Shopify, and tier/status were left
     * untouched — while the live Shopify billing query for that same shop
     * reported NO active subscription (canonically starter/canceled). 23 paid
     * entitlement grants stayed open, and the JWT this callback handed back
     * still carried tier=scale.
     *
     * This block therefore runs BEFORE issueAuthTokens() below, so the session
     * is minted from reconciled commercial state rather than pre-reconnect
     * state, and so a reconciliation failure can still fail the whole callback
     * closed (the outer catch returns 500 and no token is ever issued).
     *
     * ORDERING INSIDE THE TRANSACTION — both steps, one transaction:
     *   1. the deliberate provider takeover. This is the ONLY path allowed to
     *      set allowProviderSwitch, and it must come first because
     *      applyShopifyBillingState's own transition declares
     *      actingProvider:'shopify' with NO switch — on a still-Stripe-owned
     *      tenant the ownership gate would refuse it.
     *   2. authoritative Shopify commercial state, applied through the EXISTING
     *      canonical service. No second Shopify tier mapper, no display-name
     *      authority, no reconciliation logic duplicated here.
     *
     * Sharing one tenant-scoped transaction is what makes this safe: if the
     * live billing fetch or the mapping fails, the takeover rolls back with it
     * rather than leaving a tenant marked Shopify-owned but never reconciled.
     */
    let shopifyBillingState: Awaited<ReturnType<typeof applyShopifyBillingState>> | null = null;

    if (
      oauthContext.installSource === 'app_store' ||
      oauthContext.installSource === 'reconnect'
    ) {
      shopifyBillingState = await withTenant(result.shopId, async (trx) => {
        const existing = await trx('shop_subscriptions')
          .where({ shop_id: result.shopId })
          .first('shop_id');

        if (existing) {
          /**
           * BILL-19 / P0-B3: the explicit, merchant-initiated provider
           * migration. A reconnect must never silently reset an App Store
           * merchant's billing_provider away from 'shopify', and an App Store
           * install/reconnect is the deliberate event that makes a tenant
           * Shopify-owned. No ordinary recurring provider event sets this flag.
           *
           * It no-ops when the tenant is already Shopify-owned: the canonical
           * transition service writes no ledger row when no authoritative
           * dimension changes.
           */
          await transitionShopSubscription(
            {
              shopId: result.shopId,
              to: { billingProvider: 'shopify' },
              source: 'shopify_oauth_callback',
              reason: `billing_provider_stamp:${oauthContext.installSource}`,
              actorType: 'shopify',
              actingProvider: 'shopify',
              allowProviderSwitch: true,
            },
            trx
          );
        }

        /**
         * Authoritative Shopify commercial truth. Also covers the shop with no
         * subscription row at all — the canonical service treats a missing row
         * as first-provider creation, which is exactly right for a tenant whose
         * ownership this callback has just established.
         */
        return applyShopifyBillingState(result.shopId, trx);
      });
    }

    // GH-1132 — the redirect's billing-entry decision must reflect effective
    // LOCAL post-reconciliation state, not the raw Partner API planHandle.
    // A fresh install (or a preserved app-granted Growth trial) has
    // planHandle=null yet must NOT be sent to hosted pricing. Read fresh
    // rather than captured out of the reconciliation closure above, so this
    // reflects exactly what was just committed.
    const effectiveLocalSubscription = await withTenant(result.shopId, (trx) =>
      trx('shop_subscriptions')
        .where({ shop_id: result.shopId })
        .first('tier', 'status', 'billing_provider', 'trial_ends_at')
    );

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
     const shopContext = await requireShopContextForUser(oauthContext.userId);
      authTokens = await issueAuthTokens({
        userId: oauthContext.userId,
        shopId: result.shopId,
        actorType: 'shop_user',
        authProvider: 'shopify',
        shopRoles: [shopContext.role],
        scopes: [],
        tokenVersion: 1,
      });
      } catch (err) {
        console.error('[OAuth] Token issuance invariant failed', err);
        throw new Error('OAUTH_FATAL: auth token issuance failed');
      }
  
    const { accessToken: userJwt, refreshToken } = authTokens;

    try {
      await registerWebhooksForShop(result.shopId);
    } catch (webhookErr) {
      // Retain only known credential-state messages; unexpected errors may carry secrets.
      const message = webhookErr instanceof Error &&
        /^SHOPIFY_CREDENTIAL_(REFRESH_IN_PROGRESS|RETRYABLE|PROVIDER_REJECTED|REAUTH_REQUIRED)$/.test(webhookErr.message)
        ? webhookErr.message
        : 'Shopify post-OAuth webhook registration failed';
      console.warn('[SHOPIFY_POST_OAUTH_WEBHOOK_REGISTRATION_FAILED_NON_FATAL]', {
        shopId: result.shopId,
        error: message,
      });
    }

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

    const connectParam = oauthContext.installSource === 'app_store' ? 'app_store' : 'success';
    // GH-1132 — 'canceled' is the only effective local state with no
    // Growth-trial or real-plan access: no active Shopify plan and no valid
    // local onboarding trial (never granted, already expired, or already
    // superseded). 'trialing' (fresh or preserved trial) and 'active' (real
    // Shopify plan) must never be sent to hosted pricing.
    const requiresBillingEntry =
      oauthContext.installSource === 'app_store' &&
      effectiveLocalSubscription?.status === 'canceled';
    const redirectPath = requiresBillingEntry ? '/settings/billing' : '/';
    const redirectParams = new URLSearchParams({
      connect: connectParam,
      token: userJwt,
    });
    if (requiresBillingEntry) {
      redirectParams.set('billing_entry', 'required');
    }

    return res.redirect(
      `${process.env.FRONTEND_URL}${redirectPath}?${redirectParams.toString()}`
    );
  } catch (err) {
    if (reconnect && !reconnectFinalized) {
      // Issuance already happened. Cleanup must never restore predecessor ACTIVE.
      try {
        await settleShopifyAdminCredentialReconnect({ ...reconnect, outcome: { kind: 'POSSIBLY_ISSUED' } });
      } catch (cleanupError) {
        console.error('[OAuth] Reconnect cleanup failed', { message: 'Shopify reconnect cleanup failed' });
      }
    }
    console.error('[OAuth] Integration persistence failed', { message: 'Shopify integration persistence failed' });
    return res.status(500).json({ error: 'Failed to finalize integration' });
  }
}

/**
 * GET /api/v1/integrations/shopify/install
 *
 * Unauthenticated App Store install entry point.
 * Shopify hits this URL (set as App URL in Partner Dashboard) when a merchant
 * installs from the App Store listing.
 *
 * Flow:
 *   1. Validate Shopify HMAC + timestamp (replay protection)
 *   2. Resolve or create shop + owner user
 *      - Serialize by canonical shop domain before resolving ownership
 *      - Reinstall: find existing owner via shopify_app_installations
 *      - Pending install: validate and reuse the original ghost owner
 *      - New install: create ghost shop + user, then set tenant context
 *   3. Seed integration_oauth_states with install_source: 'app_store'
 *   4. Redirect directly to Shopify OAuth (no frontend step)
 *
 * HARD RULES:
 *   - No auth middleware on this route
 *   - HMAC validation is mandatory — reject any unsigned request
 *   - Ghost user email is @lasyncro.internal and is password-login-disabled
 *   - billing_provider: 'shopify' is stamped at birth on new installs
 * 
 * OAUTH-SCOPES-01 / SHOPIFY-LOCATION-SCOPE-01 (2026-08-13)
 * ---------------------------------------------------------
 * App Store install and authenticated reconnect both consume
 * SHOPIFY_REQUIRED_SCOPE_STRING from shopifyScopes.ts.
 *
 * Do not introduce an independently maintained scope list here.
 * shopify.app.toml must represent the same required capability contract.
 *
 * The OAuth callback persists Shopify's normalized effective grant set rather
 * than a hard-coded requested-scope approximation. `read_locations` is a core
 * capability required for human-readable Shopify Location metadata used by
 * warehouse-location mapping.
 */
export const handleShopifyInstall = async (req: Request, res: Response) => {
  const query = req.query as Record<string, string>;
  const { shop, hmac, timestamp } = query;

  if (!shop || !hmac || !timestamp) {
    return res.status(400).send('Missing required install parameters');
  }

  const secret = process.env.SHOPIFY_API_SECRET;
  if (!secret) {
    console.error('[shopify-install] SHOPIFY_API_SECRET not set');
    return res.status(500).send('Server configuration error');
  }

  // HMAC validation — exclude hmac param, sort remaining, digest with app secret
  const params: Record<string, string> = {};
  for (const [k, v] of Object.entries(query)) {
    if (k !== 'hmac') params[k] = v;
  }
  const message = Object.keys(params)
    .sort()
    .map(k => `${k}=${params[k]}`)
    .join('&');

  const expectedHmac = crypto
    .createHmac('sha256', secret)
    .update(message)
    .digest('hex');

  let hmacValid = false;
  try {
    hmacValid = crypto.timingSafeEqual(
      Buffer.from(hmac),
      Buffer.from(expectedHmac)
    );
  } catch {
    hmacValid = false;
  }

  if (!hmacValid) {
    audit({ level: 'SECURITY', event: 'shopify_install_hmac_invalid', metadata: { shop } });
    return res.status(401).send('Invalid request signature');
  }

  // Replay protection — 5-minute timestamp window
  const ts = parseInt(timestamp, 10);
  if (isNaN(ts) || Math.abs(Date.now() / 1000 - ts) > 300) {
    return res.status(401).send('Request timestamp expired');
  }

  const shopDomain = normalizeShopDomain(shop.toLowerCase());
  const ghostEmail = `shopify-install+${shopDomain}@lasyncro.internal`;
  let userId: number;

  try {
    userId = await systemTransaction(async (trx) => {
      // A waiter must see the preceding install's commit after acquiring the
      // lock. All ownership lookups and provisioning use this same transaction.
      await trx.raw('SET TRANSACTION ISOLATION LEVEL READ COMMITTED');
      await trx.raw('SELECT pg_advisory_xact_lock(hashtext(?), hashtext(?))', [
        'shopify_app_store_install', shopDomain,
      ]);

      // Completed installation takes precedence, including uninstalled shops
      // and owners whose ghost profile has already been backfilled.
      const reinstallLookup = await trx.raw(
        'SELECT shop_id FROM public.resolve_shopify_reinstall_shop(?)',
        [shopDomain]
      );
      const existing = reinstallLookup.rows?.[0];

      if (existing) {
        const shopId = Number(existing.shop_id);
        await setTenantContext(trx, shopId);
        const owners = await trx('shop_memberships')
          .where({ shop_id: shopId, role: 'owner' })
          .select('user_id')
          .limit(2);

        if (owners.length !== 1) {
          throw new Error('SHOPIFY_INSTALL_OWNER_AMBIGUOUS');
        }

        await trx('shop_wms_settings')
          // GH-1145-A1: reinstall of an EXISTING shop. onConflict().ignore()
          // never overwrites its bootstrap_model; this value only lands if the
          // row was never provisioned, and an existing shop is classified
          // like every other pre-migration tenant.
          .insert({ shop_id: shopId, bootstrap_model: 'legacy_opening_balance_v1' })
          .onConflict('shop_id')
          .ignore();

        console.info('[shopify-install] Reinstall detected', {
          shopDomain,
          shopId,
          userId: owners[0].user_id,
        });
        return Number(owners[0].user_id);
      }

      // Use the existing pre-tenant SECURITY DEFINER facility on the locked
      // connection. Project only identity fields; never return its password hash.
      const pendingLookup = await trx.raw(`
        SELECT candidate.value->>'id' AS user_id,
               candidate.value->>'shop_id' AS shop_id,
               candidate.value->>'email' AS email,
               candidate.value->>'entry_channel' AS entry_channel
        FROM (SELECT public.resolve_auth_user_by_email(?) AS value) AS candidate
        WHERE candidate.value IS NOT NULL
      `, [ghostEmail]);
      const pending = pendingLookup.rows?.[0];

      if (pending) {
        const shopId = Number(pending.shop_id);
        const pendingUserId = Number(pending.user_id);
        if (!Number.isInteger(shopId) || shopId <= 0
          || !Number.isInteger(pendingUserId) || pendingUserId <= 0
          || pending.email !== ghostEmail
          || pending.entry_channel !== 'shopify_app_store') {
          throw new Error('SHOPIFY_INSTALL_PENDING_IDENTITY_INVALID');
        }

        await setTenantContext(trx, shopId);
        // The signed domain's deterministic email is only a discovery key.
        // Recovery also requires the tenant root, matching App Store user,
        // and an unambiguous owner membership under tenant RLS.
        const owner = await trx('users as u')
          .join('shops as s', 's.id', 'u.shop_id')
          .where({
            'u.id': pendingUserId,
            'u.shop_id': shopId,
            'u.email': ghostEmail,
            'u.entry_channel': 'shopify_app_store',
          })
          .first('u.id');
        const owners = await trx('shop_memberships')
          .where({ shop_id: shopId, role: 'owner' })
          .select('user_id')
          .limit(2);
        const installation = await trx('shopify_app_installations')
          .where({ shop_id: shopId })
          .first('id');

        if (!owner || owners.length !== 1
          || Number(owners[0].user_id) !== pendingUserId || installation) {
          throw new Error('SHOPIFY_INSTALL_PENDING_OWNERSHIP_CONFLICT');
        }

        // Recovery is read-only: retain the original provisioning and profile.
        return pendingUserId;
      }

      // New install — create the tenant root, then adopt it on the same
      // restricted transaction before any tenant-owned write.
       const shopId = await createTenantShop(trx, shopDomain);
       await setTenantContext(trx, shopId);

       const rootLocationCode = `WH-${shopId}-ROOT`;

       const [warehouse] = await trx('warehouses')
         .insert({
           shop_id: shopId,
           name: 'Main warehouse',
           root_location_code: rootLocationCode,
           is_default: true,
           active: true,
         })
         .returning(['warehouse_id']);

       if (!warehouse?.warehouse_id) {
         throw new Error('WAREHOUSE_BOOTSTRAP_FAILED');
       }

       await trx('warehouse_locations').insert({
         shop_id: shopId,
         warehouse_id: warehouse.warehouse_id,
         location_code: rootLocationCode,
         type: 'warehouse',
         parent_location_code: null,
         active: true,
       });

       console.info('[shopify-install] Warehouse bootstrapped', {
         shopDomain,
         shopId,
         warehouseId: warehouse.warehouse_id,
         rootLocationCode,
       });

        // ISSUE-12: shop_wms_settings was never provisioned at install time —
        // every shop hit "No WMS settings found" on first batch release.
        // All columns except shop_id have NOT NULL defaults (confirmed via
        // information_schema), so this minimal insert is safe.
        // GH-1145-A1: bootstrap_model has no default (migration 0193) — a
        // genuinely new install is reconcile_opening_expectation_v2.
        await trx('shop_wms_settings')
          .insert({ shop_id: shopId, bootstrap_model: 'reconcile_opening_expectation_v2' })
          .onConflict('shop_id')
          .ignore();

        // Ghost user — password-login-disabled via random irreversible hash
        const ghostPasswordHash = await bcrypt.hash(
          crypto.randomBytes(32).toString('hex'),
          10
        );

        const [ghostUser] = await trx('users')
          .insert({
            shop_id: shopId,
            email: ghostEmail,
            password_hash: ghostPasswordHash,
            first_name: '',
            last_name: '',
            entry_channel: 'shopify_app_store',
          })
          .returning('*');

        await trx('shop_memberships').insert({
          shop_id: shopId,
          user_id: ghostUser.id,
          role: 'owner',
        });

        const { LifecycleProjectionService } = await import(
          '../../services/lifecycle-projection.service.js'
        );
        await LifecycleProjectionService.projectForMembership(
          { shopId, userId: ghostUser.id },
          trx
        );

        // billing_provider: 'shopify' stamped at birth — never routes to Stripe
        //
        // GH-1132 — a genuinely fresh Shopify App Store install automatically
        // receives an app-granted 14-day Growth onboarding trial. This is NOT
        // a fabricated Shopify subscription: billing_provider is still
        // 'shopify' (never Stripe), but the tier/status/trial window are
        // granted locally, independent of whether the merchant has purchased
        // a real Shopify App Pricing plan yet. If a real plan becomes active
        // during the trial, applyShopifyBillingState supersedes it and clears
        // trial_ends_at (see applyShopifyBillingState.service.ts).
        //
        // BILL-ENTITLEMENT-01: creation establishes all three entitlement-
        // authoritative dimensions, so it routes through the canonical
        // transition service and is recorded as a creation transition with
        // NULL from_* values.
        await transitionShopSubscription(
          {
            shopId,
            to: { tier: 'growth', status: 'trialing', billingProvider: 'shopify' },
            fields: {
              billing_interval: 'monthly',
              billing_currency: 'USD',
              trial_ends_at: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000),
            },
            source: 'shopify_app_store_install',
            reason: 'app_store_install_growth_trial',
            actorType: 'shopify',
            // P0-B3: creation — the shop has no prior row, so this is
            // first-provider initialization, never a switch.
            actingProvider: 'shopify',
          },
          trx
        );

        await trx('shop_usage_metrics').insert({
          shop_id: shopId,
          tier_at_period_start: 'growth',
          period_starts_at: new Date(),
          period_ends_at: null,
        });

        await trx('shop_operational_settings')
          .insert({
            shop_id: shopId,
            fulfillment_sla_hours: 24,
            monthly_overhead_amount: 0,
            starting_cash_balance: 0,
          })
          .onConflict('shop_id')
          .ignore();

        // GH-1132 — seed canonical Growth entitlements to match the Growth
        // trial granted above, not Starter.
        const moduleRows = [...modulesForTier('growth')].map((moduleKey) => ({
          shop_id: shopId,
          module_key: moduleKey,
          flag_key: null as string | null,
          source: 'shopify_app_store_install:growth',
        }));
        const flagRows = [...flagsForTier('growth')].map((flagKey) => ({
          shop_id: shopId,
          module_key: flagKey.split('.')[0],
          flag_key: flagKey,
          source: 'shopify_app_store_install:growth',
        }));
        await EntitlementsService.applyFromCommercialGrant(trx, [...moduleRows, ...flagRows]);

        console.info('[shopify-install] Ghost shop + user created', {
          shopId,
          userId: ghostUser.id,
          shopDomain,
        });

      return Number(ghostUser.id);
    });
  } catch {
    // Database errors may include failed-row data; do not log credential material.
    console.error('[shopify-install] Failed to resolve/create user', { shopDomain });
    return res.status(500).send('Installation error — please try again');
  }

  // Seed OAuth state with install_source: 'app_store'
  const state = crypto.randomBytes(16).toString('hex');
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000);

  try {
    await systemQuery(
      db('integration_oauth_states')
        .where('expires_at', '<', new Date())
        .andWhere({ user_id: userId, platform: 'shopify' })
        .delete()
    );

    await systemQuery(
      db('integration_oauth_states').insert({
        user_id: userId,
        platform: 'shopify',
        state,
        shop_domain: shopDomain,
        install_source: 'app_store',
        expires_at: expiresAt,
      })
    );
  } catch (err) {
    console.error('[shopify-install] Failed to seed OAuth state', { shopDomain, userId, err });
    return res.status(500).send('Installation error — please try again');
  }

  // Redirect directly to Shopify OAuth — no frontend step for App Store installs
  const shopifyApiKey = process.env.SHOPIFY_API_KEY;
  if (!shopifyApiKey) {
    return res.status(500).send('Server configuration error');
  }

  const redirectUri = `${process.env.API_URL}/api/v1/integrations/oauth/callback/shopify`;

  const authorizationUrl =
    `https://${shopDomain}/admin/oauth/authorize` +
    `?client_id=${shopifyApiKey}` +
    `&scope=${encodeURIComponent(SHOPIFY_REQUIRED_SCOPE_STRING)}` +
    `&redirect_uri=${encodeURIComponent(redirectUri)}` +
    `&state=${state}`;

  audit({
    level: 'INFO',
    event: 'shopify_install_initiated',
    userId,
    metadata: { shopDomain, install_source: 'app_store' },
  });

  return res.redirect(authorizationUrl);
};

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
    const integration = await withTenant(shopId, (trx) =>
      trx('integrations')
        .where({ shop_id: shopId, platform: 'shopify' })
        .first(
          'id',
          'platform_shop_name',
          'sync_status',
          'sync_progress_current',
          'sync_progress_total',
          'sync_last_error',
          'updated_at'
        )
    );

    if (!integration) {
      // This user has no integration, which is fine, but not what this endpoint is for.
      return res.status(200).json({
        "status": "NOT_FOUND",
        "progress": { "current": 0, "total": 0, "percentage": 0 },
        "lastError": null
      });
    }

    // GH-1068 T1: installation lifecycle is independent of historical
    // sync completion. Report only a verified uninstall in this slice.
    // Remaining connection states require separate credential-authority tests.
    const installation = integration.platform_shop_name
      ? await withTenant(shopId, (trx) =>
          trx('shopify_app_installations')
            .where({
              shop_id: shopId,
              shop_domain: integration.platform_shop_name,
            })
            .orderBy('id', 'desc')
            .first('uninstalled_at'))
      : undefined;

    const isUninstalled = Boolean(installation?.uninstalled_at);

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
    const [orderCount, variantCount, customerCount, productCount, recentProducts] =
      await withTenant(shopId, (trx) => Promise.all([
        trx('orders').where({ shop_id: shopId }).count('* as count').first(),
        trx('variants').where({ shop_id: shopId }).count('* as count').first(),
        trx('customers').where({ shop_id: shopId }).count('* as count').first(),
        trx('products').where({ shop_id: shopId }).count('* as count').first(),
        // Deduplicate products updated by both products/create and products/update.
        trx('products')
          .where({ shop_id: shopId })
          .select('title', 'status', 'updated_at')
          .orderBy('updated_at', 'desc')
          .limit(10)
          .then((rows) => {
            const seen = new Set<string>();
            return rows
              .filter((r) => {
                if (seen.has(r.title)) return false;
                seen.add(r.title);
                return true;
              })
              .slice(0, 5);
          }),
      ]));
    res.json({
      integrationId: integration.id,
      status: integration.sync_status,
      ...(isUninstalled && { connectionStatus: 'UNINSTALLED' }),
      lastSyncedAt: integration.updated_at ?? null,
      progress: {
        current: integration.sync_progress_current,
        total: integration.sync_progress_total,
        percentage,
      },
      counts: {
        orders:    Number((orderCount as any)?.count ?? 0),
        variants:  Number((variantCount as any)?.count ?? 0),
        customers: Number((customerCount as any)?.count ?? 0),
        products:  Number((productCount as any)?.count ?? 0),
      },
      recentProducts,
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
    await systemQuery(db.raw('SELECT 1'));
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
    const { userId, shopId: authenticatedShopId } = requireAuthStrict(req);

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

    if (shopId !== authenticatedShopId) {
      return res.status(403).json({ error: 'Shop context mismatch.' });
    }

    // Verify the integration belongs to the user's shop
    const integration = await withTenant(shopId, (trx) =>
      trx('integrations')
        .where({ id: integrationId, shop_id: shopId })
        .first()
    );

    if (!integration) {
      return res.status(404).json({ error: 'Integration not found.' });
    }

    /**
     * DOMAIN EVENT EMISSION — MANUAL SYNC REQUESTED
     * ---------------------------------------------
     * Direct queue publishing is forbidden.
     * Manual sync must originate from immutable domain event.
     */
    await withTenant(shopId, async trx => {
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

/**
 * POST /api/v1/integrations/sync-notify
 * --------------------------------------
 * Merchant requests email notification when sync completes.
 * - Custom email → saves to sync_notify_email + sends acknowledgement
 * - No custom email → registered email used for completion only (no acknowledgement)
 */
export const requestSyncNotification = async (req: Request, res: Response) => {
  try {
    const { userId } = requireAuthStrict(req);
    const { notifyEmail } = req.body as { notifyEmail?: string };
    const customEmail = notifyEmail?.trim() || null;

    const { shopId } = await requireShopContextForUser(userId);
    const user = await withTenant(shopId, (trx) =>
      trx('users')
        .where({ id: userId, shop_id: shopId })
        .first('email', 'first_name')
    );

    if (!user?.email) {
      return res.status(400).json({ error: 'User email not found' });
    }

    if (customEmail) {
      // Store for FT0 completion handler
      await withTenant(shopId, (trx) =>
        trx('integrations')
          .where({ shop_id: shopId })
          .update({ sync_notify_email: customEmail })
      );

      // Send acknowledgement to custom email immediately
      const { sendSyncAcknowledgementEmail } = await import(
        '../../services/email/email.service.js'
      );
      sendSyncAcknowledgementEmail({
        toEmail: customEmail,
        firstName: user.first_name ?? '',
      }).catch((err) => {
        console.error('[SYNC_NOTIFY] acknowledgement email failed', { userId, err });
      });
    }

    console.info('[SYNC_NOTIFY] queued', { userId, customEmail: customEmail ?? 'registered' });
    return res.status(200).json({ ok: true });

  } catch (err) {
    console.error('[SYNC_NOTIFY] failed', err);
    return res.status(500).json({ error: 'Failed to queue notification' });
  }
};
