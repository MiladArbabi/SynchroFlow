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
