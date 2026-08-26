// RECOUNT-CLAIM-ABANDONED-131
//
// CONTRACT-REASSIGN-01: owner/admin allowed, operator denied, server-enforced.
// CONTRACT-REASSIGN-02: claimed/counting allowed; dispatched/manual_review/
//   committed/cancelled rejected.
// CONTRACT-REASSIGN-03: atomic ownership transition, resolved state untouched.
// CONTRACT-REASSIGN-04: target must exist, be same-shop, active, permitted.
// CONTRACT-REASSIGN-05: exactly one recount_reassign audit event.
// CONTRACT-REASSIGN-06: old claimant loses mutation authority; new claimant
//   can continue.
// CONTRACT-REASSIGN-07: reassignment commit cannot be raced by a concurrent
//   old-claimant mutation.

import request from 'supertest';
import crypto from 'crypto';
import { createApp } from 'api-src/bootstrap/express';
import db, {
  withTenant,
  systemTransaction,
  setTenantContext,
} from '@lasyncro/backend-core/db.js';
import { createTenantShop } from '@lasyncro/backend-core/services/pre-tenant.service.js';
import { issueTestToken } from '../../unit/helpers/auth';
import { recordCount, reassignRecountTask } from 'api-src/services/wms/inventoryRecount.service';

const app = createApp();

function createDeferred<T = void>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

/** Bounded poll-until-condition — orchestration-only (which order to start
 * things in), never the mechanism that decides correctness of the final
 * asserted DB state. */
async function waitUntil(
  predicate: () => boolean,
  { timeoutMs = 2000, intervalMs = 5 }: { timeoutMs?: number; intervalMs?: number } = {}
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() > deadline) {
      throw new Error('waitUntil: condition was not met before the timeout');
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}

/**
 * Deterministic DB-level confirmation that a SECOND backend is genuinely
 * blocked waiting on a Postgres lock (pg_stat_activity.wait_event_type =
 * 'Lock') — not a guess based on timing. Polling is only how the test
 * OBSERVES the block; the block itself is a real row lock held by the
 * still-open reassignment transaction.
 */
