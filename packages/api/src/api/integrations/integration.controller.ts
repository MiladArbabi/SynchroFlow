// packages/api/src/api/integrations/integration.controller.ts
import { Request, Response } from 'express';
import crypto from 'crypto';
import session from 'express-session';

// Define the shape of the session
interface OAuthSession extends session.Session {
  oauth_state?: string;
}

export const initiateOAuth = (req: Request, res: Response) => {
  const { platform, shop } = req.query as { platform: string; shop: string };
  const session = req.session as OAuthSession;

  // --- 1. Validation ---
  if (!platform) {
    return res.status(400).json({ error: 'Missing required query param: platform' });
  }

  // --- 2. Security: Generate & Store CSRF State Token ---
  const state = crypto.randomBytes(16).toString('hex');
  session.oauth_state = state;

  let authorizationUrl = '';
  const redirectUri = `${process.env.API_URL}/api/v1/integrations/oauth/callback/${platform}`;

  // --- 3. Build Platform-Specific URL ---
  if (platform === 'shopify') {
    if (!shop) {
      return res.status(400).json({ error: 'Missing required query param: shop' });
    }
    const shopifyApiKey = process.env.SHOPIFY_API_KEY;
    // These are the "scoped permissions" for the trial
    const scopes = 'read_products,read_orders,read_inventory';

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