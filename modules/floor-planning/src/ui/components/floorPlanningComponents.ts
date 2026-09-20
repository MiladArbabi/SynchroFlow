import { WarehouseLocationType } from '@lasyncro/shared/ui';

export const FLOOR_PLANNING_COMPONENT_GROUPS = [
  'STRUCTURE',
  'FULFILLMENT',
  'EXCEPTIONS',
  'OTHER',
] as const;

export type FloorPlanningComponentGroup = typeof FLOOR_PLANNING_COMPONENT_GROUPS[number];

export interface FloorPlanningComponentDefinition {
  id: string;
  label: string;
  group: FloorPlanningComponentGroup;
  type: WarehouseLocationType;
  zone_type: string;
  defaultW: number;
  defaultD: number;
  defaultRackLevels: number | null;
  codePrefix: string;
  description?: string;
}

// Creation defaults only. Existing zones always keep the semantic role carried
// by their persisted type and zone_type; location_code is never role metadata.
export const FLOOR_PLANNING_COMPONENTS = [
  { id: 'aisle', label: 'Aisle', group: 'STRUCTURE', type: 'lane', zone_type: 'pick', defaultW: 4.4, defaultD: 1.0, defaultRackLevels: null, codePrefix: 'AISLE' },
  { id: 'pick', label: 'Pick', group: 'FULFILLMENT', type: 'bin', zone_type: 'pick', defaultW: 1.0, defaultD: 0.5, defaultRackLevels: 3, codePrefix: 'PICK' },
  { id: 'pack', label: 'Pack', group: 'FULFILLMENT', type: 'bin', zone_type: 'pack', defaultW: 2.0, defaultD: 1.5, defaultRackLevels: 2, codePrefix: 'PACK' },
  { id: 'receive', label: 'Receive', group: 'FULFILLMENT', type: 'bin', zone_type: 'receive', defaultW: 3.0, defaultD: 3.0, defaultRackLevels: 1, codePrefix: 'RECEIVE' },
  { id: 'ship', label: 'Ship', group: 'FULFILLMENT', type: 'bin', zone_type: 'ship', defaultW: 4.0, defaultD: 3.0, defaultRackLevels: 1, codePrefix: 'SHIP' },
  // Semantic floor component only; operational WMS problem-bin designation is a separate workflow.
  { id: 'problem-area', label: 'Problem Area', group: 'EXCEPTIONS', type: 'bin', zone_type: 'problem', defaultW: 2.0, defaultD: 2.0, defaultRackLevels: 1, codePrefix: 'PROBLEM' },
  { id: 'returns', label: 'Returns', group: 'EXCEPTIONS', type: 'bin', zone_type: 'returns', defaultW: 3.0, defaultD: 2.0, defaultRackLevels: 1, codePrefix: 'RETURNS' },
  { id: 'quarantine', label: 'Quarantine', group: 'EXCEPTIONS', type: 'bin', zone_type: 'quarantine', defaultW: 2.0, defaultD: 2.0, defaultRackLevels: 1, codePrefix: 'QUARANTINE' },
  { id: 'materials', label: 'Materials', group: 'OTHER', type: 'bin', zone_type: 'kitting', defaultW: 2.0, defaultD: 1.0, defaultRackLevels: 2, codePrefix: 'MATERIALS' },
] as const satisfies readonly FloorPlanningComponentDefinition[];

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function nextFloorPlanningLocationCode(
  codePrefix: string,
  zones: readonly Pick<{ location_code: string }, 'location_code'>[],
): string {
  const prefix = codePrefix.toUpperCase();
  const matchingCode = new RegExp(`^${escapeRegExp(prefix)}-(\\d+)$`, 'i');
  const usedSuffixes = new Set<number>();

  for (const zone of zones) {
    const match = matchingCode.exec(zone.location_code);
    if (!match) continue;
    const suffix = Number(match[1]);
    if (Number.isSafeInteger(suffix) && suffix > 0) usedSuffixes.add(suffix);
  }

  let suffix = 1;
  while (usedSuffixes.has(suffix)) suffix += 1;

  return `${prefix}-${String(suffix).padStart(2, '0')}`;
}
