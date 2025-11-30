"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
// packages/api/src/scripts/diagnose-oauth.ts
const dotenv_1 = __importDefault(require("dotenv"));
dotenv_1.default.config();
console.log('🔍 OAuth Flow Diagnostic Report\n');
// 1. Check environment variables
console.log('1. Environment Variables:');
console.log(`   API_URL: ${process.env.API_URL}`);
console.log(`   FRONTEND_URL: ${process.env.FRONTEND_URL}`);
console.log(`   SHOPIFY_API_KEY: ${process.env.SHOPIFY_API_KEY ? '✅ Set' : '❌ Missing'}`);
console.log(`   SHOPIFY_API_SECRET: ${process.env.SHOPIFY_API_SECRET ? '✅ Set' : '❌ Missing'}`);
console.log(`   ENCRYPTION_KEY: ${process.env.ENCRYPTION_KEY ? '✅ Set' : '❌ Missing'}`);
// 2. Verify redirect URIs match Shopify Partner Dashboard
const expectedRedirectUris = [
    'http://localhost:5173/dashboard',
    'http://localhost:3000/api/v1/integrations/oauth/callback/shopify',
    'https://synchroflow.fly.dev/api/v1/integrations/oauth/callback/shopify'
];
const actualRedirectUri = `${process.env.API_URL}/api/v1/integrations/oauth/callback/shopify`;
console.log('\n2. Redirect URI Verification:');
console.log(`   Expected (Shopify Partner):`);
expectedRedirectUris.forEach(uri => console.log(`     - ${uri}`));
console.log(`   Actual (Our Code): ${actualRedirectUri}`);
console.log(`   Match: ${expectedRedirectUris.includes(actualRedirectUri) ? '✅' : '❌'}`);
// 3. Test URL construction
const testShop = 'test-store';
const shopDomain = `${testShop}.myshopify.com`;
const encodedRedirectUri = encodeURIComponent(actualRedirectUri);
const state = 'test-state-123';
const scopes = 'read_products,read_orders,read_inventory,read_payouts,read_fulfillments';
const authorizationUrl = `https://${shopDomain}/admin/oauth/authorize?client_id=${process.env.SHOPIFY_API_KEY}&scope=${scopes}&redirect_uri=${encodedRedirectUri}&state=${state}`;
console.log('\n3. Authorization URL Construction:');
console.log(`   Shop Domain: ${shopDomain}`);
console.log(`   Encoded Redirect URI: ${encodedRedirectUri}`);
console.log(`   Full URL: ${authorizationUrl}`);
// 4. Expected cancel flow
console.log('\n4. Expected Cancel Flow:');
console.log('   User visits:', authorizationUrl);
console.log('   User clicks "Cancel"');
console.log('   Shopify should redirect to:', `${actualRedirectUri}?error=access_denied&error_description=User+canceled&state=${state}`);
console.log('   Our backend should then redirect to:', `${process.env.FRONTEND_URL}/dashboard?connect=error&message=Authorization+was+canceled`);
console.log('\n🔧 Potential Issues:');
console.log('   - Shopify Partner Dashboard redirect URIs not matching exactly');
console.log('   - CORS or proxy configuration issues');
console.log('   - Session state not being maintained');
console.log('   - Incorrect shop domain format');
