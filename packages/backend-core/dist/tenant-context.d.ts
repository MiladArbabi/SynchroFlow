export declare function runWithTenantContext<T>(shopId: number, fn: () => T): T;
export declare function getTenantContextShopId(): number | undefined;
