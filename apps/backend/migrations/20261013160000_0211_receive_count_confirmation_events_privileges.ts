import type { Knex } from 'knex';

/** GH-1241 / S3-B security closure. Least privilege for 0209's append-only
 * receive_count_confirmation_events.
 *
 * 0209 granted sf_app SELECT, INSERT, but the schema default ACL for the
 * migration role (public, tables: sf_app=arwd) had already handed sf_app
 * UPDATE and DELETE. The row triggers still refused them; this removes the
 * privileges themselves so the history no longer depends on triggers alone.
 * 0209 is deployed and stays unchanged. Data, FORCE RLS, policy and
 * triggers are untouched.
 */
const LEAST_PRIVILEGE = `
  REVOKE ALL ON receive_count_confirmation_events FROM sf_app;
  GRANT SELECT, INSERT ON receive_count_confirmation_events TO sf_app;
`;

export async function up(knex: Knex): Promise<void> {
  await knex.raw(LEAST_PRIVILEGE);
}

export async function down(knex: Knex): Promise<void> {
  // Security is monotonic: rolling 0211 back never re-grants UPDATE/DELETE.
  // Least privilege is re-asserted instead of refusing, so earlier rollbacks
  // (0210, 0209) that must pass through this step remain possible; 0209's own
  // down drops the table once its evidence guard allows it.
  await knex.raw(LEAST_PRIVILEGE);
}
