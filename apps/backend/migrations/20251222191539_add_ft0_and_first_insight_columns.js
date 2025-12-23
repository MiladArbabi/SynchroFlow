exports.up = async function (knex) {
  await knex.schema.alterTable('users', table => {
    table.string('orders_per_month_segment', 20);
  });

  await knex.schema.alterTable('activation_audit_events', table => {
    table.string('event_type', 255);
    table.string('derivation_version', 50);
    table.timestamp('evaluated_at');
    table.uuid('event_id');
    table.string('payload_hash', 64);
  });
};

exports.down = async function (knex) {
  await knex.schema.alterTable('users', table => {
    table.dropColumn('orders_per_month_segment');
  });

  await knex.schema.alterTable('activation_audit_events', table => {
    table.dropColumn('event_type');
    table.dropColumn('derivation_version');
    table.dropColumn('evaluated_at');
    table.dropColumn('event_id');
    table.dropColumn('payload_hash');
  });
};
