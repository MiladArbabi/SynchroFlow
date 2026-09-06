import type { AccessRequirement } from './access.js';
export type CapabilityStatus = 'active' | 'paused' | 'deprecated' | 'legacy' | 'disabled';
export interface CatalogEntry {
    status: CapabilityStatus;
    requirement?: AccessRequirement;
    note?: string;
}
export declare const CAPABILITY_CATALOG: Readonly<Record<string, CatalogEntry>>;
/** Back-compat alias. */
export declare const CATALOG: Readonly<Record<string, CatalogEntry>>;
export declare const LEGACY_CAPABILITIES: readonly string[];
