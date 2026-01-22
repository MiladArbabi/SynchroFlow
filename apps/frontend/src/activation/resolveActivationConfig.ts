// apps/frontend/src/activation/resolveActivationConfig.ts

import type { ActivationSurfaceProps } from '@lasyncro/shared/ui/activation';
import { orderNexusActivationConfig } from './configs/orders';
import { productsActivationConfig } from './configs/products';
import { customersActivationConfig } from './configs/customers';
import { financesActivationConfig } from './configs/finances';

/**
 * Canonical activation config registry.
 *
 * Keys MUST match routing moduleIds.
 * This is a structural map, not business logic.
 */
const ACTIVATION_BY_MODULE: Record<string, ActivationSurfaceProps> = {
  orders: orderNexusActivationConfig,
  products: productsActivationConfig,
  customers: customersActivationConfig,
  finances: financesActivationConfig,
};

/**
 * Resolve activation config for a given module.
 *
 * RULES:
 * - Unknown modules fall back to default
 * - Never throws
 * - Deterministic
 */
export function resolveActivationConfig(
  moduleId?: string
): ActivationSurfaceProps {
  if (!moduleId) {
    return null;
  }

  return ACTIVATION_BY_MODULE[moduleId] ?? null;
}
