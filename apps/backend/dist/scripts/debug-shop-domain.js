"use strict";
// packages/api/src/scripts/debug-shop-domain.ts
console.log('🛍️  Shopify Domain Format Debug:\n');
// Test different shop domain formats
const shopInputs = [
    'mystore',
    'mystore.myshopify.com',
    'https://mystore.myshopify.com',
    'mystore.myshopify.com/admin'
];
shopInputs.forEach(shop => {
    let shopDomain = shop;
    // Our current logic
    if (!shop.includes('.myshopify.com')) {
        shopDomain = `${shop}.myshopify.com`;
    }
    const redirectUri = 'http://localhost:3000/api/v1/integrations/oauth/callback/shopify';
    const encodedRedirectUri = encodeURIComponent(redirectUri);
    const authUrl = `https://${shopDomain}/admin/oauth/authorize?client_id=test-key&redirect_uri=${encodedRedirectUri}&state=test-state`;
    console.log(`Input: "${shop}"`);
    console.log(`Domain: ${shopDomain}`);
    console.log(`Auth URL: ${authUrl}`);
    console.log('---');
});
//# sourceMappingURL=debug-shop-domain.js.map