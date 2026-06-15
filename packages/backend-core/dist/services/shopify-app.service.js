import db from '../db.js';
import axios from 'axios';
import CryptoJS from 'crypto-js';
export class ShopifyAppService {
    /**
     * Create a new app installation record
     */
    static async createAppInstallation(installation) {
        const [newInstallation] = await db('shopify_app_installations')
            .insert(installation)
            .returning('*');
        return newInstallation;
    }
    /**
     * Get app installation by shop domain
     */
    static async getAppInstallation(shopDomain) {
        const installation = await db('shopify_app_installations')
            .where('shop_domain', shopDomain)
            .andWhere('uninstalled_at', null)
            .first();
        return installation || null;
    }
    /**
     * Mark app as uninstalled
     */
    static async markAppUninstalled(shopDomain) {
        await db('shopify_app_installations')
            .where('shop_domain', shopDomain)
            .update({ uninstalled_at: new Date() });
    }
    /**
     * Register app uninstall webhook
     */
    static async registerAppUninstallWebhook(shopDomain) {
        try {
            const accessToken = await this.getDecryptedAccessToken(shopDomain);
            if (!accessToken) {
                console.warn('[ShopifyAppService] Missing access token; skipping uninstall webhook registration', {
                    shopDomain,
                });
                return;
            }
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
                    address: `${baseUrl}/api/v1/shopify/webhooks`,
                    format: 'json'
                }
            };
            const response = await axios.post(webhookUrl, webhookData, {
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
    static async completePostInstallation(shopDomain, shopId, moduleTier = 'free') {
        await this.installSpecterSDK(shopDomain, shopId, moduleTier);
        await this.registerAppUninstallWebhook(shopDomain);
        await this.registerRefundsCreateWebhook(shopDomain);
        const existing = await this.getAppInstallation(shopDomain);
        if (!existing) {
            const accessToken = await this.getDecryptedAccessToken(shopDomain);
            if (!accessToken)
                return;
            await this.createAppInstallation({
                shop_id: shopId,
                shop_domain: shopDomain,
                access_token: this.encryptToken(accessToken),
                scopes: 'read_products,read_orders,read_customers,read_inventory,read_fulfillments,read_returns,write_script_tags',
                installed_at: new Date(),
            });
        }
    }
    /**
     * Verify installation by checking if script tag is present
     */
    static async verifyInstallation(shopDomain) {
        try {
            const accessToken = await this.getDecryptedAccessToken(shopDomain);
            if (!accessToken) {
                console.warn('[ShopifyAppService] Cannot verify installation — missing access token', {
                    shopDomain,
                });
                return false;
            }
            const scriptTagsUrl = `https://${shopDomain}/admin/api/2024-01/script_tags.json`;
            const response = await axios.get(scriptTagsUrl, {
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
        return CryptoJS.AES.encrypt(token, secret).toString();
    }
    /**
     * Decrypt access token
     */
    static decryptToken(encryptedToken) {
        const secret = process.env.ENCRYPTION_KEY;
        if (!secret) {
            throw new Error('ENCRYPTION_KEY is not set in environment.');
        }
        // STEP 1: Try new AES-256-GCM format (JSON payload)
        try {
            const parsed = JSON.parse(encryptedToken);
            const { ciphertext, iv, auth_tag } = parsed;
            if (ciphertext && iv && auth_tag) {
                const crypto = require('crypto');
                const key = crypto.createHash('sha256').update(secret).digest();
                const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64'));
                decipher.setAuthTag(Buffer.from(auth_tag, 'base64'));
                const decrypted = Buffer.concat([
                    decipher.update(Buffer.from(ciphertext, 'base64')),
                    decipher.final(),
                ]);
                return decrypted.toString('utf8');
            }
        }
        catch {
            // not GCM format — fall through to legacy
        }
        // STEP 2: Legacy CryptoJS fallback
        const bytes = CryptoJS.AES.decrypt(encryptedToken, secret);
        const result = bytes.toString(CryptoJS.enc.Utf8);
        if (!result || result.trim().length === 0) {
            throw new Error('Decryption failed (unknown format or wrong key)');
        }
        return result;
    }
    /**
   * Get decrypted access token by shop_id
   * ------------------------------------
   * Worker-safe credential access.
   *
   * Contract:
   * - Returns decrypted token or null
   * - Owns crypto boundary
   * - NEVER throws
   */
    static async getDecryptedAccessTokenByShopId(shopId) {
        const installation = await db('shopify_app_installations')
            .where({ shop_id: shopId, uninstalled_at: null })
            .first();
        if (!installation)
            return null;
        try {
            const token = this.decryptToken(installation.access_token);
            return {
                token,
                shopDomain: installation.shop_domain,
            };
        }
        catch {
            return null;
        }
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
    static async installSpecterSDK(shopDomain, shopId, moduleTier = 'free') {
        try {
            const accessToken = await this.getDecryptedAccessToken(shopDomain);
            if (!accessToken) {
                console.warn('[ShopifyAppService] Missing access token; skipping Specter SDK install', {
                    shopDomain,
                    shopId,
                });
                return;
            }
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
            await axios.post(scriptTagUrl, scriptTagData, {
                headers: {
                    'X-Shopify-Access-Token': accessToken,
                    'Content-Type': 'application/json'
                }
            });
            console.log(`✅ Specter SDK (${moduleTier} tier) installed for ${shopDomain}`);
        }
        catch (error) {
            /*       console.error('[ShopifyAppService] Specter SDK install failed (non-fatal):', error);
             */ return;
        }
    }
    /**
     * @deprecated
     * Shopify returns webhooks are NOT reliable nor accessible
     * under current scopes. Refunds are authoritative instead.
     */
    static async registerReturnsRequestedWebhook() {
        console.warn('[DEPRECATED] registerReturnsRequestedWebhook skipped — refunds pipeline is authoritative');
        return;
    }
    /**
     * Register Shopify refunds create webhook
     *
     * Topic:
     * - refunds/create (authoritative financial regression signal)
     */
    static async registerRefundsCreateWebhook(shopDomain) {
        try {
            const accessToken = await this.getDecryptedAccessToken(shopDomain);
            if (!accessToken)
                return;
            const baseUrl = process.env.SHOPIFY_WEBHOOK_BASE_URL || process.env.API_URL;
            if (!baseUrl || !baseUrl.startsWith('https://'))
                return;
            const webhookUrl = `https://${shopDomain}/admin/api/2024-01/webhooks.json`;
            await axios.post(webhookUrl, {
                webhook: {
                    topic: 'refunds/create',
                    address: `${baseUrl}/api/v1/shopify/webhooks`,
                    format: 'json',
                },
            }, {
                headers: {
                    'X-Shopify-Access-Token': accessToken,
                    'Content-Type': 'application/json',
                },
            });
            console.log('✅ Registered refunds/create webhook');
        }
        catch (error) {
            console.error('[ShopifyAppService] Failed to register refunds webhook:', error?.response?.data || error?.message || error);
        }
    }
    ;
}
