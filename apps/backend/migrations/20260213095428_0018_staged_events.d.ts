import type { Knex } from 'knex';
/**
 * STAGED EVENTS
 * -------------
 * Durable raw event buffer for:
 * - Shopify webhooks
 * - Replayable ingestion
 * - Deterministic worker processing
 *
 * This table is intentionally platform-agnostic.
 */
export declare function up(knex: Knex): Promise<void>;
export declare function down(knex: Knex): Promise<void>;
//# sourceMappingURL=20260213095428_0018_staged_events.d.ts.map