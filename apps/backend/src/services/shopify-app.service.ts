import db from '../db';
import axios from 'axios';
import CryptoJS from 'crypto-js';
import { SpecterSDKService, type SpecterSDKConfig } from './specter-sdk.service';

export interface ShopifyAppInstallation {
  id?: number;
  shop_id: number;
  shop_domain: string;
  access_token: string; // Encrypted
  scopes: string;
  installed_at: Date;
  uninstalled_at?: Date;
  created_at?: Date;
  updated_at?: Date;
}

export class ShopifyAppService {
  /**
   * Create a new app installation record
   */
  static async createAppInstallation(installation: Omit<ShopifyAppInstallation, 'id' | 'created_at' | 'updated_at'>): Promise<ShopifyAppInstallation> {
    const [newInstallation] = await db('shopify_app_installations')
      .insert(installation)
      .returning('*');

    return newInstallation;
  }

  /**
   * Get app installation by shop domain
   */
  static async getAppInstallation(shopDomain: string): Promise<ShopifyAppInstallation | null> {
    const installation = await db('shopify_app_installations')
      .where('shop_domain', shopDomain)
      .andWhere('uninstalled_at', null)
      .first();

    return installation || null;
  }

  /**
   * Mark app as uninstalled
   */
  static async markAppUninstalled(shopDomain: string): Promise<void> {
    await db('shopify_app_installations')
      .where('shop_domain', shopDomain)
      .update({ uninstalled_at: new Date() });
  }

  /**
   * Register app uninstall webhook
   */
  static async registerAppUninstallWebhook(
    shopDomain: string,
  ): Promise<void> {
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
        console.warn(
          `[ShopifyAppService] Webhook base URL is not HTTPS (${baseUrl}). ` +
          'Skipping uninstall webhook registration in this environment.'
        );
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

      console.log(
        '✅ Registered app uninstall webhook:',
        JSON.stringify(response.data, null, 2)
      );
    } catch (error: any) {
      const details = error?.response?.data || error?.message || error;
      console.error(
        '[ShopifyAppService] Failed to register app uninstall webhook. Details:',
        JSON.stringify(details, null, 2)
      );

      // IMPORTANT: Do NOT throw here – webhook failure should not break post-install.
      // For prod, you can later add alerting instead of throwing.
    }
  }

  /**
   * Enhanced post-installation with Specter module awareness
   */
  static async completePostInstallation(
    shopDomain: string,
    shopId: number, 
    moduleTier: 'free' | 'specter' | 'growth' | 'operations' = 'free'
  ): Promise<void> {

    await this.installSpecterSDK(
      shopDomain,
      shopId,
      moduleTier
    );

    await this.registerAppUninstallWebhook(shopDomain);
    await this.registerReturnsRequestedWebhook(shopDomain);

    // Create app installation record (if not exists)
    const existingInstallation = await this.getAppInstallation(shopDomain);
    if (!existingInstallation) {
      const accessToken = await this.getDecryptedAccessToken(shopDomain);

      if (!accessToken) {
        console.warn('[ShopifyAppService] Cannot persist installation — missing access token', {
          shopDomain,
          shopId,
        });
        return;
      }

      await this.createAppInstallation({
        shop_id: shopId,
        shop_domain: shopDomain,
        access_token: this.encryptToken(accessToken),
        scopes: 'read_products,read_orders,read_customers,read_inventory,read_fulfillments,read_returns,write_script_tags',
        installed_at: new Date()
      });
    }
  }

  /**
   * Verify installation by checking if script tag is present
   */
  static async verifyInstallation(shopDomain: string): Promise<boolean> {
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
      return scriptTags.some((tag: any) => tag.src.includes('specter-sdk-v1.js'));
    } catch (error) {
      console.error('Failed to verify installation:', error);
      return false;
    }
  }

  /**
   * Encrypt access token
   */
  static encryptToken(token: string): string {
    const secret = process.env.ENCRYPTION_KEY;
    if (!secret) {
      throw new Error('ENCRYPTION_KEY is not set in environment.');
    }
    return CryptoJS.AES.encrypt(token, secret).toString();
  }

  /**
   * Decrypt access token
   */
  static decryptToken(encryptedToken: string): string {
    const secret = process.env.ENCRYPTION_KEY;
    if (!secret) {
      throw new Error('ENCRYPTION_KEY is not set in environment.');
    }
    const bytes = CryptoJS.AES.decrypt(encryptedToken, secret);
    return bytes.toString(CryptoJS.enc.Utf8);
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
  static async getDecryptedAccessTokenByShopId(
    shopId: number
  ): Promise<{ token: string; shopDomain: string } | null> {
    const installation = await db('shopify_app_installations')
      .where({ shop_id: shopId, uninstalled_at: null })
      .first();

    if (!installation) return null;

    try {
      const token = this.decryptToken(installation.access_token);
      return {
        token,
        shopDomain: installation.shop_domain,
      };
    } catch {
      return null;
    }
  }

  /**
   * Get decrypted access token
   */
  static async getDecryptedAccessToken(shopDomain: string): Promise<string | null> {
    const installation = await this.getAppInstallation(shopDomain);
    if (!installation) {
      return null;
    }
    return this.decryptToken(installation.access_token);
  };

  /**
   * Generate Specter SDK configuration based on module tier
   */
  static async generateSpecterConfig(moduleTier: 'free' | 'specter' | 'growth' | 'operations'): Promise<SpecterSDKConfig> {
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
  };

  /**
   * Create Specter SDK script with configuration
   */
  static async createSpecterScript(shopId: string, moduleTier: 'free' | 'specter' | 'growth' | 'operations'): Promise<string> {
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
  };

  /**
   * Install Specter SDK with module-tier awareness
   */
  static async installSpecterSDK(
    shopDomain: string, 
    shopId: number, 
    moduleTier: 'free' | 'specter' | 'growth' | 'operations' = 'free'): Promise<void> {
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
    } catch (error) {
      console.error('[ShopifyAppService] Specter SDK install failed (non-fatal):', error);
      return;
    }
  }

  /**
   * Register Shopify returns requested webhook
   */
  static async registerReturnsRequestedWebhook(
    shopDomain: string,
  ): Promise<void> {
    try {
      const accessToken = await this.getDecryptedAccessToken(shopDomain);
      if (!accessToken) return;

      const baseUrl = process.env.SHOPIFY_WEBHOOK_BASE_URL || process.env.API_URL;
      if (!baseUrl || !baseUrl.startsWith('https://')) return;

      const webhookUrl = `https://${shopDomain}/admin/api/2024-01/webhooks.json`;

      await axios.post(
        webhookUrl,
        {
          webhook: {
            topic: 'returns/requested',
            address: `${baseUrl}/api/v1/shopify/webhooks`,
            format: 'json',
          },
        },
        {
          headers: {
            'X-Shopify-Access-Token': accessToken,
            'Content-Type': 'application/json',
          },
        },
      );

      console.log('✅ Registered returns requested webhook');

      // NOTE: error is typed as `any` to allow Axios error introspection (response/data)
     } catch (error: any) {
      console.error(
        '[ShopifyAppService] Failed to register returns webhook:',
        error?.response?.data || error?.message || error,
      );
    }
  }
}