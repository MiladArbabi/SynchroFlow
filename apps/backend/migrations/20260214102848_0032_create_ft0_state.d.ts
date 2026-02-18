import { Knex } from 'knex';
/**
 * ============================================================
 * FT0 STATE (SOVEREIGN)
 * ============================================================
 *
 * Represents system-readiness completion per shop.
 *
 * Invariants:
 * - Exactly one row per shop
 * - Idempotent completion
 * - Completion is irreversible
 */
export declare function up(knex: Knex): Promise<void>;
export declare function down(knex: Knex): Promise<void>;
//# sourceMappingURL=20260214102848_0032_create_ft0_state.d.ts.map