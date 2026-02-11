/**
 * Canonical webhook envelope.
 *
 * This is the ONLY shape domain logic is allowed to consume.
 * Providers (Stripe, Shopify, etc) must adapt into this format.
 */
export interface WebhookEnvelope {
  // Transport identity
  integration: string;          // 'stripe' | 'shopify' | future
  eventId: string;              // provider event id
  eventType: string;            // provider event type

  // Verification
  verified: true;               // always true if handler runs

  // Timing
  receivedAt: Date;

  // Payload
  rawPayload: unknown;          // original parsed body

  // Routing metadata (optional, provider-specific)
  shopId?: number;
  shopDomain?: string;

  /**
   * Internal transport flag.
   * True only when envelope originates from queue worker.
   * Prevents re-enqueue loop.
   */
  __fromQueue?: true;
}

export interface WebhookDispatchJob {
  version: 1;

  // Identity (ledger-first)
  integration: string;
  eventId: string;
  eventType: string;

  // Payload
  rawPayload: unknown;

  // Routing metadata (optional, provider-specific)
  shopId?: number;
  shopDomain?: string;

  // Traceability
  enqueuedAt: string; // ISO string, not Date
}