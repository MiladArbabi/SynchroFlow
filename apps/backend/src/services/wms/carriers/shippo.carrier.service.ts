// apps/backend/src/services/wms/carriers/shippo.carrier.service.ts
//
// Shippo Carrier Provider — implements ICarrierProvider using Shippo's
// REST API. Single API-token auth (Authorization: ShippoToken <token>),
// unlike Sendcloud's public/private key pair.
//
// Label generation flow:
//   POST /shipments  (address_from, address_to, parcel) → rates[]
//   → select cheapest rate (naive default — WM-44-style smart routing
//     is future scope, not built here)
//   POST /transactions { rate: <rate_id> } → label_url, tracking_number
//
// Credentials: merchant's own Shippo account token. Decrypted by
// carrierLabel.service.ts before this method is called.

import type { ICarrierProvider, GenerateLabelInput, GenerateLabelResult, CarrierCredentials } from './ICarrierProvider.js';

const SHIPPO_API_BASE = 'https://api.goshippo.com';

// LaSyncro's own sender address is required for every shipment — this
// needs to come from shop_operational_settings or similar, not
// hardcoded. Flagging as an open input rather than guessing at the
// right source table.
interface ShippoSenderAddress {
  name: string;
  street1: string;
  city: string;
  state: string;
  zip: string;
  country: string;
  phone: string;
}

export class ShippoCarrierService implements ICarrierProvider {
  readonly carrierCode = 'shippo';

  async generateLabel(
  input: GenerateLabelInput,
  credentials: CarrierCredentials
): Promise<GenerateLabelResult> {
  if (!credentials.apiToken) {
    throw new Error('[SHIPPO] Missing API token credential');
  }
  if (!input.senderAddress) {
    throw new Error('[SHIPPO] No sender address configured for this shop — add one in Settings → Carriers before generating Shippo labels');
  }

  if (!input.recipientPhone) {
    throw new Error('[SHIPPO] Recipient phone number is required to purchase a label — this order is missing shipping_phone');
  }

  const authHeader = `ShippoToken ${credentials.apiToken}`;
  const sender = input.senderAddress;

  const shipmentBody = {
    address_from: {
      name: sender.name,
      street1: sender.street1,
      street2: sender.street2 ?? '',
      city: sender.city,
      state: sender.state ?? '',
      zip: sender.postalCode,
      country: sender.countryCode,
      phone: sender.phone,
      email: sender.email,
    },
    address_to: {
      name: input.recipientName,
      street1: input.address1,
      street2: input.address2 ?? '',
      city: input.city,
      state: input.recipientState ?? '',
      zip: input.postalCode,
      country: input.countryCode,
      phone: input.recipientPhone,
    },
    parcels: [{
      length: '10', width: '10', height: '10', distance_unit: 'cm',
      weight: input.weightGrams ? (input.weightGrams / 1000).toString() : '1',
      mass_unit: 'kg',
    }],
    async: false,
  };

    const shipRes = await fetch(`${SHIPPO_API_BASE}/shipments/`, {
      method: 'POST',
      headers: { Authorization: authHeader, 'Content-Type': 'application/json' },
      body: JSON.stringify(shipmentBody),
      signal: AbortSignal.timeout(10000),
    });

    if (!shipRes.ok) {
      const text = await shipRes.text().catch(() => 'no body');
      throw new Error(`[SHIPPO] HTTP ${shipRes.status}: ${text}`);
    }

    const shipJson: any = await shipRes.json();
    console.info('[SHIPPO_SHIPMENT_RESPONSE_DEBUG]', JSON.stringify(shipJson, null, 2));
    const rates: any[] = shipJson?.rates ?? [];
    if (rates.length === 0) {
      throw new Error('[SHIPPO] No rates returned for shipment');
    }

    const sortedRates = [...rates].sort((a, b) => Number(a.amount) - Number(b.amount));

    let purchasedTx: any = null;
    let purchasedRate: any = null;
    const attemptErrors: Array<{ rateId: string; provider: string; reason: string }> = [];

    for (const rate of sortedRates) {
      const txRes = await fetch(`${SHIPPO_API_BASE}/transactions/`, {
        method: 'POST',
        headers: { Authorization: authHeader, 'Content-Type': 'application/json' },
        body: JSON.stringify({ rate: rate.object_id, label_file_type: 'PDF', async: false }),
        signal: AbortSignal.timeout(10000),
      });

      if (!txRes.ok) {
        const text = await txRes.text().catch(() => 'no body');
        attemptErrors.push({ rateId: rate.object_id, provider: rate.provider, reason: `HTTP ${txRes.status}: ${text}` });
        continue;
      }

      const tx: any = await txRes.json();

      if (tx.status === 'SUCCESS') {
        purchasedTx = tx;
        purchasedRate = rate;
        break;
      }

      const reason = JSON.stringify(tx.messages ?? tx);
      attemptErrors.push({ rateId: rate.object_id, provider: rate.provider, reason });
      console.warn('[SHIPPO_RATE_PURCHASE_FAILED_TRYING_NEXT]', {
        orderNumber: input.orderNumber,
        provider: rate.provider,
        servicelevel: rate.servicelevel?.name,
        reason,
      });
    }

    if (!purchasedTx) {
      throw new Error(`[SHIPPO] All ${sortedRates.length} rate(s) failed to purchase: ${JSON.stringify(attemptErrors)}`);
    }

    const tx = purchasedTx;
    const cheapest = purchasedRate;

    console.info('[SHIPPO_LABEL_GENERATED]', {
      orderNumber: input.orderNumber,
      trackingNumber: tx.tracking_number,
      hasLabelUrl: !!tx.label_url,
    });

    return {
      carrierCode: this.carrierCode,
      trackingNumber: tx.tracking_number ?? null,
      trackingUrl: tx.tracking_url_provider ?? null,
      labelUrl: tx.label_url ?? null,
      labelPdf: null,
      shippingCostExclVat: cheapest.amount != null ? Number(cheapest.amount) : null,
      shippingCostCurrency: cheapest.currency ?? null,
      carrierZone: cheapest.provider ?? null,
    };
  }
}

export const shippoCarrierService = new ShippoCarrierService();