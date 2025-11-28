import { shopifyApi, ApiVersion, Session } from '@shopify/shopify-api';
import '@shopify/shopify-api/adapters/node';
import db from '../db';
import axios from 'axios';
import CryptoJS from 'crypto-js';

// Initialize the Shopify API library context
const shopify = shopifyApi({
  apiKey: process.env.SHOPIFY_API_KEY,
  apiSecretKey: process.env.SHOPIFY_API_SECRET!,
  apiVersion: process.env.SHOPIFY_API_VERSION as ApiVersion,
  isEmbeddedApp: false,
  hostName: 'localhost',
});

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
   * Install Specter SDK script tag on the shop
   */
  static async installSpecterSDK(shopDomain: string, accessToken: string): Promise<void> {
    try {
      const scriptTagUrl = `https://${shopDomain}/admin/api/2024-01/script_tags.json`;
      const scriptTagData = {
        script_tag: {
          event: 'onload',
          src: 'https://cdn.lasyncro.com/specter-sdk-v1.js',
          display_scope: 'online_store'
        }
      };

      await axios.post(scriptTagUrl, scriptTagData, {
        headers: {
          'X-Shopify-Access-Token': accessToken,
          'Content-Type': 'application/json'
        }
      });
    } catch (error) {
      console.error('Failed to install Specter SDK script tag:', error);
      throw new Error('Failed to install Specter SDK script tag');
    }
  }

  /**
   * Register app uninstall webhook
   */
  static async registerAppUninstallWebhook(shopDomain: string, accessToken: string): Promise<void> {
    try {
      const webhookUrl = `https://${shopDomain}/admin/api/2024-01/webhooks.json`;
      const webhookData = {
        webhook: {
          topic: 'app/uninstalled',
          address: `${process.env.API_URL}/api/v1/shopify/webhooks/app-uninstalled`,
          format: 'json'
        }
      };

      await axios.post(webhookUrl, webhookData, {
        headers: {
          'X-Shopify-Access-Token': accessToken,
          'Content-Type': 'application/json'
        }
      });
    } catch (error) {
      console.error('Failed to register app uninstall webhook:', error);
      throw new Error('Failed to register app uninstall webhook');
    }
  }

  /**
   * Complete post-installation setup (script tag and webhooks)
   */
  static async completePostInstallation(shopDomain: string, accessToken: string, shopId: number): Promise<void> {
    // Install Specter SDK script tag
    await this.installSpecterSDK(shopDomain, accessToken);

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
  static async verifyInstallation(shopDomain: string, accessToken: string): Promise<boolean> {
    try {
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
   * Store encrypted access token
   */
  static async storeEncryptedAccessToken(shopDomain: string, plainToken: string): Promise<void> {
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
  static async getDecryptedAccessToken(shopDomain: string): Promise<string | null> {
    const installation = await this.getAppInstallation(shopDomain);
    if (!installation) {
      return null;
    }
    return this.decryptToken(installation.access_token);
  }
}