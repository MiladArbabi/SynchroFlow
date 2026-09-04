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
     * Resolve the EFFECTIVE entitlements for a given user ID.
     *
     *   effective modules = modulesForTier(currentTier) ∪ temporally-valid persisted module rows
     *   effective flags   = flagsForTier(currentTier)   ∪ temporally-valid persisted flag rows
     *
     * COMMERCIAL-ACCESS-ARCH-01 P0-A2A: the snapshot now derives a canonical
     * tier floor from @lasyncro/commercial-policy. Zero persisted rows still
     * returns the tier's standard grants; valid persisted rows remain purely
     * additive; expired rows are excluded by the existing temporal query;
     * downgrade continues to rely on the current tier plus temporal revocation.
     * No deny/exclusion semantics, no schema change, no backfill.
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
