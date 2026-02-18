import type { Knex } from 'knex';
export declare function up(knex: Knex): Promise<void>;
/**
 * Absence of row = UNREADY
 * Presence of row = READY
 *
 * READY is irreversible.
 */
export declare function down(knex: Knex): Promise<void>;
//# sourceMappingURL=20260217190645_0045_create_system_readiness_state.d.ts.map