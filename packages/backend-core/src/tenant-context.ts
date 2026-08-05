import { AsyncLocalStorage } from 'node:async_hooks';

const tenantContext = new AsyncLocalStorage<{ shopId: number }>();

export function runWithTenantContext<T>(shopId: number, fn: () => T): T {
  if (!Number.isInteger(shopId) || shopId <= 0) {
    throw new Error('INVALID_TENANT_CONTEXT');
  }

  return tenantContext.run({ shopId }, fn);
}

export function getTenantContextShopId(): number | undefined {
  return tenantContext.getStore()?.shopId;
}
