"use strict";
// packages/api/src/scripts/test-complete-oauth.ts
console.log('🔄 Complete OAuth Flow Test with Normalization\n');
// Test the normalization logic directly
function normalizeShopDomain(shopInput) {
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
}
const testCases = [
    { input: 'mystore', expected: 'mystore.myshopify.com' },
    { input: 'mystore.myshopify.com', expected: 'mystore.myshopify.com' },
    { input: 'https://mystore.myshopify.com', expected: 'mystore.myshopify.com' },
    { input: 'http://mystore.myshopify.com', expected: 'mystore.myshopify.com' },
    { input: 'mystore.myshopify.com/admin', expected: 'mystore.myshopify.com' },
    { input: 'https://mystore.myshopify.com/admin/oauth', expected: 'mystore.myshopify.com' },
];
console.log('Shop Domain Normalization:');
testCases.forEach(({ input, expected }) => {
    const result = normalizeShopDomain(input);
    const status = result === expected ? '✅' : '❌';
    console.log(`${status} "${input}" -> "${result}"`);
});
// Test complete URL construction
console.log('\nComplete URL Construction:');
// Define all variables at the top before using them
const apiUrl = 'http://localhost:3000';
const shopInput = 'mystore';
const shopDomain = normalizeShopDomain(shopInput);
const apiKey = 'test-key';
const scopes = 'read_products,read_orders';
const state = 'test-state';
const redirectUri = `${apiUrl}/api/v1/integrations/oauth/callback/shopify`;
const encodedRedirectUri = encodeURIComponent(redirectUri);
// Now build URLs with properly declared variables
const authUrl = `https://${shopDomain}/admin/oauth/authorize?client_id=${apiKey}&redirect_uri=${encodedRedirectUri}&state=${state}`;
const authorizationUrl = `https://${shopDomain}/admin/oauth/authorize?client_id=${apiKey}&scope=${scopes}&redirect_uri=${encodedRedirectUri}&state=${state}`;
console.log('Input shop:', shopInput);
console.log('Normalized domain:', shopDomain);
console.log('Authorization URL:', authorizationUrl);
console.log('\nExpected cancel flow:');
console.log('Shopify should redirect to:', `${redirectUri}?error=access_denied&state=${state}`);
