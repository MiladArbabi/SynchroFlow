// apps/frontend/src/activation/resolveActivationConfig.ts

import type { ActivationSurfaceProps } from '@lasyncro/shared/ui/activation';

import { dashboardActivationConfig } from './configs/dashboard';
import { orderNexusActivationConfig } from './configs/orders';
import { productsActivationConfig } from './configs/products';
import { customersActivationConfig } from './configs/customers';
import { analyticsActivationConfig } from './configs/analytics';
import { financesActivationConfig } from './configs/finances';

/**
 * Canonical activation config registry.
 *
 * Keys MUST match routing moduleIds.
 * This is a structural map, not business logic.
 */
const ACTIVATION_BY_MODULE: Record<string, ActivationSurfaceProps> = {
  dashboard: dashboardActivationConfig,
  orders: orderNexusActivationConfig,
  products: productsActivationConfig,
  customers: customersActivationConfig,
  analytics: analyticsActivationConfig,
  finances: financesActivationConfig,
};

/**
 * Resolve activation config for a given module.
 *
 * RULES:
 * - Unknown modules fall back to dashboard
 * - Never throws
 * - Deterministic
 */
export function resolveActivationConfig(
  moduleId?: string
): ActivationSurfaceProps {
  if (!moduleId) {
    return dashboardActivationConfig;
  }

  return ACTIVATION_BY_MODULE[moduleId] ?? dashboardActivationConfig;
}
