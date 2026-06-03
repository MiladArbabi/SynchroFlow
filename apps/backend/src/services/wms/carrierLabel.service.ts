// apps/backend/src/services/wms/carrierLabel.service.ts
//
// WM-38 — Carrier Label Orchestrator
// ------------------------------------
// Single entry point for label generation across all carrier providers.
//
// Flow:
//   1. Read active carrier from shop_carrier_settings
//   2. Decrypt credentials (context: 'wms.carrier.sendcloud')
//   3. Resolve ICarrierProvider implementation
//   4. Call generateLabel()
//   5. Persist result to order_shipment_tracking
//
// Callers: wms.controller.ts POST /orders/:orderId/generate-label
// Consumed by: shopifyFulfillmentWriteback (trackingInfo),
//              Outbound module tracking column (WEB-PACK-02)

import { Knex } from 'knex';
import { decrypt } from '../../security/encryption.service.js';
import { sendcloudCarrierService } from './carriers/sendcloud.carrier.service.js';
import type { ICarrierProvider, GenerateLabelInput, GenerateLabelResult } from './carriers/ICarrierProvider.js';

const PROVIDERS: Record<string, ICarrierProvider> = {
  sendcloud: sendcloudCarrierService,
};

function resolveProvider(carrierCode: string): ICarrierProvider {
  const provider = PROVIDERS[carrierCode];
  if (!provider) throw new Error(`[CARRIER_LABEL] Unknown carrier: ${carrierCode}`);
  return provider;
}

export interface GenerateAndPersistLabelInput {
  shopId: number;
  lasyncroOrderId: string;
  pickBatchId: string | null;
  orderNumber: string;
  recipientName: string;
  address1: string;
  address2: string | null;
  city: string;
  postalCode: string;
  countryCode: string;
  weightGrams?: number;
}

export interface GenerateAndPersistLabelResult extends GenerateLabelResult {
  shipmentTrackingId: string;
}

export async function generateAndPersistLabel(
  trx: Knex.Transaction,
  input: GenerateAndPersistLabelInput
): Promise<GenerateAndPersistLabelResult> {
  const { shopId, lasyncroOrderId, pickBatchId } = input;

  // 1. Read active carrier settings
  const settings = await trx('shop_carrier_settings')
    .where({ shop_id: shopId, is_active: true })
    .first();

  if (!settings) {
    throw new Error('[CARRIER_LABEL] No active carrier configured for shop');
  }

  // 2. Decrypt credentials
  const decryptContext = `wms.carrier.${settings.carrier_code}` as 'wms.carrier.sendcloud';
  const publicKey  = decrypt(JSON.parse(settings.public_key),  decryptContext);
  const privateKey = decrypt(JSON.parse(settings.private_key), decryptContext);

  // 3. Resolve provider
  const provider = resolveProvider(settings.carrier_code);

  // 4. Generate label
  const labelInput: GenerateLabelInput = {
    shopId,
    lasyncroOrderId,
    pickBatchId,
    orderNumber:   input.orderNumber,
    recipientName: input.recipientName,
    address1:      input.address1,
    address2:      input.address2,
    city:          input.city,
    postalCode:    input.postalCode,
    countryCode:   input.countryCode,
    weightGrams:   input.weightGrams,
  };

  const result = await provider.generateLabel(labelInput, { publicKey, privateKey });

  // 5. Persist to order_shipment_tracking
  const [row] = await trx('order_shipment_tracking')
    .insert({
      shop_id:                  shopId,
      lasyncro_order_id:        lasyncroOrderId,
      pick_batch_id:            pickBatchId ?? null,
      carrier_code:             result.carrierCode,
      tracking_number:          result.trackingNumber,
      tracking_url:             result.trackingUrl,
      label_url:                result.labelUrl,
      label_pdf:                result.labelPdf ?? null,
      shipping_cost_excl_vat:   result.shippingCostExclVat ?? null,
      shipping_cost_currency:   result.shippingCostCurrency ?? null,
      carrier_zone:             result.carrierZone ?? null,
    })
    .returning('id');

  console.info('[CARRIER_LABEL_PERSISTED]', {
    lasyncroOrderId,
    shopId,
    carrierCode: result.carrierCode,
    trackingNumber: result.trackingNumber,
    shipmentTrackingId: row.id,
  });

  return { ...result, shipmentTrackingId: row.id };
}
