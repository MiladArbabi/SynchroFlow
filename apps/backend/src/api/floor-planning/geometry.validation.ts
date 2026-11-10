/** Geometry is validated only when written; historic rows are never normalized. */
export class GeometryValidationError extends Error {
  readonly statusCode = 400;
}

type Geometry = Record<string, unknown>;
const coordinates = ['position_x', 'position_y'] as const;

// Compare the canonical decimal representation, avoiding binary multiplication
// errors (e.g. 1.001 * 1000). Scientific notation is handled explicitly.
function decimalPlaces(value: number): number {
  const [mantissa, exponent = '0'] = String(value).toLowerCase().split('e');
  return Math.max(0, (mantissa.split('.')[1]?.length ?? 0) - Number(exponent));
}

function metres(field: string, value: unknown, max: number, positive: boolean): void {
  if (value === null) return;
  if (typeof value !== 'number' || !Number.isFinite(value)
    || (positive ? value <= 0 : value < 0) || value > max
    || decimalPlaces(value) > 3) {
    throw new GeometryValidationError(
      `${field} must be null or a finite number ${positive ? 'greater than 0 and at most' : 'from 0 to'} ${max} metres with at most three decimal places`,
    );
  }
}

export function validateGeometry(input: Geometry, current: Geometry = {}): void {
  for (const field of coordinates) {
    if (input[field] !== undefined) metres(field, input[field], 99999.999, false);
  }
  if (coordinates.some((field) => input[field] !== undefined)) {
    const pair = coordinates.map((field) => input[field] !== undefined ? input[field] : current[field] ?? null);
    if ((pair[0] === null) !== (pair[1] === null)) {
      throw new GeometryValidationError('position_x and position_y must both be present or both null');
    }
    // Database numeric values may be strings. Only persisted counterparts are
    // converted; request values above always require native numbers.
    pair.forEach((value, index) => metres(coordinates[index], value === null ? null : Number(value), 99999.999, false));
  }
  for (const field of ['width', 'depth']) {
    if (input[field] !== undefined) metres(field, input[field], 999.999, true);
  }
  if (input.orientation !== undefined && ![0, 90, 180, 270].includes(input.orientation as number)) {
    throw new GeometryValidationError('orientation must be 0, 90, 180 or 270');
  }
  const levels = input.rack_levels;
  if (levels !== undefined && levels !== null
    && (typeof levels !== 'number' || !Number.isInteger(levels) || levels < 1 || levels > 20)) {
    throw new GeometryValidationError('rack_levels must be null or an integer from 1 to 20');
  }
}

/** Add in integer millimetres so decimal translations do not gain float noise. */
export function translatedCoordinates(source: Geometry, offset: { x: number; y: number }): Geometry {
  const result: Geometry = {};
  coordinates.forEach((field, index) => {
    const value = source[field];
    const delta = index === 0 ? offset.x : offset.y;
    if (decimalPlaces(delta) > 3) {
      throw new GeometryValidationError(`offset.${index === 0 ? 'x' : 'y'} must have at most three decimal places`);
    }
    if (value === null || value === undefined) result[field] = null;
    else {
      const numeric = Number(value);
      metres(field, numeric, 99999.999, false);
      result[field] = (Math.round(numeric * 1000) + Math.round(delta * 1000)) / 1000;
    }
  });
  validateGeometry(result);
  return result;
}

// ---------------------------------------------------------------------------
// FP-SPATIAL-S2B — authoritative warehouse boundary containment (extends
// GH-1176). One rule set for every Floor Planning geometry write.
//
// - Boundary: the warehouse root's persisted x/y (implicit (0,0) when null)
//   and its width/depth. A root without positive finite dimensions has NO
//   boundary: nothing is fabricated and nothing is blocked.
// - Footprint: [x, x + width] x [y, y + depth]; a null size is evaluated as
//   the Canvas display footprint 1 m x 0.8 m (never persisted). Orientation is
//   not applied, exactly as the Canvas renders.
// - Nested bin addresses (a bin whose explicit parent is a bin or shelf) are
//   not independent floor objects and are never evaluated. Parent identity is
//   explicit (shared floorObjects rule); spatial proximity is never used.
// - Component and root writes may not increase overflow on ANY edge. Legacy
//   out-of-bounds rows remain editable and correctable; improvement on one
//   edge cannot compensate for worsening another. Overlap is advisory only.
// ---------------------------------------------------------------------------

export const BOUNDARY_EDGE_EPSILON = 1e-6;

