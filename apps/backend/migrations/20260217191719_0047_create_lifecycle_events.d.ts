import type { Knex } from 'knex';
export declare function up(knex: Knex): Promise<void>;
/**
 * Append-only lifecycle backbone.
 * Replaces lifecycle_audit_events.
 * Supports multi-layer v2 state model.
 */
export declare function down(knex: Knex): Promise<void>;
//# sourceMappingURL=20260217191719_0047_create_lifecycle_events.d.ts.map