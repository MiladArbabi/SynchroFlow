import type { WarehouseZone, LocationStockDetail, LocationStockVariant } from '@lasyncro/shared/ui';

/** Exact records only: never feed a previously aggregated parent back into this sum. */
export function parentInventoryInspection(
  parentCode: string,
  zones: readonly WarehouseZone[],
  inspection: Readonly<Record<string, LocationStockDetail>> = {},
) {
  const children = new Map<string, Set<string>>();
  for (const zone of zones) {
    if (zone.parent_location_code == null) continue;
    const codes = children.get(zone.parent_location_code) ?? new Set<string>();
    codes.add(zone.location_code);
    children.set(zone.parent_location_code, codes);
  }
  const visited = new Set<string>();
  const pending = [parentCode];
  const locations: { code: string; direct: boolean; detail: LocationStockDetail | undefined }[] = [];
  const variants = new Map<string, LocationStockVariant>();
  const total: LocationStockDetail = { on_hand_quantity: 0, available_quantity: 0, reserved_quantity: 0, variants: [] };
  let unknownLocations = 0;
  while (pending.length) {
    const code = pending.pop()!;
    if (visited.has(code)) continue;
    visited.add(code);
    pending.push(...(children.get(code) ?? []));
    const detail = inspection[code];
    locations.push({ code, direct: code === parentCode, detail });
    if (!detail) { unknownLocations++; continue; }
    total.on_hand_quantity += detail.on_hand_quantity;
    total.available_quantity += detail.available_quantity;
    total.reserved_quantity += detail.reserved_quantity;
    for (const row of detail.variants) {
      const sum = variants.get(row.lasyncro_variant_id);
      if (!sum) variants.set(row.lasyncro_variant_id, { ...row });
      else {
        sum.on_hand_quantity += row.on_hand_quantity;
        sum.available_quantity += row.available_quantity;
        sum.reserved_quantity += row.reserved_quantity;
      }
    }
  }
  total.variants = [...variants.values()];
  return { total, locations, unknownLocations };
}
