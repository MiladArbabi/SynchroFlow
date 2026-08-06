/**
 * SHOP-REV-02 — reservation half.
 *
 * The Shopify reviewer's store had zero bins and all stock unlocated at
 * WH-{shopId}-ROOT. Release returned 500 eleven times because the reservation
 * path filtered inventory to location type 'bin' only. buildBatchReservationAllocations
 * is pure, so the fix is testable without a tenant, RLS, or the FT2 lifecycle gate.
 *
 * location_rank: 0 = bin, 1 = warehouse root (batchReservation.service.ts:229).
 */
import { buildBatchReservationAllocations } from 'api-src/services/wms/batchReservation.service';

const VARIANT = '11111111-1111-1111-1111-111111111111';

describe('buildBatchReservationAllocations', () => {
  it('allocates from warehouse root when the tenant has no bins (reviewer shape)', () => {
    const allocations = buildBatchReservationAllocations(
      [{ lasyncro_variant_id: VARIANT, quantity: 3 }],
      [
        {
          lasyncro_variant_id: VARIANT,
          location_code: 'WH-1-ROOT',
          available_quantity: 40,
          location_rank: 1,
        },
      ] as any
    );

    expect(allocations).toEqual([
      { lasyncroVariantId: VARIANT, locationCode: 'WH-1-ROOT', quantity: 3 },
    ]);
  });

  it('consumes stowed bin stock before unlocated root stock', () => {
    const allocations = buildBatchReservationAllocations(
      [{ lasyncro_variant_id: VARIANT, quantity: 5 }],
      [
        {
          lasyncro_variant_id: VARIANT,
          location_code: 'WH-1-ROOT',
          available_quantity: 10,
          location_rank: 1,
        },
        {
          lasyncro_variant_id: VARIANT,
          location_code: 'A-1',
          available_quantity: 2,
          location_rank: 0,
        },
      ] as any
    );

    expect(allocations).toEqual([
      { lasyncroVariantId: VARIANT, locationCode: 'A-1', quantity: 2 },
      { lasyncroVariantId: VARIANT, locationCode: 'WH-1-ROOT', quantity: 3 },
    ]);
  });

  it('ranks bins first even when the bin code sorts after WH- alphabetically', () => {
    const allocations = buildBatchReservationAllocations(
      [{ lasyncro_variant_id: VARIANT, quantity: 1 }],
      [
        {
          lasyncro_variant_id: VARIANT,
          location_code: 'WH-1-ROOT',
          available_quantity: 5,
          location_rank: 1,
        },
        {
          lasyncro_variant_id: VARIANT,
          location_code: 'Z-9',
          available_quantity: 5,
          location_rank: 0,
        },
      ] as any
    );

    expect(allocations[0].locationCode).toBe('Z-9');
  });

  it('throws when combined bin and root stock is insufficient', () => {
    expect(() =>
      buildBatchReservationAllocations(
        [{ lasyncro_variant_id: VARIANT, quantity: 20 }],
        [
          {
            lasyncro_variant_id: VARIANT,
            location_code: 'WH-1-ROOT',
            available_quantity: 4,
            location_rank: 1,
          },
        ] as any
      )
    ).toThrow(/Insufficient pickable inventory/);
  });
});