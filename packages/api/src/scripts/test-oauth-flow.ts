// packages/api/src/scripts/test-oauth-flow.ts
const testShop = 'test-store';
const shopDomain = `${testShop}.myshopify.com`;
const apiUrl = 'http://localhost:3000';
const redirectUri = `${apiUrl}/api/v1/integrations/oauth/callback/shopify`;
const encodedRedirectUri = encodeURIComponent(redirectUri);
const state = 'test-state-123';
const scopes = 'read_products,read_orders,read_inventory,read_payouts,read_fulfillments';
const apiKey = 'test-api-key';

const authorizationUrl = `https://${shopDomain}/admin/oauth/authorize?client_id=${apiKey}&scope=${scopes}&redirect_uri=${encodedRedirectUri}&state=${state}`;

console.log('🔗 Complete OAuth Flow Test:');
console.log('Shop Domain:', shopDomain);
console.log('Redirect URI:', redirectUri);
console.log('Encoded Redirect URI:', encodedRedirectUri);
console.log('Full Authorization URL:', authorizationUrl);
console.log('');
console.log('📋 Expected behavior:');
console.log('- User visits authorization URL');
console.log('- User clicks "Cancel" on Shopify permission page');
console.log('- Shopify redirects to:', redirectUri + '?error=access_denied&error_description=User+canceled&state=' + state);
console.log('- Our backend handles the error and redirects to frontend with user-friendly message');