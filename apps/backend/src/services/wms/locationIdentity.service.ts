import type { Knex } from 'knex';

export class LocationIdentityAmbiguousError extends Error {
  readonly statusCode = 409;
  readonly errorCode = 'LOCATION_IDENTITY_AMBIGUOUS';
  constructor() { super('LOCATION_IDENTITY_AMBIGUOUS'); }
}

/** Resolve identity before eligibility filtering, including inactive locations.
 * A code and override on the same row are one identity; two rows are ambiguous.
 * Preserve exact legacy scan matching; do not normalize merchant barcodes.
 */
export async function resolveLocationIdentity(trx: Knex.Transaction, shopId: number, scannedValue: string) {
  const matches = await trx('warehouse_locations')
    .where({ shop_id: shopId })
    .where((qb) => qb.where('location_code', scannedValue).orWhere('barcode', scannedValue))
    .limit(2);
  if (matches.length > 1) throw new LocationIdentityAmbiguousError();
  return matches[0] ?? null;
}
