// packages/api/src/api/integrations/integration.controller.ts
import { Request, Response } from 'express';
import crypto from 'crypto';
import session from 'express-session';
import axios from 'axios'; 
import db from '../../db';
import CryptoJS from 'crypto-js';
import { User } from 'api-types';
import { getQueueChannel, connection } from '../../queue';

// --- Helper function for multi-tenancy (copied from dashboard.controller) ---
/**
 * Helper function to get the shop_id from an authenticated user.
 */
const getShopIdFromRequest = async (req: Request): Promise<number | null> => {
  if (!req.user) return null;
  const userId = req.user.userId;
  
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

export const initiateOAuth = (req: Request, res: Response) => {
  const { platform, shop } = req.query as { platform: string; shop: string };
  const session = req.session as OAuthSession;
 const userId = req.user?.userId;

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
  session.oauth_user_id = userId; // <-- STORE THE USER ID

  let authorizationUrl = '';
  const redirectUri = `${process.env.API_URL}/api/v1/integrations/oauth/callback/${platform}`;

  // --- 3. Build Platform-Specific URL ---
  if (platform === 'shopify') {
    if (!shop) {
      return res.status(400).json({ error: 'Missing required query param: shop' });
    }
    const shopifyApiKey = process.env.SHOPIFY_API_KEY;
    // UPDATED FOR "TRUE PROFIT" MVP: Added read_payouts (for fees) and read_fulfillments (for shipping)
    const scopes = 'read_products,read_orders,read_inventory,read_payouts,read_fulfillments';

    // The user provides "my-store", but Shopify requires "my-store.myshopify.com".
    const shopDomain = `${shop}.myshopify.com`;

    authorizationUrl = `https://{shop}/admin/oauth/authorize?client_id=${shopifyApiKey}&scope=${scopes}&redirect_uri=${redirectUri}&state=${state}`.replace(
      '{shop}',
      shopDomain
    );
  } else if (platform === 'quickbooks') {
    // ... logic for QuickBooks (different params)
    return res.status(501).json({ error: 'QuickBooks not yet implemented' });
  } else {
    return res.status(400).json({ error: 'Unsupported platform' });
  }

  // --- 4. Respond ---
  res.status(200).json({ authorizationUrl });
};

export const handleOAuthCallback = async (req: Request, res: Response) => {
  const { platform } = req.params as { platform: string };
  // Destructure all possible query params, including error ones
  const { code, state, shop, error, error_description } = req.query as {
    code: string;
    state: string;
    shop: string;
    error?: string;
    error_description?: string;
  };
  const session = req.session as OAuthSession;
  const userId = session.oauth_user_id;

  // --- 1. Handle OAuth Failure (Sad Path) ---
  // Shopify (and others) send 'error' and 'error_description' on failure.
  if (error) {
    const errorMessage = error_description || error || 'Unknown OAuth error';
    // Clear the session state to prevent retry loops
    session.oauth_state = undefined;
    session.oauth_user_id = undefined;

    // Redirect to frontend with the params DashboardPage.tsx expects
    const redirectUrl = new URL(`${process.env.FRONTEND_URL}/dashboard`);
    redirectUrl.searchParams.append('connect', 'error');
    redirectUrl.searchParams.append('message', errorMessage);

    return res.redirect(redirectUrl.toString());
  }

  // --- 2. Security: Validate CSRF State Token (Happy Path) ---
  const expectedState = session.oauth_state;

  // --- NEW: Validate User ID ---
  if (!userId) {
    return res.status(403).json({ error: 'Invalid session: No user ID found.' });
  }

  if (!expectedState || !state || expectedState !== state) {
    // Clear the bad state
    session.oauth_state = undefined; 
    return res.status(403).json({ error: 'Invalid CSRF state token.' });
  }

  // State is valid, clear it from session
  session.oauth_state = undefined;
  session.oauth_user_id = undefined;

  try {
    let accessToken = '';
    
    // --- 3. Token Exchange ---
    if (platform === 'shopify') {
      const tokenUrl = `https://${shop}/admin/oauth/access_token`;
      const payload = {
        client_id: process.env.SHOPIFY_API_KEY,
        client_secret: process.env.SHOPIFY_API_SECRET,
        code,
      };

      const tokenResponse = await axios.post(tokenUrl, payload);
      accessToken = tokenResponse.data.access_token;
      
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
      // --- 6. Queue the initial sync job ---
      const syncChannel = getQueueChannel('sync_jobs');
      const jobPayload = { integrationId };
      syncChannel.sendToQueue('sync_jobs', Buffer.from(JSON.stringify(jobPayload)));
      console.log(`Queued initial sync job for integration ID: ${integrationId}`);
      // --- Final Redirect ---
      res.redirect(`${process.env.FRONTEND_URL}/dashboard?connect=success`);

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

export const getDiscoveryStatus = async (req: Request, res: Response) => {
  // We get the user ID from the authenticated request
  const shopId = await getShopIdFromRequest(req);
  
  if (!shopId) {
    return res.status(403).json({ message: 'User shop not found.' });
  }

  try {
    const integration = await db('integrations')
      .where({ shop_id: shopId })
      .orderBy('created_at', 'desc') // Get the latest one
      .first('discovered_payment_gateways');

    if (!integration) {
      return res.status(404).json({ message: 'No integration found' });
    }

    res.status(200).json({
      discovered_payment_gateways: integration.discovered_payment_gateways,
    });

  } catch (error: any) {
    console.error('[discovery-status] Error fetching discovery status:', error);
    res.status(500).json({ message: 'Error fetching discovery status', error: error.message });
  }
};