async function waitForBlockedLockWaiter(shopId: number): Promise<boolean> {
  const deadline = Date.now() + 2000;
  while (Date.now() < deadline) {
    // pg_stat_activity is a cluster-wide system view, unrelated to tenant
    // data — withTenant is used here purely to satisfy the app-level
    // tenant-context guard on the query path, not because this query reads
    // any tenant-scoped table.
    const result = await withTenant(shopId, (trx) =>
      trx.raw(
        `SELECT count(*)::int AS blocked FROM pg_stat_activity
         WHERE wait_event_type = 'Lock' AND pid <> pg_backend_pid()`
      )
    );
    const blocked = Number(result.rows?.[0]?.blocked ?? 0);
    if (blocked > 0) return true;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  return false;
}

type Fixture = {
  shopId: number;
  warehouseId: string;
  variantId: string;
  ownerId: number;
  adminId: number;
  operatorAId: number;
  operatorBId: number;
  revokedOperatorId: number;
  ownerToken: string;
  adminToken: string;
  operatorAToken: string;
  operatorBToken: string;
};

async function createOperator(
  shopId: number,
  unique: string,
  label: string,
  role: 'owner' | 'admin' | 'operator',
  opts: { revoked?: boolean } = {}
): Promise<number> {
  const userId = await withTenant(shopId, async (trx) => {
    const [row] = await trx('users')
      .insert({
        shop_id: shopId,
        email: `reassign-${label}-${unique}@test.example`,
        password_hash: 'not_a_real_hash',
        first_name: label,
        role,
      })
      .returning('id');
    return row.id as number;
  });

  await withTenant(shopId, async (trx) => {
    await trx('shop_memberships').insert({
      shop_id: shopId,
      user_id: userId,
      role,
      revoked_at: opts.revoked ? new Date() : null,
    });
  });

  return userId;
}

async function createFixture(): Promise<Fixture> {
  const unique = crypto.randomBytes(6).toString('hex');

  const shopId = await systemTransaction(async (trx) => {
    const id = await createTenantShop(trx, `recount-reassign-${unique}`);
    await setTenantContext(trx, id);
    return id;
  });

  const ownerId = await createOperator(shopId, unique, 'owner', 'owner');
  const adminId = await createOperator(shopId, unique, 'admin', 'admin');
  const operatorAId = await createOperator(shopId, unique, 'opA', 'operator');
  const operatorBId = await createOperator(shopId, unique, 'opB', 'operator');
  const revokedOperatorId = await createOperator(
    shopId,
    unique,
    'revoked',
    'operator',
    { revoked: true }
  );

  await withTenant(shopId, async (trx) => {
    await trx('shop_subscriptions').insert({
      shop_id: shopId,
      tier: 'core',
      allow_overage: true,
      billing_provider: 'stripe',
      stripe_customer_id: null,
    });

    await trx('shop_wms_settings').insert({ shop_id: shopId });

    // user_lifecycle_snapshot is SHOP-scoped (PK is shop_id alone) — one row
    // per shop, not per user (user_id is retained for audit reference only).
    await trx('user_lifecycle_snapshot').insert({
      shop_id: shopId,
      user_id: ownerId,
      phase: 'FT2',
      since: new Date(),
      last_event_id: crypto.randomUUID(),
    });
  });

  const warehouseId = crypto.randomUUID();
  const rootCode = `WH-${shopId}-ROOT`;

  await withTenant(shopId, async (trx) => {
    await trx('warehouses').insert({
      warehouse_id: warehouseId,
      shop_id: shopId,
      name: 'Main warehouse',
      root_location_code: rootCode,
      is_default: true,
      active: true,
    });

    await trx('warehouse_locations').insert([
      {
        shop_id: shopId,
        warehouse_id: warehouseId,
        location_code: rootCode,
        type: 'warehouse',
        parent_location_code: null,
        active: true,
        zone_type: null,
      },
      {
        shop_id: shopId,
        warehouse_id: warehouseId,
        location_code: 'A-1',
        type: 'bin',
        parent_location_code: rootCode,
        active: true,
        zone_type: 'pick',
      },
    ]);
  });

  const productId = crypto.randomUUID();
  const variantId = crypto.randomUUID();

  await withTenant(shopId, async (trx) => {
    await trx('products').insert({
      lasyncro_product_id: productId,
      shop_id: shopId,
      title: 'Reassignment fixture product',
      status: 'active',
      product_type: 'physical',
    });

    await trx('variants').insert({
      lasyncro_variant_id: variantId,
      lasyncro_product_id: productId,
      shop_id: shopId,
      sku: `REASSIGN-${unique}`,
      title: 'Variant 1',
      unit_cost: '1.00',
      status: 'active',
    });

    await trx.raw(`SET LOCAL "synchroflow.projection" = 'true'`);
    await trx('inventory_truth').insert({
      shop_id: shopId,
      lasyncro_variant_id: variantId,
      location_code: 'A-1',
      on_hand_quantity: 5,
      reserved_quantity: 0,
      committed_quantity: 0,
      available_quantity: 5,
      last_evaluated_at: new Date(),
    });
  });

  return {
    shopId,
    warehouseId,
    variantId,
    ownerId,
    adminId,
    operatorAId,
    operatorBId,
    revokedOperatorId,
    ownerToken: issueTestToken({ userId: ownerId, shopId, tier: 'core', roles: ['owner'] }),
    adminToken: issueTestToken({ userId: adminId, shopId, tier: 'core', roles: ['admin'] }),
    operatorAToken: issueTestToken({ userId: operatorAId, shopId, tier: 'core', roles: ['operator'] }),
    operatorBToken: issueTestToken({ userId: operatorBId, shopId, tier: 'core', roles: ['operator'] }),
  };
}

async function createTask(
  fixture: Fixture,
  status: 'dispatched' | 'claimed' | 'counting' | 'manual_review' | 'committed' | 'cancelled',
  opts: { claimedBy?: number | null } = {}
): Promise<string> {
  const claimedBy = opts.claimedBy === undefined
    ? (status === 'dispatched' ? null : fixture.operatorAId)
    : opts.claimedBy;

  const taskId = await withTenant(fixture.shopId, async (trx) => {
    const [row] = await trx('inventory_recount_tasks')
      .insert({
        shop_id: fixture.shopId,
        warehouse_id: fixture.warehouseId,
        label: `CNT-REASSIGN-${crypto.randomBytes(4).toString('hex')}`,
        scope: 'location',
        status,
        blind: true,
        assigned_to: null,
        created_by: fixture.ownerId,
        claimed_by: claimedBy,
        claimed_at: claimedBy ? new Date() : null,
        claim_generation: claimedBy ? crypto.randomUUID() : null,
      })
      .returning(['recount_task_id']);
    return row.recount_task_id as string;
  });

  await withTenant(fixture.shopId, async (trx) => {
    await trx('inventory_recount_lines').insert({
      shop_id: fixture.shopId,
      recount_task_id: taskId,
      lasyncro_variant_id: fixture.variantId,
      location_code: 'A-1',
      expected_quantity: 5,
    });
  });

  return taskId;
}

describe('RECOUNT-CLAIM-ABANDONED-131 reassignment', () => {
  let fixture: Fixture;

  beforeAll(async () => {
    fixture = await createFixture();
  });

  describe('CONTRACT-REASSIGN-01: authorization', () => {
    it('owner may reassign a claimed task', async () => {
      const taskId = await createTask(fixture, 'claimed');
      const response = await request(app)
        .post(`/api/v1/wms/recount-tasks/${taskId}/reassign`)
        .set('Authorization', `Bearer ${fixture.ownerToken}`)
        .send({ target_user_id: fixture.operatorBId });

      expect(response.status).toBe(200);
      expect(response.body?.task?.new_claimed_by).toBe(fixture.operatorBId);
    });

    it('admin may reassign a claimed task', async () => {
      const taskId = await createTask(fixture, 'claimed');
      const response = await request(app)
        .post(`/api/v1/wms/recount-tasks/${taskId}/reassign`)
        .set('Authorization', `Bearer ${fixture.adminToken}`)
        .send({ target_user_id: fixture.operatorBId });

      expect(response.status).toBe(200);
    });

    it('operator is denied — server-enforced, not client-trusted', async () => {
      const taskId = await createTask(fixture, 'claimed');
      const response = await request(app)
        .post(`/api/v1/wms/recount-tasks/${taskId}/reassign`)
        .set('Authorization', `Bearer ${fixture.operatorAToken}`)
        .send({ target_user_id: fixture.operatorBId });

      expect(response.status).toBe(403);

      const task = await withTenant(fixture.shopId, (trx) =>
        trx('inventory_recount_tasks')
          .where({ shop_id: fixture.shopId, recount_task_id: taskId })
          .first('claimed_by')
      );
      expect(task.claimed_by).toBe(fixture.operatorAId);
    });

    it('operator is still denied even if shop config grants the permission — trusted-role guard is independent of the configurable permission map', async () => {
      // Isolated fresh shop — this test deliberately mutates
      // shop_role_permissions and must not leak that override into any
      // other test's use of the shared `fixture`.
      const isolatedFixture = await createFixture();
      const taskId = await createTask(isolatedFixture, 'claimed');

      // Deliberately misconfigure the shop's permission map to grant
      // 'operator' the reassignment action — this is the exact scenario the
      // trusted-role guard (httpReassignRecountTask, independent of
      // requireAction/isActionAllowed) exists to withstand.
      await withTenant(isolatedFixture.shopId, (trx) =>
        trx('shop_role_permissions').insert({
          shop_id: isolatedFixture.shopId,
          action: 'wms:recount:reassign',
          role: 'operator',
          granted: true,
        })
      );

      const response = await request(app)
        .post(`/api/v1/wms/recount-tasks/${taskId}/reassign`)
        .set('Authorization', `Bearer ${isolatedFixture.operatorAToken}`)
        .send({ target_user_id: isolatedFixture.operatorBId });

      expect(response.status).toBe(403);

      const task = await withTenant(isolatedFixture.shopId, (trx) =>
        trx('inventory_recount_tasks')
          .where({ shop_id: isolatedFixture.shopId, recount_task_id: taskId })
          .first('claimed_by')
      );
      expect(task.claimed_by).toBe(isolatedFixture.operatorAId);
    });

    it('owner is denied when shop config explicitly revokes the permission — requireAction remains an active gate, not bypassed', async () => {
      const isolatedFixture = await createFixture();
      const taskId = await createTask(isolatedFixture, 'claimed');

      await withTenant(isolatedFixture.shopId, (trx) =>
        trx('shop_role_permissions').insert({
          shop_id: isolatedFixture.shopId,
          action: 'wms:recount:reassign',
          role: 'owner',
          granted: false,
        })
      );

      const response = await request(app)
        .post(`/api/v1/wms/recount-tasks/${taskId}/reassign`)
        .set('Authorization', `Bearer ${isolatedFixture.ownerToken}`)
        .send({ target_user_id: isolatedFixture.operatorBId });

      expect(response.status).toBe(403);
    });
  });

  describe('CONTRACT-REASSIGN-02: state eligibility', () => {
    it.each([
      ['claimed', 200],
      ['counting', 200],
      ['dispatched', 409],
      ['manual_review', 409],
      ['committed', 409],
      ['cancelled', 409],
    ] as const)('%s -> %d', async (status, expectedStatus) => {
      const taskId = await createTask(fixture, status);
      const response = await request(app)
        .post(`/api/v1/wms/recount-tasks/${taskId}/reassign`)
        .set('Authorization', `Bearer ${fixture.ownerToken}`)
        .send({ target_user_id: fixture.operatorBId });

      expect(response.status).toBe(expectedStatus);
    });
  });

  describe('CONTRACT-REASSIGN-03: atomic ownership transition', () => {
    it('updates ownership and generation, preserves status and resolved state', async () => {
      const taskId = await createTask(fixture, 'counting');

      // Resolve one line by count, add a second unresolved line, and skip
      // would require a second line — add two more lines directly so the
      // fixture has a counted line, a skipped line, and an unresolved line.
      const [countedLine, skippedLine] = await withTenant(fixture.shopId, async (trx) => {
        const rows = await trx('inventory_recount_lines')
          .insert([
            {
              shop_id: fixture.shopId,
              recount_task_id: taskId,
              lasyncro_variant_id: fixture.variantId,
              location_code: 'A-1',
              expected_quantity: 5,
              counted_quantity: 5,
              variance: 0,
              counted_by: fixture.operatorAId,
              counted_at: new Date(),
            },
            {
              shop_id: fixture.shopId,
              recount_task_id: taskId,
              lasyncro_variant_id: fixture.variantId,
              location_code: 'A-1',
              expected_quantity: 5,
              skip_reason: 'bin_inaccessible',
              skipped_by: fixture.operatorAId,
              skipped_at: new Date(),
            },
          ])
          .returning(['recount_line_id', 'counted_at', 'skip_reason']);
        return rows;
      });

      await withTenant(fixture.shopId, (trx) =>
        trx('inventory_recount_findings').insert({
          shop_id: fixture.shopId,
          recount_task_id: taskId,
          lasyncro_variant_id: fixture.variantId,
          location_code: 'A-1',
          finding_type: 'unexpected_item',
          quantity: 1,
          reported_by: fixture.operatorAId,
        })
      );

      const before = await withTenant(fixture.shopId, (trx) =>
        trx('inventory_recount_tasks')
          .where({ shop_id: fixture.shopId, recount_task_id: taskId })
          .first('claim_generation', 'claimed_at')
      );
      const findingsBefore = await withTenant(fixture.shopId, (trx) =>
        trx('inventory_recount_findings')
          .where({ shop_id: fixture.shopId, recount_task_id: taskId })
      );

      const response = await request(app)
        .post(`/api/v1/wms/recount-tasks/${taskId}/reassign`)
        .set('Authorization', `Bearer ${fixture.ownerToken}`)
        .send({ target_user_id: fixture.operatorBId });

      expect(response.status).toBe(200);

      const after = await withTenant(fixture.shopId, (trx) =>
        trx('inventory_recount_tasks')
          .where({ shop_id: fixture.shopId, recount_task_id: taskId })
          .first('status', 'claimed_by', 'assigned_to', 'claimed_at', 'claim_generation')
      );

      expect(after.status).toBe('counting');
      expect(after.claimed_by).toBe(fixture.operatorBId);
      expect(after.assigned_to).toBe(fixture.operatorBId);
      expect(after.claim_generation).not.toBe(before.claim_generation);
      // claimed_at changed (a fresh trx.fn.now() write) — not asserting
      // strictly-later, since the fixture's claimed_at is set from the test
      // process's JS clock while this is Postgres's transaction timestamp;
      // claim_generation is the authoritative "did a new claim happen" proof.
      expect(new Date(after.claimed_at).getTime()).not.toBe(
        new Date(before.claimed_at).getTime()
      );

      const lines = await withTenant(fixture.shopId, (trx) =>
        trx('inventory_recount_lines')
          .where({ shop_id: fixture.shopId, recount_task_id: taskId })
          .select('recount_line_id', 'counted_at', 'skip_reason', 'counted_quantity')
      );
      const stillCounted = lines.find((l) => l.recount_line_id === countedLine.recount_line_id);
      const stillSkipped = lines.find((l) => l.recount_line_id === skippedLine.recount_line_id);
      const unresolved = lines.filter(
        (l) => l.counted_at === null && l.skip_reason === null
      );

      expect(stillCounted.counted_at).not.toBeNull();
      expect(stillCounted.counted_quantity).toBe(5);
      expect(stillSkipped.skip_reason).toBe('bin_inaccessible');
      expect(unresolved.length).toBe(1); // the original fixture line, untouched

      const findingsAfter = await withTenant(fixture.shopId, (trx) =>
        trx('inventory_recount_findings')
          .where({ shop_id: fixture.shopId, recount_task_id: taskId })
      );
      expect(findingsAfter.length).toBe(findingsBefore.length);
    });
  });

  describe('CONTRACT-REASSIGN-04: target validation', () => {
    it('rejects a nonexistent target user', async () => {
      const taskId = await createTask(fixture, 'claimed');
      const response = await request(app)
        .post(`/api/v1/wms/recount-tasks/${taskId}/reassign`)
        .set('Authorization', `Bearer ${fixture.ownerToken}`)
        .send({ target_user_id: 999999999 });

      expect(response.status).toBe(400);
    });

    it('rejects a target belonging to a different shop', async () => {
      const otherFixture = await createFixture();
      const taskId = await createTask(fixture, 'claimed');
      const response = await request(app)
        .post(`/api/v1/wms/recount-tasks/${taskId}/reassign`)
        .set('Authorization', `Bearer ${fixture.ownerToken}`)
        .send({ target_user_id: otherFixture.operatorAId });

      expect(response.status).toBe(400);
    });

    it('rejects a target with a revoked membership', async () => {
      const taskId = await createTask(fixture, 'claimed');
      const response = await request(app)
        .post(`/api/v1/wms/recount-tasks/${taskId}/reassign`)
        .set('Authorization', `Bearer ${fixture.ownerToken}`)
        .send({ target_user_id: fixture.revokedOperatorId });

      expect(response.status).toBe(400);
    });
  });

  describe('CONTRACT-REASSIGN-05: audit trail', () => {
    it('writes exactly one recount_reassign event with the expected fields', async () => {
      const taskId = await createTask(fixture, 'claimed');

      const response = await request(app)
        .post(`/api/v1/wms/recount-tasks/${taskId}/reassign`)
        .set('Authorization', `Bearer ${fixture.ownerToken}`)
        .send({ target_user_id: fixture.operatorBId });

      expect(response.status).toBe(200);

      const events = await withTenant(fixture.shopId, (trx) =>
        trx('operator_audit_log')
          .where({
            shop_id: fixture.shopId,
            entity_type: 'recount_task',
            entity_id: taskId,
            action_type: 'recount_reassign',
          })
          .select('operator_id', 'metadata')
      );

      expect(events.length).toBe(1);
      expect(events[0].operator_id).toBe(fixture.ownerId);
      const metadata = typeof events[0].metadata === 'string'
        ? JSON.parse(events[0].metadata)
        : events[0].metadata;
      expect(metadata.previous_claimant).toBe(fixture.operatorAId);
      expect(metadata.new_claimant).toBe(fixture.operatorBId);
    });
  });

  describe('CONTRACT-REASSIGN-06: old claimant loses mutation authority', () => {
    it('recordCount is rejected for the old claimant after reassignment', async () => {
      const taskId = await createTask(fixture, 'counting');
      const line = await withTenant(fixture.shopId, (trx) =>
        trx('inventory_recount_lines')
          .where({ shop_id: fixture.shopId, recount_task_id: taskId })
          .first('recount_line_id')
      );

      await request(app)
        .post(`/api/v1/wms/recount-tasks/${taskId}/reassign`)
        .set('Authorization', `Bearer ${fixture.ownerToken}`)
        .send({ target_user_id: fixture.operatorBId });

      const staleAttempt = await request(app)
        .post(`/api/v1/wms/recount-tasks/${taskId}/lines/${line.recount_line_id}/count`)
        .set('Authorization', `Bearer ${fixture.operatorAToken}`)
        .send({ counted_quantity: 5, count_method: 'unit_scan' });

      expect(staleAttempt.status).toBe(409);
      expect(staleAttempt.body?.code).toBe('RECOUNT_OWNERSHIP_CHANGED');
    });

    it('skipLine and closeCount are rejected for the old claimant after reassignment', async () => {
      const taskId = await createTask(fixture, 'counting');
      const line = await withTenant(fixture.shopId, (trx) =>
        trx('inventory_recount_lines')
          .where({ shop_id: fixture.shopId, recount_task_id: taskId })
          .first('recount_line_id')
      );

      await request(app)
        .post(`/api/v1/wms/recount-tasks/${taskId}/reassign`)
        .set('Authorization', `Bearer ${fixture.ownerToken}`)
        .send({ target_user_id: fixture.operatorBId });

      const skipAttempt = await request(app)
        .post(`/api/v1/wms/recount-tasks/${taskId}/lines/${line.recount_line_id}/skip`)
        .set('Authorization', `Bearer ${fixture.operatorAToken}`)
        .send({ skip_reason: 'bin_not_found' });
      expect(skipAttempt.status).toBe(409);

      const closeAttempt = await request(app)
        .post(`/api/v1/wms/recount-tasks/${taskId}/close`)
        .set('Authorization', `Bearer ${fixture.operatorAToken}`)
        .send({});
      expect(closeAttempt.status).toBe(409);
    });

    it('the new claimant can continue remaining work', async () => {
      const taskId = await createTask(fixture, 'counting');
      const line = await withTenant(fixture.shopId, (trx) =>
        trx('inventory_recount_lines')
          .where({ shop_id: fixture.shopId, recount_task_id: taskId })
          .first('recount_line_id')
      );

      await request(app)
        .post(`/api/v1/wms/recount-tasks/${taskId}/reassign`)
        .set('Authorization', `Bearer ${fixture.ownerToken}`)
        .send({ target_user_id: fixture.operatorBId });

      const response = await request(app)
        .post(`/api/v1/wms/recount-tasks/${taskId}/lines/${line.recount_line_id}/count`)
        .set('Authorization', `Bearer ${fixture.operatorBToken}`)
        .send({ counted_quantity: 5, count_method: 'unit_scan' });

      expect(response.status).toBe(200);
    });
  });

  describe('CONTRACT-REASSIGN-07: concurrency / race safety', () => {
    it('an old-claimant mutation cannot commit after reassignment commits', async () => {
      const taskId = await createTask(fixture, 'counting');
      const line = await withTenant(fixture.shopId, (trx) =>
        trx('inventory_recount_lines')
          .where({ shop_id: fixture.shopId, recount_task_id: taskId })
          .first('recount_line_id')
      );

      // Reassignment commits fully (its own transaction) BEFORE the old
      // claimant's request is issued — recordCount's FOR UPDATE read then
      // deterministically observes the post-reassignment claimed_by, so
      // there is no sleep-dependent race window to simulate: the invariant
      // under test is that recordCount always re-reads claimed_by inside
      // its own locked transaction rather than trusting a stale value.
      const reassignResponse = await request(app)
        .post(`/api/v1/wms/recount-tasks/${taskId}/reassign`)
        .set('Authorization', `Bearer ${fixture.ownerToken}`)
        .send({ target_user_id: fixture.operatorBId });
      expect(reassignResponse.status).toBe(200);

      const oldClaimantAttempt = await request(app)
        .post(`/api/v1/wms/recount-tasks/${taskId}/lines/${line.recount_line_id}/count`)
        .set('Authorization', `Bearer ${fixture.operatorAToken}`)
        .send({ counted_quantity: 5, count_method: 'unit_scan' });

      expect(oldClaimantAttempt.status).toBe(409);

      const finalLine = await withTenant(fixture.shopId, (trx) =>
        trx('inventory_recount_lines')
          .where({ shop_id: fixture.shopId, recount_line_id: line.recount_line_id })
          .first('counted_by', 'counted_at')
      );
      expect(finalLine.counted_by).not.toBe(fixture.operatorAId);
    });

    it('genuine overlap: an old-claimant transaction blocked on the row lock sees the reassignment only after it commits, and correctly rejects', async () => {
      // Real transaction/lock coordination legitimately takes longer than
      // Jest's default 5s.
      const taskId = await createTask(fixture, 'counting');
      const line = await withTenant(fixture.shopId, (trx) =>
        trx('inventory_recount_lines')
          .where({ shop_id: fixture.shopId, recount_task_id: taskId })
          .first('recount_line_id')
      );

      // Manually-managed (non-callback-auto-committing) transactions so the
      // reassignment's row lock can be held open on purpose, forcing the
      // old-claimant transaction's own SELECT ... FOR UPDATE to genuinely
      // block on Postgres — not two sequential, independently-committed
      // requests. The barrier is an explicit resolve() the test controls,
      // not a sleep: final-state correctness comes from that ordering, not
      // from timing.
      const releaseReassignBarrier = createDeferred<void>();
      let reassignMutationDone = false;

      const reassignPromise = withTenant(fixture.shopId, async (trx) => {
        const result = await reassignRecountTask(
          trx,
          fixture.shopId,
          taskId,
          fixture.ownerId,
          fixture.operatorBId
        );
        // reassignRecountTask has already done its SELECT ... FOR UPDATE and
        // its UPDATE by this point — the row lock is held, uncommitted.
        reassignMutationDone = true;
        // Hold the transaction (and therefore the lock) open until the test
        // explicitly releases it — this is the deterministic barrier.
        await releaseReassignBarrier.promise;
        return result;
      });

      // Wait for the reassignment's write to have actually happened before
      // starting the old claimant, so the old claimant's SELECT ... FOR
      // UPDATE is issued while the lock is DEFINITELY still held.
      await waitUntil(() => reassignMutationDone);

      let oldClaimantSettled = false;
      const oldClaimantPromise = withTenant(fixture.shopId, async (trx) => {
        await recordCount(trx, {
          shopId: fixture.shopId,
          recountTaskId: taskId,
          recountLineId: line.recount_line_id,
          countedQuantity: 5,
          countMethod: 'unit_scan',
          countedBy: fixture.operatorAId,
        });
      })
        .catch((error) => error)
        .finally(() => {
          oldClaimantSettled = true;
        });

      // Deterministic DB-level confirmation of genuine blocking (not a
      // correctness mechanism — a diagnostic barrier check): poll pg_locks
      // for a second backend waiting on the exact row reassignTrx holds.
      // Bounded, polling-until-condition — not a fixed sleep standing in for
      // correctness.
      const blockedRow = await waitForBlockedLockWaiter(fixture.shopId);
      expect(blockedRow).toBe(true);
      expect(oldClaimantSettled).toBe(false);

      // Release the barrier: reassignment's transaction commits now.
      releaseReassignBarrier.resolve();
      await reassignPromise;

      // The old claimant's SELECT ... FOR UPDATE was blocked on Postgres's
      // row lock; it unblocks only once reassignTrx above actually commits,
      // and then deterministically observes the POST-reassignment
      // claimed_by and rejects.
      const oldClaimantResult = await oldClaimantPromise;
      expect(oldClaimantResult).toBeInstanceOf(Error);
      expect((oldClaimantResult as Error).message).toMatch(/different operator/);

      const finalTask = await withTenant(fixture.shopId, (trx) =>
        trx('inventory_recount_tasks')
          .where({ shop_id: fixture.shopId, recount_task_id: taskId })
          .first('claimed_by')
      );
      expect(finalTask.claimed_by).toBe(fixture.operatorBId);

      const finalLine = await withTenant(fixture.shopId, (trx) =>
        trx('inventory_recount_lines')
          .where({ shop_id: fixture.shopId, recount_line_id: line.recount_line_id })
          .first('counted_by', 'counted_at')
      );
      expect(finalLine.counted_by).toBeNull();
      expect(finalLine.counted_at).toBeNull();
    }, 15000);
  });
});
