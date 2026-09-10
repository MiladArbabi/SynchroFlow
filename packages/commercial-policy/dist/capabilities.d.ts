import type { AccessRequirement } from './access.js';
export type CapabilityId = 'overview.core' | 'overview.live_map' | 'orders.core' | 'orders.live_map' | 'inventory.core' | 'inventory.live_map' | 'demand.forecasting' | 'alerts.inbox' | 'alerts.rules' | 'returns.intake' | 'returns.core' | 'returns.analysis' | 'warehouse.operations' | 'warehouse.analytics' | 'warehouse.floor_planning' | 'warehouse.problem_center' | 'purchasing.core' | 'purchasing.sourcing' | 'exports.core' | 'exports.column_selection';
export declare const CAPABILITY_REQUIREMENTS: Readonly<Record<CapabilityId, AccessRequirement>>;
export declare const CAPABILITY_IDS: readonly CapabilityId[];
/** Alias — every canonical CapabilityId is currently active. */
export declare const ACTIVE_CAPABILITY_IDS: readonly CapabilityId[];
export declare function isCapabilityId(value: unknown): value is CapabilityId;
export declare function requirementForCapability(id: CapabilityId): AccessRequirement;
