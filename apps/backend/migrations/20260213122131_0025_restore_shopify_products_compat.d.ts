/**
 * TEMPORARY COMPATIBILITY TABLE
 *
 * This table exists only to support the legacy Shopify worker.
 *
 * Architectural note:
 * Long-term target is sovereign products + external_product_identity_map.
 * See GitHub issue: Refactor product ingestion to sovereign model.
 *
 * DO NOT extend this table further.
 */
import type { Knex } from 'knex';
export declare function up(knex: Knex): Promise<void>;
export declare function down(knex: Knex): Promise<void>;
//# sourceMappingURL=20260213122131_0025_restore_shopify_products_compat.d.ts.map