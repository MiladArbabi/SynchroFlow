export interface EntitlementsSnapshot {
    shopId: number;
    modules: string[];
    flags: string[];
}
export interface CommercialGrantEvent {
    shopId: number;
    source: 'billing' | 'admin' | 'migration';
    grants: {
        modules?: string[];
        flags?: string[];
    };
    metadata?: {
        externalRef?: string;
        issuedAt?: string;
    };
}
export declare class EntitlementsService {
    /**
     * Resolve entitlements for a given user ID.
     *  - Look up user's shop_id
     *  - Load all rows from shop_module_entitlements for that shop
     *  - Return a normalized snapshot (unique modules + flags)
     */
    static getForUser(userId: number): Promise<EntitlementsSnapshot | null>;
    /**
     * Grant the default FT0 entitlements for a given shop.
     *
     * - Inserts a small, opinionated bundle of module/flag rows.
     * - Uses ON CONFLICT(shop_id, module_key, flag_key) DO NOTHING
     *   so that re-running is idempotent.
     */
    static grantDefaultFreeTierForShop(shopId: number): Promise<void>;
    /**
   * Grant the FT2-Free baseline entitlements for a given shop.
   *
   * FT2-Free rules:
   * - Observability-only access
   * - No paid / premium flags
   * - Idempotent and additive
   *
   * IMPORTANT:
   * - Must NOT revoke existing entitlements
   * - Must NOT infer lifecycle
   * - Must NOT grant pricing flags
   */
    static grantFt2FreeBaselineForShop(shopId: number): Promise<void>;
    /**
     * Apply entitlement rows from a trusted system service.
     *
     * WRITE SURFACE (SEALED):
     * - Intended ONLY for CommercialGrantService
     * - No validation
     * - No business logic
     * - No lifecycle inference
     *
     * Do not call from anywhere else.
     */
    static applyFromCommercialGrant(trx: any, rows: Array<{
        shop_id: number;
        module_key: string;
        flag_key: string | null;
        source: string;
        valid_from?: Date;
        valid_until?: Date | null;
    }>): Promise<void>;
    /**
     * Apply entitlement rows (LOW-LEVEL).
     *
     * HARD RULES:
     * - No validation
     * - No business logic
     * - No lifecycle awareness
     * - No audit
     *
     * This is a mechanical persistence helper only.
     */
    private static applyEntitlementRows;
}
