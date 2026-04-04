/**
 * CANONICAL EXTERNAL EVENT ID BUILDER
 * -----------------------------------
 * Guarantees:
 * - deterministic mapping from source → domain_event
 * - consistent deduplication boundary
 * - cross-layer traceability (webhook ↔ domain_events ↔ projections)
 *
 * FORMAT:
 *   <source>:<integration>:<eventId>[:<suffix>]
 *
 * Examples:
 *   webhook:shopify:abc123
 *   webhook:shopify:abc123:paid
 *   webhook:shopify:abc123:unsupported
 */
export function buildExternalEventId(params: {
  source: 'webhook' | 'system';
  integration: string;
  eventId: string;
  suffix?: string;
}): string {
  const base = `${params.source}:${params.integration}:${params.eventId}`;

  return params.suffix ? `${base}:${params.suffix}` : base;
}