import type { Knex } from 'knex';

/** Acquire before location row locks. Shared with the database write guard. */
export async function lockLocationHierarchy(trx: Knex.Transaction, shopId: number): Promise<void> {
  await trx.raw('SELECT pg_advisory_xact_lock(1305, ?)', [shopId]);
}

/** Database-owned validation also protects writers outside Floor Planning. */
export async function validateLocationHierarchy(
  trx: Knex.Transaction,
  location: { shopId: number; warehouseId: string; locationCode: string; parentCode: string | null; barcode: string | null }
): Promise<void> {
  await trx.raw('SELECT public.assert_location_integrity_1305(?, ?::uuid, ?, ?, ?)', [
    location.shopId, location.warehouseId, location.locationCode, location.parentCode, location.barcode,
  ]);
}

export function locationIntegrityError(error: unknown): string | null {
  const message = error instanceof Error ? error.message : '';
  return message.match(/LOCATION_(?:HIERARCHY_CYCLE|PARENT_INVALID|WAREHOUSE_INVALID|IDENTITY_COLLISION|ISOLATION_UNSUPPORTED|IDENTITY_IMMUTABLE)/)?.[0] ?? null;
}
