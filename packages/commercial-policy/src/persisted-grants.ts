import { CAPABILITY_CATALOG } from './catalog.js';

export interface PersistedGrantInput {
  moduleKey?: string | null;
  flagKey?: string | null;
  source?: string | null;
}

const NON_EFFECTIVE_MODULES = new Set<string>([
  'echo-hub',
  'customers',
  'specter',
  'specter_sdk_free',
  'finances',
  'cashflow',
]);

const LIVE_INTERNAL_MODULES = new Set<string>([
  'shopify_integration',
  'use_shopify_sync',
  'barcodes',
  'shared',
]);

const EXPLICIT_COMMERCIAL_GRANT_SOURCES = new Set<string>([
  'billing',
  'admin',
  'migration',
]);

function isNonEffectiveFlag(flagKey: string): boolean {
  const catalogEntry = CAPABILITY_CATALOG[flagKey];
  return catalogEntry !== undefined && catalogEntry.status !== 'active';
}

/**
 * Canonical persisted-grant effectiveness policy.
 *
 * Persisted rows are additive only when they are either required live internal
 * plumbing or an intentional explicit commercial grant. Historical plan/tier
 * materialization rows fail closed and cannot widen effective access.
 */
export function isEffectivePersistedGrant(input: PersistedGrantInput): boolean {
  const moduleKey = input.moduleKey ?? null;
  const flagKey = input.flagKey ?? null;
  const source = input.source ?? null;

  if (moduleKey && NON_EFFECTIVE_MODULES.has(moduleKey)) return false;
  if (flagKey && isNonEffectiveFlag(flagKey)) return false;

  if (moduleKey && LIVE_INTERNAL_MODULES.has(moduleKey)) return true;

  return source !== null && EXPLICIT_COMMERCIAL_GRANT_SOURCES.has(source);
}
