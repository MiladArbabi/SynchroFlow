// apps/frontend/src/pages/products/useProductsFt1Adapter.ts
/* eslint-disable @typescript-eslint/no-explicit-any */

import type { ProductsModuleProps } from '@lasyncro/products';

/**
 * FT1 Products Adapter (LOCKED)
 * ----------------------------
 * Pure mapping:
 * onboarding-readiness payload → ProductsModuleProps
 *
 * Rules:
 * - NO hooks
 * - NO lifecycle logic
 * - NO scenario logic
 * - Preserve null vs number
 */

export function mapProductsFt1Props(
  readinessData: any
): ProductsModuleProps {
  const module = readinessData?.modules?.find(
    (m: any) => m.moduleId === 'sku-os'
  );

  const signals = module?.signals ?? [];
  const get = (name: string) =>
    signals.find((s: any) => s.name === name)?.value;

  const productsKnown = get('sku-os.productsKnown');
  const rawCount = get('sku-os.productCount');

  return {
    productCount:
      productsKnown === false
        ? null
        : rawCount === undefined || rawCount === null
        ? null
        : Number(rawCount),
    productHealthEvents: null,
    excludedProductCount: null
  };
}
