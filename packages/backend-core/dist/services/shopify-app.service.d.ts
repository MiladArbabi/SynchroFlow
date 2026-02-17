import type { SpecterSDKConfig } from './specter-sdk.service.js';
export interface ShopifyAppInstallation {
    id?: number;
    shop_id: number;
    shop_domain: string;
    access_token: string;
    scopes: string;
    installed_at: Date;
    uninstalled_at?: Date;
    created_at?: Date;
    updated_at?: Date;
}
export declare class ShopifyAppService {
    /**
     * Create a new app installation record
     */
    static createAppInstallation(installation: Omit<ShopifyAppInstallation, 'id' | 'created_at' | 'updated_at'>): Promise<ShopifyAppInstallation>;
    /**
     * Get app installation by shop domain
     */
    static getAppInstallation(shopDomain: string): Promise<ShopifyAppInstallation | null>;
    /**
     * Mark app as uninstalled
     */
    static markAppUninstalled(shopDomain: string): Promise<void>;
    /**
     * Register app uninstall webhook
     */
    static registerAppUninstallWebhook(shopDomain: string): Promise<void>;
    /**
     * Enhanced post-installation with Specter module awareness
     */
    static completePostInstallation(shopDomain: string, shopId: number, moduleTier?: 'free' | 'growth' | 'operations'): Promise<void>;
    /**
     * Verify installation by checking if script tag is present
     */
    static verifyInstallation(shopDomain: string): Promise<boolean>;
    /**
     * Encrypt access token
     */
    static encryptToken(token: string): string;
    /**
     * Decrypt access token
     */
    static decryptToken(encryptedToken: string): string;
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
    static getDecryptedAccessTokenByShopId(shopId: number): Promise<{
        token: string;
        shopDomain: string;
    } | null>;
    /**
     * Get decrypted access token
     */
    static getDecryptedAccessToken(shopDomain: string): Promise<string | null>;
    /**
     * Generate Specter SDK configuration based on module tier
     */
    static generateSpecterConfig(moduleTier: 'free' | 'specter' | 'growth' | 'operations'): Promise<SpecterSDKConfig>;
    /**
     * Create Specter SDK script with configuration
     */
    static createSpecterScript(shopId: string, moduleTier: 'free' | 'specter' | 'growth' | 'operations'): Promise<string>;
    /**
     * Install Specter SDK with module-tier awareness
     */
    static installSpecterSDK(shopDomain: string, shopId: number, moduleTier?: 'free' | 'specter' | 'growth' | 'operations'): Promise<void>;
    /**
     * @deprecated
     * Shopify returns webhooks are NOT reliable nor accessible
     * under current scopes. Refunds are authoritative instead.
     */
    static registerReturnsRequestedWebhook(): Promise<void>;
    /**
     * Register Shopify refunds create webhook
     *
     * Topic:
     * - refunds/create (authoritative financial regression signal)
     */
    static registerRefundsCreateWebhook(shopDomain: string): Promise<void>;
}
