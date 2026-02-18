import type { Knex } from 'knex';
export declare function up(knex: Knex): Promise<void>;
/**
 * Absence of row = Not yet evaluated.
 * Presence of row = Durable eligibility fact.
 */
export declare function down(knex: Knex): Promise<void>;
//# sourceMappingURL=20260217191419_0046_create_expansion_eligibility_state.d.ts.map