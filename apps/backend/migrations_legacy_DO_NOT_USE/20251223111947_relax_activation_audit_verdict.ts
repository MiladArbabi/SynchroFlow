import type { Knex } from "knex";

export async function up(knex: Knex) {
  await knex.schema.alterTable('activation_audit_events', table => {
    table.string('verdict').nullable().alter();
  });
}

export async function down(knex: Knex) {
  await knex.schema.alterTable('activation_audit_events', table => {
    table.string('verdict').notNullable().alter();
  });
}
