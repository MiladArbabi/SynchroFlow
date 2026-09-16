// apps/backend/src/services/wms/carriers/sendcloud.carrier.service.ts
//
// WM-38 — Sendcloud Carrier Provider
// ------------------------------------
// Implements ICarrierProvider using Sendcloud's Shipping API v2.
//
// Label generation flow:
//   POST /api/v2/parcels  { request_label: true }
//   → returns parcel with label URL + tracking number
//
// Credentials: merchant's own Sendcloud public + private key pair.
// Decrypted by carrierLabel.service.ts before this method is called.
// Never stored in plaintext — decrypted only within request scope.
//
// Billing: charged to the merchant's Sendcloud account directly.
// LaSyncro incurs zero cost per label.
//
// Testing: use Sendcloud's "Unstamped letter" shipping_method_id (8)
// to generate labels without charge in sandbox.

import type {
  ICarrierProvider,
  GenerateLabelInput,
  GenerateLabelResult,
  CarrierCredentials,
  CarrierTrackingObservationInput,
  ProviderTrackingResult,
  ICarrierTrackingProvider,
} from './ICarrierProvider.js';

const SENDCLOUD_API_BASE = 'https://panel.sendcloud.sc/api/v2';
const SENDCLOUD_TRACKING_API_BASE = 'https://panel.sendcloud.sc/api/v3';

export class SendcloudCarrierService implements ICarrierProvider, ICarrierTrackingProvider {
  readonly carrierCode = 'sendcloud';

  async generateLabel(
  input: GenerateLabelInput,
  credentials: CarrierCredentials
): Promise<GenerateLabelResult> {
  if (!credentials.publicKey || !credentials.privateKey) {
    throw new Error('[SENDCLOUD] Missing public/private key credentials');
  }
  const { publicKey, privateKey } = credentials;
  // narrowed to string by the guard above, same as before the edit.
    const {
      orderNumber,
      recipientName,
      address1,
      address2,
      city,
      postalCode,
      countryCode,
      weightGrams,
    } = input;

    const authHeader = 'Basic ' + Buffer.from(
      `${credentials.publicKey}:${credentials.privateKey}`
    ).toString('base64');

    const body = {
      parcel: {
        name: recipientName,
        address: address1,
        address_2: address2 ?? '',
        city,
        postal_code: postalCode,
        country: countryCode,
        order_number: orderNumber,
        weight: weightGrams ? (weightGrams / 1000).toFixed(3) : '1.000',
        request_label: true,
        apply_shipping_rules: true,
      },
    };

    const res = await fetch(`${SENDCLOUD_API_BASE}/parcels`, {
      method: 'POST',
      headers: {
        'Authorization': authHeader,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10000),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => 'no body');
      throw new Error(`[SENDCLOUD] HTTP ${res.status}: ${text}`);
    }

    const json: any = await res.json();
    const parcel = json?.parcel;

    if (!parcel) {
      throw new Error('[SENDCLOUD] No parcel in response');
    }

    const trackingNumber: string | null      = parcel.tracking_number ?? null;
    const trackingUrl: string | null         = parcel.tracking_url ?? null;
    const labelUrl: string | null            = parcel.label?.label_printer ?? null;
    const shippingCostExclVat: number | null = parcel.price != null
      ? Number(parcel.price)
      : null;
    const shippingCostCurrency: string | null = parcel.currency ?? null;
    const carrierZone: string | null          = parcel.carrier?.name ?? parcel.contract?.name ?? null;

    console.info('[SENDCLOUD_LABEL_GENERATED]', {
      orderNumber,
      trackingNumber,
      hasLabelUrl: !!labelUrl,
      shippingCostExclVat,
      shippingCostCurrency,
    });

    return {
      carrierCode: this.carrierCode,
      trackingNumber,
      trackingUrl,
      labelUrl,
      labelPdf: null,
      shippingCostExclVat,
      shippingCostCurrency,
      carrierZone,
    };
  }

  async getTracking(
    input: CarrierTrackingObservationInput,
    credentials: CarrierCredentials
  ): Promise<ProviderTrackingResult> {
    if (!credentials.publicKey || !credentials.privateKey) {
      throw new Error(
        '[SENDCLOUD] Missing public/private key credentials'
      );
    }

    if (!input.trackingNumber) {
      throw new Error(
        '[SENDCLOUD] trackingNumber is required for tracking reads'
      );
    }

    const authHeader =
      'Basic ' +
      Buffer.from(
        `${credentials.publicKey}:${credentials.privateKey}`
      ).toString('base64');

    const url =
      `${SENDCLOUD_TRACKING_API_BASE}/parcels/tracking/` +
      encodeURIComponent(input.trackingNumber);

    const res = await fetch(url, {
      method: 'GET',
      headers: {
        Authorization: authHeader,
        'Content-Type': 'application/json',
      },
      signal: AbortSignal.timeout(10000),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => 'no body');
      throw new Error(
        `[SENDCLOUD] Tracking HTTP ${res.status}: ${body}`
      );
    }

    const json: any = await res.json();

    if (
      typeof json?.parent_status !== 'string' ||
      json.parent_status.length === 0
    ) {
      throw new Error(
        '[SENDCLOUD] Tracking response missing parent_status'
      );
    }

    const events: any[] = Array.isArray(json?.events)
      ? json.events
      : [];

    const validEvents = events
      .map((event) => ({
        timestamp:
          typeof event?.event_at === 'string'
            ? new Date(event.event_at)
            : null,
      }))
      .filter(
        (
          item
        ): item is {
          timestamp: Date;
        } =>
          item.timestamp instanceof Date &&
          !Number.isNaN(item.timestamp.getTime())
      )
      .sort(
        (a, b) =>
          a.timestamp.getTime() - b.timestamp.getTime()
      );

    const latestEvent = validEvents.at(-1);

    if (!latestEvent) {
      throw new Error(
        '[SENDCLOUD] Tracking response has no valid events[].event_at timestamp'
      );
    }

    return {
      rawStatus: json.parent_status,
      eventTimestamp: latestEvent.timestamp,
      location: null,
      rawPayload: json,
    };
  }

}

export const sendcloudCarrierService = new SendcloudCarrierService();
