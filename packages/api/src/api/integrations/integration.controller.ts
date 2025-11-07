// packages/api/src/api/integrations/integration.controller.ts
import { Request, Response } from 'express';
import crypto from 'crypto';
import session from 'express-session';
import axios from 'axios'; 
import db from '../../db';
import CryptoJS from 'crypto-js';
import { User } from 'api-types';
import { getQueueChannel } from '../../queue';

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

    authorizationUrl = `https://{shop}.myshopify.com/admin/oauth/authorize?client_id=${shopifyApiKey}&scope=${scopes}&redirect_uri=${redirectUri}&state=${state}`.replace(
      '{shop}',
      shop
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
  const { code, state, shop } = req.query as { code: string; state: string; shop: string };
  const session = req.session as OAuthSession;
  const userId = session.oauth_user_id;

  // --- 1. Security: Validate CSRF State Token ---
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
    
    // --- 2. Token Exchange ---
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

    // --- 3. Get User's Shop ID ---
    const user = await db<User>('users').where({ id: userId }).first();
    if (!user || !user.shop_id) {
      return res.status(404).json({ error: 'User account or associated shop not found.' });
    }
    const userShopId = user.shop_id;

    // --- 4. Encrypt and Store Token ---
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

      // --- 5. Queue the initial sync job ---
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