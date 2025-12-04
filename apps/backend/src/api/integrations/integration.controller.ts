// apps/backend/src/api/integrations/integration.controller.ts
import { Request, Response } from 'express';
import crypto from 'crypto';
import session from 'express-session';
import axios from 'axios'; 
import db from '../../db';
import CryptoJS from 'crypto-js';
import { User } from 'api-types';
import { getQueueChannel, connection } from '../../queue';
import { ShopifyAppService } from '../../services/shopify-app.service';
import { EntitlementsService } from 'api-src/services/entitlements.service';

// --- Helper function for multi-tenancy (copied from dashboard.controller) ---
/**
 * Helper function to get the shop_id from an authenticated user.
 */
const getShopIdFromRequest = async (req: Request): Promise<number | null> => {
  if (!(req as any).user) return null;
  const userId = (req as any).user.userId;
  
  // We need the user's shop_id to query data
  const user = await db<User>('users').where({ id: userId }).first('shop_id');
  
  return user?.shop_id || null;
};

// Define the shape of the session
interface OAuthSession extends session.Session {
  oauth_state?: string;
  oauth_user_id?: number; // Store the user ID initiating the flow
  user_id?: number; // (This might be from a regular login session)
}

// --- Helper function for encryption ---
const encryptToken = (token: string): string => {
  const secret = process.env.ENCRYPTION_KEY;
  if (!secret) {
    throw new Error('ENCRYPTION_KEY is not set in environment.');
  }
  return CryptoJS.AES.encrypt(token, secret).toString();
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

export const initiateOAuth = (req: Request, res: Response) => {
  const { platform, shop } = req.query as { platform: string; shop: string };
  const session = req.session as OAuthSession;
  const userId = (req as any).user?.userId; // Temporary fix for TypeScript

  // User ID must be present from middleware
  if (!userId) {
    return res.status(500).json({ error: 'Authenticated user ID not found.' });
  }

  // --- 1. Validation ---
  if (!platform) {
    return res.status(400).json({ error: 'Missing required query param: platform' });
  }

  // --- 2. Security: Generate & Store CSRF State Token ---
  const state = crypto.randomBytes(16).toString('hex');
  session.oauth_state = state;
  session.oauth_user_id = userId;

  let authorizationUrl = '';
  const redirectUri = `${process.env.API_URL}/api/v1/integrations/oauth/callback/${platform}`;

  // --- 3. Build Platform-Specific URL ---
  if (platform === 'shopify') {
    if (!shop) {
      return res.status(400).json({ error: 'Missing required query param: shop' });
    }
    
    const shopifyApiKey = process.env.SHOPIFY_API_KEY;
    // Keep this in sync with ShopifyAppService.completePostInstallation
    const scopes = [
      'read_products',
      'read_orders',
      'read_customers',
      'read_inventory',
      'read_payouts',
      'read_fulfillments',
      'write_script_tags',
      'read_script_tags'
    ].join(',');

    // NORMALIZE the shop domain to ensure correct format
    const shopDomain = normalizeShopDomain(shop);

    // PROPERLY encode the redirect URI
    const encodedRedirectUri = encodeURIComponent(redirectUri);

    authorizationUrl = `https://${shopDomain}/admin/oauth/authorize?client_id=${shopifyApiKey}&scope=${scopes}&redirect_uri=${encodedRedirectUri}&state=${state}`;

    // --- DIAGNOSTIC LOG --- (MOVED INSIDE THE BLOCK)
    console.log('[dev-api] CONSTRUCTED AUTH URL:', authorizationUrl);
    console.log('[OAuth Debug] Shop input:', shop);
    console.log('[OAuth Debug] Normalized shop domain:', shopDomain);
    console.log('[OAuth Debug] Redirect URI:', redirectUri);
    console.log('[OAuth Debug] Encoded Redirect URI:', encodedRedirectUri);
    console.log('[OAuth Debug] Full authorization URL:', authorizationUrl);

  } else if (platform === 'quickbooks') {
    // ... logic for QuickBooks (different params)
    return res.status(501).json({ error: 'QuickBooks not yet implemented' });
  } else {
    return res.status(400).json({ error: 'Unsupported platform' });
  }

  // --- 4. Respond ---
  res.status(200).json({ authorizationUrl });
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
  const { code, state, shop, error, error_description } = req.query as {
    code: string;
    state: string;
    shop: string;
    error?: string;
    error_description?: string;
  };
  const session = req.session as OAuthSession;
  const userId = session.oauth_user_id;

  console.log('🔵 Starting OAuth callback for platform:', platform);

  // --- 1. Handle OAuth Failure (Sad Path) ---
  if (error) {
    console.log('❌ OAuth error detected:', error);
    const userFriendlyError = getHumanReadableError(error, error_description || '');
    session.oauth_state = undefined;
    session.oauth_user_id = undefined;
    const redirectUrl = new URL(`${process.env.FRONTEND_URL}/dashboard`);
    redirectUrl.searchParams.append('connect', 'error');
    redirectUrl.searchParams.append('message', userFriendlyError);
    return res.redirect(redirectUrl.toString());
  }

  console.log('🔵 Validating CSRF state...');
  const expectedState = session.oauth_state;

  console.log('🔵 Validating user ID...');
  if (!userId) {
    console.log('❌ No user ID found');
    return res.status(403).json({ error: 'Invalid session: No user ID found.' });
  }

  console.log('🔵 Validating state:', { expectedState, state });
  if (!expectedState || !state || expectedState !== state) {
    console.log('❌ Invalid CSRF state');
    session.oauth_state = undefined; 
    return res.status(403).json({ error: 'Invalid CSRF state token.' });
  }

  console.log('✅ State validated, clearing session...');
  session.oauth_state = undefined;
  session.oauth_user_id = undefined;

  try {
    console.log('🔵 Starting token exchange...');
    let accessToken = '';
    
    if (platform === 'shopify') {
      const tokenUrl = `https://${shop}/admin/oauth/access_token`;
      const payload = { client_id: process.env.SHOPIFY_API_KEY, client_secret: process.env.SHOPIFY_API_SECRET, code };
      console.log('🔵 Making token request to:', tokenUrl);
      const tokenResponse = await axios.post(tokenUrl, payload);
      accessToken = tokenResponse.data.access_token;
      console.log('✅ Token received');
    } else {
      return res.status(400).json({ error: 'Unsupported platform' });
    }

    if (!accessToken) {
      return res.status(500).json({ error: 'Failed to retrieve access token.' });
    }

    // --- 4. Get User's Shop ID ---
    const user = await db<User>('users').where({ id: userId }).first();
    if (!user || !user.shop_id) {
      return res.status(404).json({ error: 'User account or associated shop not found.' });
    }
    const userShopId = user.shop_id;

    // --- 5. Encrypt and Store Token ---
    const encryptedToken = encryptToken(accessToken);

    const [newIntegration] = await db('integrations')
      .insert({
        shop_id: userShopId, // <-- USE THE USER'S SHOP ID
        platform: platform,
        platform_shop_name: shop,
        access_token_encrypted: encryptedToken,
      })
      .returning('*');

      const integrationId = newIntegration.id;
      console.log(`Successfully stored integration ID: ${integrationId}`);

      // --- Update user state and record milestone ---
      await db('users')
        .where({ id: userId })
        .update({ 
          shopify_connected: true,
          updated_at: new Date()
        });

      // Record the milestone
      await db('user_milestones').insert({
        user_id: userId,
        milestone: 'shopify_connected',
        achieved_at: new Date()
      }).onConflict(['user_id', 'milestone']).ignore();

      console.log(`Updated user ${userId} shopify_connected status and recorded milestone`);

      // --- Grant default FT0 entitlements for this shop ---
      if (userShopId) {
        await EntitlementsService.grantDefaultFreeTierForShop(userShopId);
        console.log(
          '[integration.controller] Granted default FT0 entitlements for shop',
          userShopId
        );
      }
      
      console.log('🟢 Integration created, queuing sync job...');
      // --- 6. Queue the initial sync job ---
      const syncChannel = getQueueChannel('sync_jobs');
      const jobPayload = { integrationId };
      syncChannel.sendToQueue('sync_jobs', Buffer.from(JSON.stringify(jobPayload)));
      console.log(`Queued initial sync job for integration ID: ${integrationId}`);
      console.log('🟢 Sync job queued');

      if (platform === 'shopify') {
        console.log('🟢 Starting Shopify post-installation setup...');
        try {
          await ShopifyAppService.completePostInstallation(shop, accessToken, userShopId);
          console.log('✅ Successfully completed Shopify app post-installation for', shop);
        } catch (postInstallError) {
          console.error('❌ Shopify app post-installation failed:', postInstallError);
        }
      }

      console.log('🟢 Redirecting to dashboard...');
      // --- Final Redirect ---
      res.redirect(`${process.env.FRONTEND_URL}/dashboard?connect=success`);
      console.log('🟢 Redirect called');

  } catch (err) {
    console.error('Error in OAuth callback:', err);
    res.status(500).json({ error: 'Internal server error during token exchange.' });
  }
};

/**
 * Endpoint for the "Pizza Tracker"
 * Fetches the current sync status for the user's Shopify integration.
 */
export const getSyncStatus = async (req: Request, res: Response) => {
  try {
    const shopId = await getShopIdFromRequest(req);
    if (!shopId) {
      return res.status(403).json({ error: 'User shop not found.' });
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
      return res.status(404).json({ error: 'Shopify integration not found.' });
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

    res.json({
      status: integration.sync_status,
      progress: {
        current: integration.sync_progress_current,
        total: integration.sync_progress_total,
        percentage: percentage,
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
  queueReady = connection.isConnected();
  if (!queueReady) {
    issues.push('Message queue not connected.');
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
    const { integrationId } = req.params;
    const shopId = await getShopIdFromRequest(req);
    
    if (!shopId) {
      return res.status(403).json({ error: 'User shop not found.' });
    }

    // Verify the integration belongs to the user's shop
    const integration = await db('integrations')
      .where({ id: integrationId, shop_id: shopId })
      .first();

    if (!integration) {
      return res.status(404).json({ error: 'Integration not found.' });
    }

    // Queue the sync job
    const syncChannel = getQueueChannel('sync_jobs');
    const jobPayload = { integrationId: parseInt(integrationId) };
    syncChannel.sendToQueue('sync_jobs', Buffer.from(JSON.stringify(jobPayload)));
    
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