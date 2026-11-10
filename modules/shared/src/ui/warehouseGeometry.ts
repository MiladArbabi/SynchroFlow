/** Display geometry only. World coordinates and dimensions are metres.
 * These helpers never fill or rewrite persisted location records.
 */
export const DEFAULT_COMPONENT_FOOTPRINT = { width: 1, depth: 0.8 } as const;

type RootGeometry = {
  type: string;
  position_x: number | null;
  position_y: number | null;
  width: number | null;
  depth: number | null;
};
type LocationIdentity = {
  location_code: string;
  type: string;
  parent_location_code: string | null;
};

/** Explicit parent links alone determine nested address positions. Keep
 * orphaned locations visible rather than guessing their missing ancestry.
 */
export function floorObjects<T extends LocationIdentity>(locations: readonly T[]): T[] {
  const byCode = new Map(locations.map(location => [location.location_code, location]));
  return locations.filter(location => {
    const parent = location.parent_location_code ? byCode.get(location.parent_location_code) : undefined;
    return !(location.type === 'bin' && parent && (parent.type === 'bin' || parent.type === 'shelf'));
  });
}

export function isImplicitWarehouseRoot(location: RootGeometry): boolean {
  return location.type === 'warehouse'
    && location.position_x == null && location.position_y == null
    && location.width != null && Number.isFinite(Number(location.width)) && Number(location.width) > 0
    && location.depth != null && Number.isFinite(Number(location.depth)) && Number(location.depth) > 0;
}

/** A dimensioned root may use an implicit origin. Ordinary unpositioned
 * locations and explicitly positioned roots retain their original geometry.
 */
export function projectWarehouseRoot<T extends RootGeometry>(location: T): T {
  return isImplicitWarehouseRoot(location) ? { ...location, position_x: 0, position_y: 0 } : location;
}
