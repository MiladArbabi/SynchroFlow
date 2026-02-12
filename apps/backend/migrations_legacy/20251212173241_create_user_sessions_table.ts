import { Knex } from 'knex';
/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */

exports.up = function(knex: Knex) {
  return knex.schema.hasTable('user_sessions').then(exists => {
    if (!exists) {
      return knex.schema.createTable('user_sessions', t => {
        t.string('sid').notNullable().primary();
        t.json('sess').notNullable();
        t.timestamp('expire', { useTz: true }).notNullable();
      }).then(() => knex.raw('CREATE INDEX IF NOT EXISTS IDX_user_sessions_expire ON user_sessions (expire)'));
    }
  });
};

exports.down = function(knex: Knex) {
  return knex.schema.dropTableIfExists('user_sessions');
};
