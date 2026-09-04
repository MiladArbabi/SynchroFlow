import type { Tier } from './tiers.js';
export type ModuleClassification = 'standard' | 'grant_only' | 'internal' | 'legacy';
/**
 * Every module identity the platform knows about, and what kind it is.
 *   standard   — a real, currently-active commercial module (tier-granted)
 *   grant_only — only ever granted by an explicit commercial grant, never a tier
 *   internal   — integration / SDK / sub-capability plumbing, not user-facing
 *   legacy     — deprecated / paused product area, kept for compatibility
 *
 * `wms-lite` is deliberately ABSENT — it is an invalid legacy nav reference.
 */
export declare const MODULE_CLASSIFICATION: Readonly<{
    readonly overview: "standard";
    readonly 'order-nexus': "standard";
    readonly fulfillment: "standard";
    readonly alerts: "standard";
    readonly wms: "standard";
    readonly returns: "standard";
    readonly products: "standard";
    readonly 'problem-center': "standard";
    readonly customers: "standard";
    readonly demand: "standard";
    readonly specter: "standard";
    readonly 'floor-planning': "standard";
    readonly 'suppliers-portal': "standard";
    readonly 'echo-hub': "grant_only";
    readonly shopify_integration: "internal";
    readonly specter_sdk_free: "internal";
    readonly barcodes: "internal";
    readonly shared: "internal";
    readonly finances: "legacy";
    readonly cashflow: "legacy";
}>;
export type ModuleId = keyof typeof MODULE_CLASSIFICATION;
export declare const MODULE_IDS: readonly ModuleId[];
export declare function isModuleId(value: unknown): value is ModuleId;
/** Canonical: the standard module set a shop on `tier` is granted. */
export declare function modulesForTier(tier: Tier): ReadonlySet<string>;
export declare const LEGACY_MODULES_BY_TIER: Readonly<Record<Tier, readonly string[]>>;
