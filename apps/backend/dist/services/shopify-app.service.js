"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ShopifyAppService = void 0;
const shopify_api_1 = require("@shopify/shopify-api");
require("@shopify/shopify-api/adapters/node");
const db_1 = __importDefault(require("../db"));
const axios_1 = __importDefault(require("axios"));
const crypto_js_1 = __importDefault(require("crypto-js"));
// Initialize the Shopify API library context
const shopify = (0, shopify_api_1.shopifyApi)({
    apiKey: process.env.SHOPIFY_API_KEY,
    apiSecretKey: process.env.SHOPIFY_API_SECRET,
    apiVersion: process.env.SHOPIFY_API_VERSION,
    isEmbeddedApp: false,
    hostName: 'localhost',
});
class ShopifyAppService {
    /**
     * Create a new app installation record
     */
    static async createAppInstallation(installation) {
        const [newInstallation] = await (0, db_1.default)('shopify_app_installations')
            .insert(installation)
            .returning('*');
        return newInstallation;
    }
    /**
     * Get app installation by shop domain
     */
    static async getAppInstallation(shopDomain) {
        const installation = await (0, db_1.default)('shopify_app_installations')
            .where('shop_domain', shopDomain)
            .andWhere('uninstalled_at', null)
            .first();
        return installation || null;
    }
    /**
     * Mark app as uninstalled
     */
    static async markAppUninstalled(shopDomain) {
        await (0, db_1.default)('shopify_app_installations')
            .where('shop_domain', shopDomain)
            .update({ uninstalled_at: new Date() });
    }
    /**
     * Register app uninstall webhook
     */
    /**
   * Register app uninstall webhook
   */
    static async registerAppUninstallWebhook(shopDomain, accessToken) {
        try {
            const baseUrl = process.env.SHOPIFY_WEBHOOK_BASE_URL || process.env.API_URL;
            if (!baseUrl) {
                console.warn('[ShopifyAppService] No SHOPIFY_WEBHOOK_BASE_URL or API_URL set; skipping uninstall webhook registration.');
                return;
            }
            // In dev, localhost is NOT reachable by Shopify. Skip instead of throwing.
            if (!baseUrl.startsWith('https://')) {
                console.warn(`[ShopifyAppService] Webhook base URL is not HTTPS (${baseUrl}). ` +
                    'Skipping uninstall webhook registration in this environment.');
                return;
            }
            const webhookUrl = `https://${shopDomain}/admin/api/2024-01/webhooks.json`;
            const webhookData = {
                webhook: {
                    topic: 'app/uninstalled',
                    address: `${baseUrl}/api/v1/shopify/webhooks/app-uninstalled`,
                    format: 'json'
                }
            };
            const response = await axios_1.default.post(webhookUrl, webhookData, {
                headers: {
                    'X-Shopify-Access-Token': accessToken,
                    'Content-Type': 'application/json'
                }
            });
            console.log('✅ Registered app uninstall webhook:', JSON.stringify(response.data, null, 2));
        }
        catch (error) {
            const details = error?.response?.data || error?.message || error;
            console.error('[ShopifyAppService] Failed to register app uninstall webhook. Details:', JSON.stringify(details, null, 2));
            // IMPORTANT: Do NOT throw here – webhook failure should not break post-install.
            // For prod, you can later add alerting instead of throwing.
        }
    }
    /**
     * Enhanced post-installation with Specter module awareness
     */
    static async completePostInstallation(shopDomain, accessToken, shopId, moduleTier = 'free') {
        // Install Specter SDK script tag with module-tier awareness
        await this.installSpecterSDK(shopDomain, accessToken, shopId, moduleTier);
        // Register app uninstall webhook
        await this.registerAppUninstallWebhook(shopDomain, accessToken);
        // Create app installation record (if not exists)
        const existingInstallation = await this.getAppInstallation(shopDomain);
        if (!existingInstallation) {
            await this.createAppInstallation({
                shop_id: shopId,
                shop_domain: shopDomain,
                access_token: this.encryptToken(accessToken),
                scopes: 'read_products,read_orders,read_customers,read_inventory,read_fulfillments,write_script_tags',
                installed_at: new Date()
            });
        }
    }
    /**
     * Verify installation by checking if script tag is present
     */
    static async verifyInstallation(shopDomain, accessToken) {
        try {
            const scriptTagsUrl = `https://${shopDomain}/admin/api/2024-01/script_tags.json`;
            const response = await axios_1.default.get(scriptTagsUrl, {
                headers: {
                    'X-Shopify-Access-Token': accessToken
                }
            });
            const scriptTags = response.data.script_tags;
            return scriptTags.some((tag) => tag.src.includes('specter-sdk-v1.js'));
        }
        catch (error) {
            console.error('Failed to verify installation:', error);
            return false;
        }
    }
    /**
     * Encrypt access token
     */
    static encryptToken(token) {
        const secret = process.env.ENCRYPTION_KEY;
        if (!secret) {
            throw new Error('ENCRYPTION_KEY is not set in environment.');
        }
        return crypto_js_1.default.AES.encrypt(token, secret).toString();
    }
    /**
     * Decrypt access token
     */
    static decryptToken(encryptedToken) {
        const secret = process.env.ENCRYPTION_KEY;
        if (!secret) {
            throw new Error('ENCRYPTION_KEY is not set in environment.');
        }
        const bytes = crypto_js_1.default.AES.decrypt(encryptedToken, secret);
        return bytes.toString(crypto_js_1.default.enc.Utf8);
    }
    /**
     * Store encrypted access token
     */
    static async storeEncryptedAccessToken(shopDomain, plainToken) {
        const encryptedToken = this.encryptToken(plainToken);
        // This method is similar to createAppInstallation, but we are only storing the token.
        // We might not have the shop_id at this point, so we cannot create a full record.
        // Alternatively, we can update an existing record or create a new one if we have shop_id.
        // For now, let's assume we have shop_id and create a full record in completePostInstallation.
        // This method might be redundant if we are using completePostInstallation.
    }
    /**
     * Get decrypted access token
     */
    static async getDecryptedAccessToken(shopDomain) {
        const installation = await this.getAppInstallation(shopDomain);
        if (!installation) {
            return null;
        }
        return this.decryptToken(installation.access_token);
    }
    ;
    /**
     * Generate Specter SDK configuration based on module tier
     */
    static async generateSpecterConfig(moduleTier) {
        const baseConfig = {
            shopId: '', // Will be set when creating the script
            moduleTier,
            features: {
                sessionTracking: true, // Always track sessions
                basicNudges: moduleTier !== 'free',
                exitIntent: moduleTier !== 'free',
                surgicalDiscounts: moduleTier === 'growth' || moduleTier === 'operations'
            }
        };
        return baseConfig;
    }
    ;
    /**
     * Create Specter SDK script with configuration
     */
    static async createSpecterScript(shopId, moduleTier) {
        const config = await this.generateSpecterConfig(moduleTier);
        config.shopId = shopId;
        // Create the SDK initialization script
        const script = `
// LaSyncro Specter SDK v1.0
(function() {
  window.SpecterSDKConfig = ${JSON.stringify(config)};
  
  // Initialize SDK
  if (typeof window.SpecterSDK === 'undefined') {
    window.SpecterSDK = new (function() {
      this.config = window.SpecterSDKConfig;
      this.session = null;
      
      this.init = function() {
        console.log('Specter SDK initialized for shop:', this.config.shopId);
        this.trackSession();
        
        if (this.config.features.exitIntent) {
          this.setupExitIntent();
        }
      };
      
      this.trackSession = function() {
        this.session = {
          id: 'sess_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9),
          timestamp: new Date(),
          intentScore: this.calculateIntentScore()
        };
        
        // Send session data to LaSyncro (simplified)
        if (navigator.sendBeacon) {
          navigator.sendBeacon('/lasyncro/specter/session', JSON.stringify(this.session));
        }
      };
      
      this.calculateIntentScore = function() {
        // Simplified intent scoring
        return Math.min((Math.random() * 0.3) + 0.2 + 0.5, 1.0);
      };
      
      this.setupExitIntent = function() {
        document.addEventListener('mouseleave', function(e) {
          if (e.clientY < 0) {
            window.SpecterSDK.showExitIntentNudge();
          }
        });
      };
      
      this.showExitIntentNudge = function() {
        // Simplified nudge display
        if (this.session && this.session.intentScore > 0.7) {
          console.log('Showing exit intent nudge for high-intent visitor');
          // In production, this would show a modal or banner
        }
      };
    })();
    
    window.SpecterSDK.init();
  }
})();
    `.trim();
        return script;
    }
    ;
    /**
     * Install Specter SDK with module-tier awareness
     */
    static async installSpecterSDK(shopDomain, accessToken, shopId, moduleTier = 'free') {
        try {
            const scriptTagUrl = `https://${shopDomain}/admin/api/2024-01/script_tags.json`;
            // For free tier, we inject a basic analytics-only version
            // For paid tiers, we inject the full Specter SDK
            const scriptSrc = moduleTier === 'free'
                ? 'https://cdn.lasyncro.com/specter-analytics-v1.js'
                : 'https://cdn.lasyncro.com/specter-sdk-v1.js';
            const scriptTagData = {
                script_tag: {
                    event: 'onload',
                    src: scriptSrc,
                    display_scope: 'online_store'
                }
            };
            await axios_1.default.post(scriptTagUrl, scriptTagData, {
                headers: {
                    'X-Shopify-Access-Token': accessToken,
                    'Content-Type': 'application/json'
                }
            });
            console.log(`✅ Specter SDK (${moduleTier} tier) installed for ${shopDomain}`);
        }
        catch (error) {
            console.error('Failed to install Specter SDK script tag:', error);
            throw new Error('Failed to install Specter SDK script tag');
        }
    }
}
exports.ShopifyAppService = ShopifyAppService;
//# sourceMappingURL=shopify-app.service.js.map