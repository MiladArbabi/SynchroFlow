// apps/backend/src/services/wms/carriers/ICarrierProvider.ts
//
// WM-38 — Carrier Provider Interface
// ------------------------------------
// All carrier implementations must satisfy this contract.
// Nothing outside the carriers/ directory talks to a specific
// carrier directly — only to this interface.
//
// Adding a new carrier: create a new file implementing ICarrierProvider,
// register it in carrierLabel.service.ts resolveProvider().

export interface GenerateLabelInput {
  shopId: number;
  lasyncroOrderId: string;
  pickBatchId: string | null;
  recipientName: string;
  address1: string;
  address2: string | null;
  city: string;
  postalCode: string;
  countryCode: string;
  weightGrams?: number;
  orderNumber: string;
}

export interface GenerateLabelResult {
  carrierCode: string;
  trackingNumber: string | null;
  trackingUrl: string | null;
  labelUrl: string | null;
  labelPdf: Buffer | null;
}

export interface ICarrierProvider {
  readonly carrierCode: string;
  generateLabel(
    input: GenerateLabelInput,
    credentials: { publicKey: string; privateKey: string }
  ): Promise<GenerateLabelResult>;
}
