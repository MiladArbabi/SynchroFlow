import db from '@lasyncro/backend-core/db.js';
import { v5 as uuidv5 } from 'uuid';

const RESERVATION_NAMESPACE =
  '2c6a4e3d-8b91-4f5a-a2d1-6f3e9b7c1042';

interface ReservationInput {
  shopId: number;
  lasyncroVariantId: string;
  locationCode: string;
  quantity: number; // positive integer
  referenceType: string;
  referenceId: string;
  occurredAt?: Date;
}

function buildEventId(
  shopId: number,
  variantId: string,
  locationCode: string,
  referenceId: string,
  type: 'reservation_hold' | 'reservation_release'
) {
  return uuidv5(
    `${shopId}:${variantId}:${locationCode}:${referenceId}:${type}`,
    RESERVATION_NAMESPACE
  );
}

/**
 * Reservation Hold
 * ----------------
 * quantity_delta MUST be negative.
 */
export async function writeReservationHold(
  input: ReservationInput
): Promise<void> {
  const {
    shopId,
    lasyncroVariantId,
    locationCode,
    quantity,
    referenceType,
    referenceId,
    occurredAt,
  } = input;

  if (quantity <= 0) {
    throw new Error('Reservation hold quantity must be positive.');
  }

  // 🔒 Availability Guard
  const truth = await db('inventory_truth')
    .where({
      shop_id: shopId,
      lasyncro_variant_id: lasyncroVariantId,
      location_code: locationCode,
    })
    .first();

  if (!truth) {
    throw new Error('Inventory truth not found for reservation hold.');
  }

  const available = Number(truth.available_quantity ?? 0);

  if (quantity > available) {
    throw new Error(
      `Reservation exceeds available inventory. Requested: ${quantity}, Available: ${available}`
    );
  }

  await db('inventory_movements')
    .insert({
      lasyncro_inventory_movement_id: crypto.randomUUID(),
      device_event_id: buildEventId(
        shopId,
        lasyncroVariantId,
        locationCode,
        referenceId,
        'reservation_hold'
      ),
      shop_id: shopId,
      lasyncro_variant_id: lasyncroVariantId,
      movement_type: 'reservation_hold',
      quantity_delta: -Math.abs(quantity),
      reference_type: referenceType,
      reference_id: referenceId,
      platform: null,
      location_code: locationCode,
      occurred_at: occurredAt ?? new Date(),
    })
    .onConflict(['device_event_id'])
    .ignore();
}

/**
 * Reservation Release
 * -------------------
 * quantity_delta MUST be positive.
 */
export async function writeReservationRelease(
  input: ReservationInput
): Promise<void> {
  const {
    shopId,
    lasyncroVariantId,
    locationCode,
    quantity,
    referenceType,
    referenceId,
    occurredAt,
  } = input;

  if (quantity <= 0) {
    throw new Error('Reservation release quantity must be positive.');
  }

  await db('inventory_movements')
    .insert({
      lasyncro_inventory_movement_id: crypto.randomUUID(),
      device_event_id: buildEventId(
        shopId,
        lasyncroVariantId,
        locationCode,
        referenceId,
        'reservation_release'
      ),
      shop_id: shopId,
      lasyncro_variant_id: lasyncroVariantId,
      movement_type: 'reservation_release',
      quantity_delta: Math.abs(quantity),
      reference_type: referenceType,
      reference_id: referenceId,
      platform: null,
      location_code: locationCode,
      occurred_at: occurredAt ?? new Date(),
    })
    .onConflict(['device_event_id'])
    .ignore();
}
