import type { AccessRequirement } from './access.js';
export type CapabilityId = 'overview.core' | 'overview.live_map' | 'inventory.core' | 'inventory.live_map' | 'alerts.inbox' | 'orders.core' | 'orders.live_map' | 'warehouse.operations' | 'returns.intake' | 'returns.core' | 'returns.analysis' | 'warehouse.analytics' | 'exports.core' | 'demand.forecasting' | 'warehouse.floor_planning' | 'warehouse.problem_center' | 'purchasing.core' | 'purchasing.sourcing' | 'alerts.rules' | 'exports.column_selection';
export declare const CAPABILITY_REQUIREMENTS: Readonly<Record<CapabilityId, AccessRequirement>>;
export declare const CAPABILITY_IDS: readonly CapabilityId[];
/** Alias — every canonical CapabilityId is currently active. */
export declare const ACTIVE_CAPABILITY_IDS: readonly CapabilityId[];
export declare function isCapabilityId(value: unknown): value is CapabilityId;
export declare function requirementForCapability(id: CapabilityId): AccessRequirement;
