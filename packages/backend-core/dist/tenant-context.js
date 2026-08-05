import { AsyncLocalStorage } from 'node:async_hooks';
const tenantContext = new AsyncLocalStorage();
export function runWithTenantContext(shopId, fn) {
    if (!Number.isInteger(shopId) || shopId <= 0) {
        throw new Error('INVALID_TENANT_CONTEXT');
    }
    return tenantContext.run({ shopId }, fn);
}
export function getTenantContextShopId() {
    return tenantContext.getStore()?.shopId;
}
