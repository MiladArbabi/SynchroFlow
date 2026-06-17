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
    static completePostInstallation(shopDomain: string, shopId: number): Promise<void>;
    /**
     * RETIRED (June 2026): Specter fully deprecated; this checked for the
     * legacy ScriptTag REST install marker, which Shopify restricts to
     * vintage themes and disallows for App Store apps. No callers remain.
     */
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
    static registerReturnsRequestedWebhook(): Promise<void>;
    /**
     * Register Shopify refunds create webhook
     *
     * Topic:
     * - refunds/create (authoritative financial regression signal)
     */
    static registerRefundsCreateWebhook(shopDomain: string): Promise<void>;
}