/** GH-1176: Canvas DEFAULT_COMPONENT_FOOTPRINT. Evaluation only. */
export const NULL_SIZE_COMPONENT_FOOTPRINT = { width: 1, depth: 0.8 } as const;

export type BoundaryLocation = {
  location_code: string;
  type: string;
  position_x: unknown;
  position_y: unknown;
  width: unknown;
  depth: unknown;
  /** Type of the explicit parent location, when it has one. */
  parent_type?: string | null;
};

export type WarehouseBounds = { x: number; y: number; width: number; depth: number };

function finiteOrNull(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/** Root boundary, or null when the root has no usable dimensions. */
export function warehouseBounds(root: Pick<BoundaryLocation, 'position_x' | 'position_y' | 'width' | 'depth'> | null | undefined): WarehouseBounds | null {
  if (!root) return null;
  const width = finiteOrNull(root.width);
  const depth = finiteOrNull(root.depth);
  if (width === null || depth === null || width <= 0 || depth <= 0) return null;
  return { x: finiteOrNull(root.position_x) ?? 0, y: finiteOrNull(root.position_y) ?? 0, width, depth };
}

/** Same rule as the shared floorObjects helper: explicit parent links only. */
export function isNestedAddress(location: Pick<BoundaryLocation, 'type' | 'parent_type'>): boolean {
  return location.type === 'bin' && (location.parent_type === 'bin' || location.parent_type === 'shelf');
}

/** Independent left, top, right and bottom overflow; display geometry only. */
function edgeOverflow(location: BoundaryLocation | null | undefined, bounds: WarehouseBounds | null): number[] {
  if (!location || !bounds || location.type === 'warehouse' || isNestedAddress(location)) return [0, 0, 0, 0];
  const x = finiteOrNull(location.position_x);
  const y = finiteOrNull(location.position_y);
  if (x === null || y === null) return [0, 0, 0, 0];
  const right = x + (finiteOrNull(location.width) ?? NULL_SIZE_COMPONENT_FOOTPRINT.width);
  const bottom = y + (finiteOrNull(location.depth) ?? NULL_SIZE_COMPONENT_FOOTPRINT.depth);
  return [Math.max(0, bounds.x - x), Math.max(0, bounds.y - y),
    Math.max(0, right - (bounds.x + bounds.width)), Math.max(0, bottom - (bounds.y + bounds.depth))]
    .map(value => value > BOUNDARY_EDGE_EPSILON ? value : 0);
}

/** Total overflow for reporting/tests, never used to trade violations between edges. */
export function boundaryOverflow(location: BoundaryLocation | null | undefined, bounds: WarehouseBounds | null): number {
  return edgeOverflow(location, bounds).reduce((total, value) => total + value, 0);
}

function anyEdgeWorsens(before: number[], after: number[]): boolean {
  return after.some((value, edge) => value > before[edge] + BOUNDARY_EDGE_EPSILON);
}

/** Component write: no existing violation may increase and no new edge may be violated. */
export function worsensBoundary(before: BoundaryLocation | null, after: BoundaryLocation, bounds: WarehouseBounds | null): boolean {
  return anyEdgeWorsens(edgeOverflow(before, bounds), edgeOverflow(after, bounds));
}

/** Root write: apply the same per-edge rule, including already-outside components.
 * Establishing the first boundary starts from zero overflow (GH-1176).
 * Removing dimensions leaves no boundary; no dimensions are fabricated.
 */
export function componentsNewlyExcluded(
  current: WarehouseBounds | null,
  next: WarehouseBounds | null,
  components: BoundaryLocation[],
): string[] {
  return components
    .filter(component => anyEdgeWorsens(edgeOverflow(component, current), edgeOverflow(component, next)))
    .map(component => component.location_code);
}

/** Actionable 422 with every affected location code. */
export class WarehouseBoundaryError extends Error {
  readonly statusCode = 422;
  constructor(readonly code: 'WAREHOUSE_BOUNDARY_EXCLUDES_COMPONENTS' | 'LOCATION_OUTSIDE_WAREHOUSE_BOUNDARY' | 'WAREHOUSE_BOUNDARY_ROOT_INVALID',
    readonly locationCodes: string[]) {
    super(code);
  }

  body() {
    return {
      error: this.code,
      message: this.code === 'WAREHOUSE_BOUNDARY_ROOT_INVALID'
        ? 'The configured warehouse root is inconsistent.'
        : this.code === 'WAREHOUSE_BOUNDARY_EXCLUDES_COMPONENTS'
        ? 'Existing mapped components would fall outside the warehouse boundary.'
        : 'Locations must stay inside the warehouse boundary.',
      location_codes: this.locationCodes,
    };
  }
}
