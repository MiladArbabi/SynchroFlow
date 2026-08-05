import { withTenant } from '../db.js';
import axios from 'axios';
import crypto from 'crypto';
import CryptoJS from 'crypto-js';

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
    const [newInstallation] = await withTenant(installation.shop_id, (trx) =>
      trx('shopify_app_installations')
        .insert(installation)
        .returning('*')
    );

    return newInstallation;
  }

  /**
   * Get app installation by shop domain
   */
  static async getAppInstallation(
    shopDomain: string,
    shopId: number,
  ): Promise<ShopifyAppInstallation | null> {
    const installation = await withTenant(shopId, (trx) =>
      trx('shopify_app_installations')
        .where({ shop_id: shopId, shop_domain: shopDomain })
        .whereNull('uninstalled_at')
        .first()
    );

    return installation || null;
  }

  /**
   * Mark app as uninstalled
   */
  static async markAppUninstalled(shopDomain: string, shopId: number): Promise<void> {
    await withTenant(shopId, (trx) =>
      trx('shopify_app_installations')
        .where({ shop_id: shopId, shop_domain: shopDomain })
        .update({ uninstalled_at: new Date() })
    );
  }

  /**
   * Register app uninstall webhook
   */
  static async registerAppUninstallWebhook(
    shopDomain: string,
    shopId: number,
  ): Promise<void> {
    try {
      const accessToken = await this.getDecryptedAccessToken(shopDomain, shopId);

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

      const response = await axios.post(
        `https://${shopDomain}/admin/api/2024-01/graphql.json`,
        {
          query: `
            mutation {
              webhookSubscriptionCreate(
                topic: APP_UNINSTALLED
                webhookSubscription: {
                  callbackUrl: "${baseUrl}/api/v1/shopify/webhooks"
                  format: JSON
                }
              ) {
                webhookSubscription { id }
                userErrors { field message }
              }
            }
          `,
        },
        {
          headers: {
            'X-Shopify-Access-Token': accessToken,
            'Content-Type': 'application/json',
          },
        }
      );

      const userErrors = response.data?.data?.webhookSubscriptionCreate?.userErrors ?? [];
      if (userErrors.length > 0) {
        console.warn('[ShopifyAppService] app/uninstalled webhook userErrors', userErrors);
      } else {
        console.log('✅ Registered app/uninstalled webhook via GraphQL');
      }
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
   * Post-installation hooks.
   *
   * RETIRED (June 2026): Specter SDK injection removed — Specter is fully
   * deprecated. It used the legacy ScriptTag REST API (script_tags.json),
   * which Shopify restricts to vintage themes and explicitly disallows for
   * App Store apps (theme app extensions are the required replacement).
   * Since Specter itself is being redesigned as a GA/PostHog integration
   * module rather than an injected storefront script, there is no
   * replacement script-tag call needed here.
   */
  static async completePostInstallation(
    shopDomain: string,
    shopId: number,
  ): Promise<void> {
    await this.registerAppUninstallWebhook(shopDomain, shopId);
    await this.registerRefundsCreateWebhook(shopDomain, shopId);

    const existing = await this.getAppInstallation(shopDomain, shopId);

    if (!existing) {
      const accessToken = await this.getDecryptedAccessToken(shopDomain, shopId);
      if (!accessToken) return;

      await this.createAppInstallation({
        shop_id: shopId,
        shop_domain: shopDomain,
        access_token: this.encryptToken(accessToken),
        scopes:
          'read_products,read_orders,read_customers,read_inventory,read_fulfillments,read_returns,write_script_tags',
        installed_at: new Date(),
      });
    }
  }

  /**
   * RETIRED (June 2026): Specter fully deprecated; this checked for the
   * legacy ScriptTag REST install marker, which Shopify restricts to
   * vintage themes and disallows for App Store apps. No callers remain.
   */
  /* static async verifyInstallation(shopDomain: string): Promise<boolean> {
    try {
      const accessToken = await this.getDecryptedAccessToken(shopDomain);
      if (!accessToken) {
        console.warn('[ShopifyAppService] Cannot verify installation —missing access token', {
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
  } */

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

    // STEP 1: Try new AES-256-GCM format (JSON payload)
    try {
      const parsed = JSON.parse(encryptedToken);
      const { ciphertext, iv, auth_tag } = parsed;
      if (ciphertext && iv && auth_tag) {
        const key = crypto.createHash('sha256').update(secret).digest();
        const decipher = crypto.createDecipheriv(
          'aes-256-gcm',
          key,
          Buffer.from(iv, 'base64')
        );
        decipher.setAuthTag(Buffer.from(auth_tag, 'base64'));
        const decrypted = Buffer.concat([
          decipher.update(Buffer.from(ciphertext, 'base64')),
          decipher.final(),
        ]);
        return decrypted.toString('utf8');
      }
    } catch {
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
  static async getDecryptedAccessTokenByShopId(
    shopId: number
  ): Promise<{ token: string; shopDomain: string } | null> {
    const installation = await withTenant(shopId, (trx) =>
      trx('shopify_app_installations')
        .where({ shop_id: shopId, uninstalled_at: null })
        .first()
    );

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
  static async getDecryptedAccessToken(
    shopDomain: string,
    shopId: number,
  ): Promise<string | null> {
    const installation = await this.getAppInstallation(shopDomain, shopId);
    if (!installation) {
      return null;
    }
    return this.decryptToken(installation.access_token);
  };
  
  /**
   * RETIRED (June 2026): generateSpecterConfig, createSpecterScript, and
   * installSpecterSDK are fully removed. Specter is deprecated — it
   * injected a storefront script via the legacy ScriptTag REST API
   * (script_tags.json), which Shopify restricts to vintage themes and
   * explicitly disallows for App Store apps (theme app extensions are
   * the required replacement). Specter's customer-analytics surface is
   * being redesigned as a Google Analytics / PostHog integration module
   * instead — no storefront script injection involved, so no GraphQL
   * or theme-app-extension replacement is needed here. No callers remain.
   */

  /**
   * @deprecated
   * Shopify returns webhooks are NOT reliable nor accessible
   * under current scopes. Refunds are authoritative instead.
   */
  static async registerReturnsRequestedWebhook(): Promise<void> {
    console.warn(
      '[DEPRECATED] registerReturnsRequestedWebhook skipped — refunds pipeline is authoritative',
    );
    return;
  }

  /**
   * Register Shopify refunds create webhook
   *
   * Topic:
   * - refunds/create (authoritative financial regression signal)
   */
  static async registerRefundsCreateWebhook(
    shopDomain: string,
    shopId: number,
  ): Promise<void> {
    try {
      const accessToken = await this.getDecryptedAccessToken(shopDomain, shopId);
      if (!accessToken) return;

      const baseUrl =
        process.env.SHOPIFY_WEBHOOK_BASE_URL || process.env.API_URL;
      if (!baseUrl || !baseUrl.startsWith('https://')) return;

      const refundRes = await axios.post(
        `https://${shopDomain}/admin/api/2024-01/graphql.json`,
        {
          query: `
            mutation {
              webhookSubscriptionCreate(
                topic: REFUNDS_CREATE
                webhookSubscription: {
                  callbackUrl: "${baseUrl}/api/v1/shopify/webhooks"
                  format: JSON
                }
              ) {
                webhookSubscription { id }
                userErrors { field message }
              }
            }
          `,
        },
        {
          headers: {
            'X-Shopify-Access-Token': accessToken,
            'Content-Type': 'application/json',
          },
        },
      );

      const refundErrors = refundRes.data?.data?.webhookSubscriptionCreate?.userErrors ?? [];
      if (refundErrors.length > 0) {
        console.warn('[ShopifyAppService] refunds/create webhook userErrors', refundErrors);
      } else {
        console.log('✅ Registered refunds/create webhook via GraphQL');
      }
    } catch (error: any) {
      console.error(
        '[ShopifyAppService] Failed to register refunds webhook:',
        error?.response?.data || error?.message || error,
      );
    }
  };
}
