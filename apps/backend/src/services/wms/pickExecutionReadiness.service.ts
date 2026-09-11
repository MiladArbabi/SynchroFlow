import { Knex } from 'knex';
import type { BatchReservationAllocation } from './batchReservation.service.js';

export const PICK_SCAN_READINESS_REQUIRED = 'PICK_SCAN_READINESS_REQUIRED';

export class PickExecutionReadinessError extends Error {
  public readonly code = PICK_SCAN_READINESS_REQUIRED;
  public readonly lasyncroVariantId: string;
  public readonly locationCode: string;
  public readonly requiredQuantity: number;
  public readonly externalBarcodePresent: boolean;
  public readonly readyUnitCount: number;

  constructor(details: {
    lasyncroVariantId: string;
    locationCode: string;
    requiredQuantity: number;
    externalBarcodePresent: boolean;
    readyUnitCount: number;
  }) {
    super(PICK_SCAN_READINESS_REQUIRED);
    this.name = 'PickExecutionReadinessError';
    this.lasyncroVariantId = details.lasyncroVariantId;
    this.locationCode = details.locationCode;
    this.requiredQuantity = details.requiredQuantity;
    this.externalBarcodePresent = details.externalBarcodePresent;
    this.readyUnitCount = details.readyUnitCount;
    Object.setPrototypeOf(this, PickExecutionReadinessError.prototype);
  }
}

interface ReadinessRow {
  lasyncro_variant_id: string;
  location_code: string;
  external_barcode_present: boolean;
  ready_unit_count: number | string;
}

function allocationKey(allocation: BatchReservationAllocation): string {
  return `${allocation.lasyncroVariantId}:${allocation.locationCode}`;
}

export async function assertPickAllocationsScanReady(
  trx: Knex.Transaction,
  shopId: number,
  allocations: BatchReservationAllocation[]
): Promise<void> {
  if (allocations.length === 0) return;

  const result = await trx.raw(
    `
    WITH requested(lasyncro_variant_id, location_code) AS (
      SELECT DISTINCT
        x.lasyncro_variant_id::uuid,
        x.location_code::text
      FROM jsonb_to_recordset(?::jsonb) AS x(
        lasyncro_variant_id uuid,
        location_code text
      )
    )
    SELECT
      r.lasyncro_variant_id::text,
      r.location_code,
      NULLIF(BTRIM(COALESCE(v.barcode, '')), '') IS NOT NULL
        AS external_barcode_present,
      COALESCE(u.ready_unit_count, 0)::int AS ready_unit_count
    FROM requested r
    JOIN variants v
      ON v.shop_id = ?
     AND v.lasyncro_variant_id = r.lasyncro_variant_id
    LEFT JOIN LATERAL (
      SELECT COUNT(*)::int AS ready_unit_count
      FROM inventory_units iu
      WHERE iu.shop_id = ?
        AND iu.lasyncro_variant_id = r.lasyncro_variant_id
        AND iu.label_printed_at IS NOT NULL
        AND (
          (
            r.location_code = ?
            AND iu.status = 'received'
            AND iu.current_location_code IS NULL
          )
          OR
          (
            r.location_code <> ?
            AND iu.status = 'stowed'
            AND iu.current_location_code = r.location_code
          )
        )
    ) u ON TRUE
    `,
    [
      JSON.stringify(
        allocations.map((allocation) => ({
          lasyncro_variant_id: allocation.lasyncroVariantId,
          location_code: allocation.locationCode,
        }))
      ),
      shopId,
      shopId,
      `WH-${shopId}-ROOT`,
      `WH-${shopId}-ROOT`,
    ]
  );

  const readinessByAllocation = new Map<string, ReadinessRow>(
    (result.rows as ReadinessRow[]).map((row) => [
      `${row.lasyncro_variant_id}:${row.location_code}`,
      row,
    ])
  );

  for (const allocation of allocations) {
    const row = readinessByAllocation.get(allocationKey(allocation));
    const externalBarcodePresent = !!row?.external_barcode_present;
    const readyUnitCount = Number(row?.ready_unit_count ?? 0);

    if (
      !externalBarcodePresent &&
      readyUnitCount < allocation.quantity
    ) {
      throw new PickExecutionReadinessError({
        lasyncroVariantId: allocation.lasyncroVariantId,
        locationCode: allocation.locationCode,
        requiredQuantity: allocation.quantity,
        externalBarcodePresent,
        readyUnitCount,
      });
    }
  }
}
