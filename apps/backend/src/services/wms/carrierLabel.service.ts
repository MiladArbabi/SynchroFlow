// apps/backend/src/services/wms/carrierLabel.service.ts
//
// WM-38 — Carrier Label Orchestrator
// ------------------------------------
// Single entry point for label generation across all carrier providers.
//
// Flow:
//   1. Read active carrier from shop_carrier_settings
//   2. Resolve credentials via the shared carrierCredentials.service.ts seam
//   3. Resolve ICarrierProvider implementation
//   4. Call generateLabel(), then (Shippo only, best-effort) resolve the
//      canonical carrier token from the purchased carrier_account
//   5. Persist result to order_shipment_tracking
//
// Callers: wms.controller.ts POST /orders/:orderId/generate-label
// Consumed by: shopifyFulfillmentWriteback (trackingInfo),
// Outbound module tracking column (WEB-PACK-02)

import { Knex } from 'knex';
import { sendcloudCarrierService } from './carriers/sendcloud.carrier.service.js';
import type { ICarrierProvider, GenerateLabelInput, GenerateLabelResult } from './carriers/ICarrierProvider.js';
import { shippoCarrierService } from './carriers/shippo.carrier.service.js';
import { resolveCarrierCredentials } from './carriers/carrierCredentials.service.js';
import { email } from 'zod';

const PROVIDERS: Record<string, ICarrierProvider> = {
  sendcloud: sendcloudCarrierService,
  shippo: shippoCarrierService,
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
  recipientPhone: string | null;
  recipientState: string | null;
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

  // 2. Resolve credentials — shared seam (#1114 STEP 5C), also used by
  // carrier tracking reconciliation. Carrier selection above is unchanged;
  // this resolves the EXACT (shop_id, carrier_code) tuple already chosen.
  const { publicKey, privateKey, apiToken } = await resolveCarrierCredentials(trx, shopId, settings.carrier_code);

  // 2b. Look up sender address (only Shippo requires this today —
  // Sendcloud infers it from the merchant's own Sendcloud account)
  const senderAddressRow = await trx('shop_sender_addresses')
    .where({ shop_id: shopId, is_default: true })
    .first();

  const senderAddress = senderAddressRow
    ? {
        name: senderAddressRow.name,
        street1: senderAddressRow.street1,
        street2: senderAddressRow.street2 ?? null,
        city: senderAddressRow.city,
        state: senderAddressRow.state ?? null,
        postalCode: senderAddressRow.postal_code,
        countryCode: senderAddressRow.country_code,
        phone: senderAddressRow.phone,
        email: senderAddressRow.email ?? null,
      }
    : null;

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
    recipientState: input.recipientState,
    countryCode:   input.countryCode,
    weightGrams:   input.weightGrams,
    senderAddress,
    recipientPhone: input.recipientPhone,
  };

  const result = await provider.generateLabel(labelInput, { publicKey, privateKey, apiToken });

  // 4b. #1114 STEP 5C — best-effort canonical carrier token resolution.
  // The label above has ALREADY been successfully purchased: this lookup is
  // auxiliary reconciliation metadata, not part of the label-purchase
  // contract. Awaited inside this same transaction (using `trx` after this
  // function returns would be unsafe — it belongs to the caller's
  // transaction), with its failure caught and isolated locally so it can
  // NEVER turn a successful label purchase into a failed one. Never logs
  // credentials/decrypted settings — only safe structured identifiers.
  let providerCarrierCode: string | null = null;
  if (result.carrierCode === 'shippo' && result.providerCarrierAccountId != null) {
    try {
      providerCarrierCode = await shippoCarrierService.resolveCarrierCodeFromAccount(
        result.providerCarrierAccountId,
        { publicKey, privateKey, apiToken }
      );
    } catch (err) {
      console.warn('[SHIPPO_CARRIER_ACCOUNT_RESOLUTION_FAILED]', {
        shopId,
        lasyncroOrderId,
        providerCarrierAccountId: result.providerCarrierAccountId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

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
      provider_carrier_account_id: result.providerCarrierAccountId ?? null,
      provider_carrier_code:    providerCarrierCode,
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
