// apps/backend/src/scripts/seed_reviewer_operators.ts
//
// REVIEWER OPERATOR SEED (OV-125a)
// --------------------------------
// Creates warehouse operators on the reviewer tenant so the live map can show
// more than one picker.
//
// WHY THIS EXISTS
// `pickerPositions` in the live-activity endpoint uses
// `distinctOn('psl.scanned_by')` — last scan per operator. Shop 1 had exactly
// one user (contact@lasyncro.com, the reviewer themself), so the floor map was
// structurally incapable of showing more than one dot no matter how many scans
// existed. A reviewer evaluating "live warehouse map" could not tell whether
// the single dot was the data or the product's ceiling.
//
// LOGIN IS DISABLED BY DESIGN
// These users exist for attribution (pick_scan_log.scanned_by, pick_batches
// .picked_by/.packed_by), not for sign-in. users.password_hash is NOT NULL, so
// a credential-free row is impossible; instead each gets a bcrypt hash of 32
// random bytes, which has no recoverable plaintext. This follows the existing
// ghost-user pattern in integration.controller.ts (~line 780).
//
// NOT USING THE MEMBERS INVITE ENDPOINT
// POST /members creates a member and SENDS AN INVITE EMAIL. These are invented
// addresses on a non-routable domain, so the invite would bounce or mail a
// domain we do not control. Seeding directly avoids that.
//
// CONSTRAINTS RESPECTED
// - users_email_unique is GLOBAL, not per-shop → @lasyncro.internal namespace
// - users_role_check    → role must be owner|admin|operator
// - shop_memberships_role_check → same three values
// - shop_memberships_shop_id_user_id_unique → onConflict merge
//
// ADDITIVE AND IDEMPOTENT — keyed on fixed emails. Re-runs reconcile
// memberships but never mutate batches or the append-only scan audit log.
// reconciled, and the same two batch/scan assignments are restored on re-run.
//
// Run:
// SEED_SHOP_ID=1 EXPECTED_DATABASE_NAME=synchroflow_db \
// EXPECTED_SHOP_NAME="Default Dev Shop" \
// npx tsx apps/backend/src/scripts/seed_reviewer_operators.ts

import db from '@lasyncro/backend-core/db.js';
import bcrypt from 'bcrypt';
import crypto from 'crypto';

const SHOP_ID_INPUT = process.env.SEED_SHOP_ID;
const SHOP_ID = Number(SHOP_ID_INPUT);
const EXPECTED_DATABASE_NAME = process.env.EXPECTED_DATABASE_NAME;
const EXPECTED_SHOP_NAME = process.env.EXPECTED_SHOP_NAME;

const log = (m: string) => console.log(`[OPERATOR_SEED] ${m}`);

/**
 * hourly_cost is set so WMS analytics cost-per-pick figures resolve to a real
 * number instead of null on the reviewer tenant. Values are plausible mid-range
 * warehouse rates, not a claim about any real market.
 */
const OPERATORS = [
  { first: 'Elin',  last: 'Vargas',  email: 'elin.vargas@lasyncro.internal',  hourly: 24.5 },
  { first: 'Marcus', last: 'Boateng', email: 'marcus.boateng@lasyncro.internal', hourly: 23.0 },
];

async function main(): Promise<void> {
  if (
    !SHOP_ID_INPUT ||
    !Number.isInteger(SHOP_ID) ||
    SHOP_ID <= 0 ||
    !EXPECTED_DATABASE_NAME ||
    !EXPECTED_SHOP_NAME
  ) {
    throw new Error(
      'SEED_SHOP_ID, EXPECTED_DATABASE_NAME, and EXPECTED_SHOP_NAME are required'
    );
  }

  const expectedDatabaseName = EXPECTED_DATABASE_NAME;
  const expectedShopName = EXPECTED_SHOP_NAME;

  log(`Starting — shop_id=${SHOP_ID}`);

  await db.transaction(async (trx) => {
    const identity = await trx.raw('SELECT current_database() AS database');
    const actualDatabase = identity.rows?.[0]?.database as string | undefined;

    if (actualDatabase !== expectedDatabaseName) {
      throw new Error(
        `Database mismatch: expected ${expectedDatabaseName}, received ${actualDatabase ?? 'unknown'}`
      );
    }

    await trx.raw(`SET LOCAL "app.current_tenant" = '${SHOP_ID}'`);

    const shop = await trx('shops').where({ id: SHOP_ID }).first();
    if (!shop) throw new Error(`Shop ${SHOP_ID} not found`);
    if (shop.name !== expectedShopName) {
      throw new Error(
        `Shop mismatch: expected ${expectedShopName}, received ${shop.name}`
      );
    }

    log(`Database: ${actualDatabase}`);
    log(`Shop: ${shop.name}`);

    const created: { id: number; name: string }[] = [];

    for (const op of OPERATORS) {
      // Email uniqueness is global — check without a shop_id filter, which is
      // exactly the bug that orphaned seed_reviewer.ts (it filtered by email
      // only and matched a user on another shop). Here the global check is
      // correct BECAUSE the constraint is global.
      const existing = await trx('users')
        .where({ email: op.email })
        .first('id', 'shop_id');

      let userId: number;

      if (existing) {
        if (Number(existing.shop_id) !== SHOP_ID) {
          throw new Error(
            `Cross-tenant email collision: ${op.email} belongs to shop ${existing.shop_id}`
          );
        }

        userId = Number(existing.id);

        await trx('users')
          .where({ id: userId, shop_id: SHOP_ID })
          .update({
            first_name: op.first,
            last_name: op.last,
            role: 'operator',
          });

        log(`Exists: ${op.email} (id=${userId})`);
      } else {
        // No recoverable plaintext — login via password is impossible.
        const ghostHash = await bcrypt.hash(
          crypto.randomBytes(32).toString('hex'),
          10
        );

        const [user] = await trx('users')
          .insert({
            shop_id: SHOP_ID,
            email: op.email,
            password_hash: ghostHash,
            first_name: op.first,
            last_name: op.last,
            role: 'operator',
            entry_channel: 'seed',
          })
          .returning(['id']);

        userId = Number(user.id);
        log(`Created: ${op.first} ${op.last} (id=${userId})`);
      }

      // Always reconcile membership so a partial or previously revoked seed
      // cannot leave an attribution-only user detached from the target shop.
      await trx('shop_memberships')
        .insert({
          shop_id: SHOP_ID,
          user_id: userId,
          role: 'operator',
          hourly_cost: op.hourly,
          display_currency: 'USD',
          locale: 'en-US',
          revoked_at: null,
        })
        .onConflict(['shop_id', 'user_id'])
        .merge({
          role: 'operator',
          hourly_cost: op.hourly,
          display_currency: 'USD',
          locale: 'en-US',
          revoked_at: null,
        });

      created.push({ id: userId, name: `${op.first} ${op.last}` });
    }

        if (created.length !== OPERATORS.length) {
      throw new Error(
        `Expected ${OPERATORS.length} operators, reconciled ${created.length}`
      );
    }

    // Batch and scan attribution belongs to seed_reviewer_activity.ts, where
    // immutable scan rows can be assigned correctly when first inserted.
    log(`Operators ready: ${created.map(operator => operator.name).join(', ')}`);
  });

  log('✅ Complete');
  await db.destroy();
}

main().catch((err) => {
  console.error('[OPERATOR_SEED] ❌ Failed:', err.message ?? err);
  process.exit(1);
});