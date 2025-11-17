// packages/api/src/scripts/test-complete-oauth.ts
console.log('🔄 Complete OAuth Flow Test with Normalization\n');

// Test the normalization logic directly
function normalizeShopDomain(shopInput: string) {
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
const shopInput = 'mystore';
const normalized = normalizeShopDomain(shopInput);
/* const redirectUri = 'http://localhost:3000/api/v1/integrations/oauth/callback/shopify';
const encodedRedirectUri = encodeURIComponent(redirectUri); */
const authUrl = `https://${normalized}/admin/oauth/authorize?client_id=test-key&redirect_uri=${encodedRedirectUri}&state=test-state`;

console.log('Input shop:', shopInput);
console.log('Normalized domain:', normalized);
console.log('Authorization URL:', authUrl);
console.log('\nExpected cancel flow:');
console.log('Shopify should redirect to:', `${redirectUri}?error=access_denied&state=test-state`);