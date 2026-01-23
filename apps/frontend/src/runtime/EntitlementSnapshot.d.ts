export interface EntitlementSnapshot {
    shopId: number | null;
    modules: ReadonlySet<string>;
    flags: ReadonlySet<string>;
}
