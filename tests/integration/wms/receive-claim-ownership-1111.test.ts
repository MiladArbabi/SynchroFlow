/**
 * GH-1111 — Receive claim ownership.
 *
 * Canonical contract:
 * - Receive execution cannot begin before the job is claimed.
 * - Claim persists operator ownership + started_at.
 * - Same operator may re-claim idempotently.
 * - Another operator cannot claim or mutate the claimed Receive job.
 * - Ownership protects every consequential Receive mutation surface.
 */

import crypto from 'crypto';
import request from 'supertest';
import { createApp } from 'api-src/bootstrap/express';
import {
  setTenantContext,
  systemTransaction,
  withTenant,
} from '@lasyncro/backend-core/db.js';
import { createTenantShop } from '@lasyncro/backend-core/services/pre-tenant.service.js';
import { createReceiveJob } from 'api-src/services/wms/receiveJob.service';
import { issueTestToken } from '../../unit/helpers/auth';

const app = createApp();

jest.setTimeout(180000);

beforeAll(() => {
  process.env.JWT_SECRET =
    process.env.JWT_SECRET || 'test_jwt_secret';
});

type Fixture = {
  shopId: number;
  ownerId: number;
  operatorAId: number;
  operatorBId: number;
  ownerToken: string;
  operatorAToken: string;
  operatorBToken: string;
};

type ReceiveFixture = {
  receiveJobId: string;
  receiveJobLineId: string;
  lasyncroVariantId: string;
};

async function createOwner(
  shopId: number,
  unique: string
): Promise<number> {
  const userId = await withTenant(shopId, async (trx) => {
    const [row] = await trx('users')
      .insert({
        shop_id: shopId,
        email: `receive-1111-owner-${unique}@test.example`,
        password_hash: 'not_a_real_hash',
        first_name: 'owner',
        role: 'owner',
      })
      .returning('id');

    return row.id as number;
  });

  await withTenant(shopId, async (trx) => {
    await trx('shop_memberships').insert({
      shop_id: shopId,
      user_id: userId,
      role: 'owner',
      revoked_at: null,
    });
  });

  return userId;
}

async function createOperator(
  shopId: number,
  unique: string,
  label: string
): Promise<number> {
  const userId = await withTenant(shopId, async (trx) => {
    const [row] = await trx('users')
      .insert({
        shop_id: shopId,
        email: `receive-1111-${label}-${unique}@test.example`,
        password_hash: 'not_a_real_hash',
        first_name: label,
        role: 'operator',
      })
      .returning('id');

    return row.id as number;
  });

  await withTenant(shopId, async (trx) => {
    await trx('shop_memberships').insert({
      shop_id: shopId,
      user_id: userId,
      role: 'operator',
      revoked_at: null,
    });
  });

  return userId;
}

async function createFixture(): Promise<Fixture> {
  const unique = crypto.randomBytes(6).toString('hex');

  const shopId = await systemTransaction(async (trx) => {
    const id = await createTenantShop(
      trx,
      `receive-claim-1111-${unique}`
    );
    await setTenantContext(trx, id);
    return id;
  });

  const ownerId = await createOwner(
    shopId,
    unique
  );

  const operatorAId = await createOperator(
    shopId,
    unique,
    'operator-a'
  );

  const operatorBId = await createOperator(
    shopId,
    unique,
    'operator-b'
  );

  await withTenant(shopId, async (trx) => {
    await trx('shop_subscriptions').insert({
      shop_id: shopId,
      tier: 'growth',
      allow_overage: true,
      billing_provider: 'stripe',
      stripe_customer_id: null,
    });

    await trx('shop_wms_settings').insert({
      shop_id: shopId,
    });

    await trx('user_lifecycle_snapshot').insert({
      shop_id: shopId,
      user_id: operatorAId,
      phase: 'FT2',
      since: new Date(),
      last_event_id: crypto.randomUUID(),
    });
  });

  return {
    shopId,
    ownerId,
    operatorAId,
    operatorBId,
    ownerToken: issueTestToken({
      userId: ownerId,
      shopId,
      tier: 'growth',
      roles: ['owner'],
    }),
    operatorAToken: issueTestToken({
      userId: operatorAId,
      shopId,
      tier: 'growth',
      roles: ['operator'],
    }),
    operatorBToken: issueTestToken({
      userId: operatorBId,
      shopId,
      tier: 'growth',
      roles: ['operator'],
    }),
  };
}

async function createReceiveFixture(
  fixture: Fixture,
  options: { assignedOperatorId?: number | null } = {}
): Promise<ReceiveFixture> {
  return withTenant(fixture.shopId, async (trx) => {
    const productId = crypto.randomUUID();
    const variantId = crypto.randomUUID();

    await trx('products').insert({
      lasyncro_product_id: productId,
      shop_id: fixture.shopId,
      title: 'GH1111 Receive product',
      status: 'active',
      product_type: 'physical',
    });

    await trx('variants').insert({
      lasyncro_variant_id: variantId,
      lasyncro_product_id: productId,
      shop_id: fixture.shopId,
      sku: `GH1111-${crypto.randomBytes(4).toString('hex')}`,
      title: 'Default Title',
      barcode: null,
      unit_cost: '1.00',
      status: 'active',
    });

    const [supplier] = await trx('suppliers')
      .insert({
        shop_id: fixture.shopId,
        name: `GH1111 Supplier ${crypto.randomUUID()}`,
      })
      .returning('id');

    const [po] = await trx('purchase_orders')
      .insert({
        shop_id: fixture.shopId,
        supplier_id: supplier.id,
        status: 'shipped',
      })
      .returning('id');

    await trx('purchase_order_line_items').insert({
      po_id: po.id,
      shop_id: fixture.shopId,
      lasyncro_variant_id: variantId,
      description: 'GH1111 claim ownership line',
      quantity_ordered: 1,
      quantity_received: 0,
      unit_cost_cents: 100,
    });

    const receiveJobId = await createReceiveJob(trx, {
      shopId: fixture.shopId,
      poId: po.id,
      operatorId: options.assignedOperatorId ?? null,
    });

    const line = await trx('receive_job_lines')
      .where({
        shop_id: fixture.shopId,
        receive_job_id: receiveJobId,
      })
      .first('receive_job_line_id');

    if (!line?.receive_job_line_id) {
      throw new Error('GH1111_RECEIVE_LINE_NOT_CREATED');
    }

    return {
      receiveJobId,
      receiveJobLineId: line.receive_job_line_id as string,
      lasyncroVariantId: variantId,
    };
  });
}

function auth(token: string) {
  return {
    Authorization: `Bearer ${token}`,
  };
}

async function claim(
  token: string,
  receiveJobId: string
) {
  return request(app)
    .post(
      `/api/v1/suppliers/receive-jobs/${receiveJobId}/claim`
    )
    .set(auth(token))
    .send({});
}

describe('GH-1111 — Receive claim ownership', () => {
  let fixture: Fixture;

  beforeAll(async () => {
    expect(process.env.PGDATABASE).toMatch(
      /^synchroflow_test_[A-Za-z0-9_]+$/
    );

    fixture = await createFixture();
  });

  it('GH1111-B0 — unassigned pending Receive jobs cannot be claimed from the pool', async () => {
    const receive = await createReceiveFixture(fixture, {
      assignedOperatorId: null,
    });

    const response = await claim(
      fixture.operatorAToken,
      receive.receiveJobId
    );

    expect(response.status).toBe(409);

    const job = await withTenant(
      fixture.shopId,
      (trx) =>
        trx('receive_jobs')
          .where({
            shop_id: fixture.shopId,
            receive_job_id: receive.receiveJobId,
          })
          .first(
            'status',
            'assigned_operator_id',
            'started_at'
          )
    );

    expect(job?.status).toBe('pending');
    expect(job?.assigned_operator_id).toBeNull();
    expect(job?.started_at).toBeNull();
  });

  it('GH1111-B1 — pre-assigned operator claim persists start time, is idempotent, and rejects another claimant', async () => {
    const receive = await createReceiveFixture(fixture, {
      assignedOperatorId: fixture.operatorAId,
    });

    const first = await claim(
      fixture.operatorAToken,
      receive.receiveJobId
    );

    expect(first.status).toBe(200);

    const afterFirst = await withTenant(
      fixture.shopId,
      (trx) =>
        trx('receive_jobs')
          .where({
            shop_id: fixture.shopId,
            receive_job_id: receive.receiveJobId,
          })
          .first(
            'status',
            'assigned_operator_id',
            'started_at'
          )
    );

    expect(afterFirst?.status).toBe('in_progress');
    expect(afterFirst?.assigned_operator_id).toBe(fixture.operatorAId);
    expect(afterFirst?.started_at).toBeTruthy();

    const firstStartedAt =
      new Date(afterFirst!.started_at).getTime();

    const second = await claim(
      fixture.operatorAToken,
      receive.receiveJobId
    );

    expect(second.status).toBe(200);

    const afterSecond = await withTenant(
      fixture.shopId,
      (trx) =>
        trx('receive_jobs')
          .where({
            shop_id: fixture.shopId,
            receive_job_id: receive.receiveJobId,
          })
          .first(
            'status',
            'assigned_operator_id',
            'started_at'
          )
    );

    expect(
      new Date(afterSecond!.started_at).getTime()
    ).toBe(firstStartedAt);

    const foreignClaim = await claim(
      fixture.operatorBToken,
      receive.receiveJobId
    );

    expect(foreignClaim.status).toBe(409);
    expect(foreignClaim.body.error).toBe(
      'JOB_CLAIMED_BY_OTHER'
    );

    const afterForeign = await withTenant(
      fixture.shopId,
      (trx) =>
        trx('receive_jobs')
          .where({
            shop_id: fixture.shopId,
            receive_job_id: receive.receiveJobId,
          })
          .first('assigned_operator_id')
    );

    expect(afterForeign?.assigned_operator_id).toBe(fixture.operatorAId);
  });


  it('GH1111-B4 — concurrent claims never transfer a pre-assigned Receive job', async () => {
    const receive = await createReceiveFixture(fixture, {
      assignedOperatorId: fixture.operatorAId,
    });

    const [claimA, claimB] = await Promise.all([
      claim(
        fixture.operatorAToken,
        receive.receiveJobId
      ),
      claim(
        fixture.operatorBToken,
        receive.receiveJobId
      ),
    ]);

    expect(claimA.status).toBe(200);
    expect(claimB.status).toBe(409);

    const job = await withTenant(
      fixture.shopId,
      (trx) =>
        trx('receive_jobs')
          .where({
            shop_id: fixture.shopId,
            receive_job_id: receive.receiveJobId,
          })
          .first(
            'status',
            'assigned_operator_id',
            'started_at'
          )
    );

    expect(job?.status).toBe('in_progress');
    expect(job?.assigned_operator_id).toBe(fixture.operatorAId);
    expect(job?.started_at).toBeTruthy();
  });

  it('GH1111-B6 — concurrent reassignment and claim cannot both acquire Receive ownership', async () => {
    const receive = await createReceiveFixture(fixture, {
      assignedOperatorId: fixture.operatorAId,
    });

    const [reassign, claimA] = await Promise.all([
      request(app)
        .patch(
          `/api/v1/suppliers/receive-jobs/${receive.receiveJobId}/assignment`
        )
        .set(auth(fixture.ownerToken))
        .send({
          assigned_operator_id: fixture.operatorBId,
        }),
      claim(
        fixture.operatorAToken,
        receive.receiveJobId
      ),
    ]);

    const job = await withTenant(
      fixture.shopId,
      (trx) =>
        trx('receive_jobs')
          .where({
            shop_id: fixture.shopId,
            receive_job_id: receive.receiveJobId,
          })
          .first(
            'status',
            'assigned_operator_id',
            'started_at'
          )
    );

    const claimWon =
      claimA.status === 200 &&
      reassign.status === 409;

    const assignmentWon =
      reassign.status === 200 &&
      claimA.status === 409;

    expect(claimWon || assignmentWon).toBe(true);

    if (claimWon) {
      expect(job?.status).toBe('in_progress');
      expect(job?.assigned_operator_id).toBe(
        fixture.operatorAId
      );
      expect(job?.started_at).toBeTruthy();
    } else {
      expect(job?.status).toBe('pending');
      expect(job?.assigned_operator_id).toBe(
        fixture.operatorBId
      );
      expect(job?.started_at).toBeNull();
    }
  });

  it('GH1111-B2 — Receive execution mutation is rejected until the job is claimed', async () => {
    const receive = await createReceiveFixture(fixture, {
      assignedOperatorId: fixture.operatorAId,
    });

    const response = await request(app)
      .patch(
        `/api/v1/suppliers/receive-jobs/${receive.receiveJobId}/lines/${receive.receiveJobLineId}/progress`
      )
      .set(auth(fixture.operatorAToken))
      .send({
        quantity_sellable_provisional: 0,
      });

    expect(response.status).toBe(409);
    expect(response.body.error).toBe(
      'JOB_NOT_CLAIMED'
    );
  });

  const foreignMutationCases = [
    'progress',
    'inspect',
    'exception',
    'close',
    'label acknowledgement',
  ] as const;

  it.each(foreignMutationCases)(
    'GH1111-B3 — foreign operator cannot mutate claimed Receive via %s',
    async (surface) => {
      const receive = await createReceiveFixture(fixture, {
        assignedOperatorId: fixture.operatorAId,
      });

      const claimed = await claim(
        fixture.operatorAToken,
        receive.receiveJobId
      );

      expect(claimed.status).toBe(200);

      let response;

      if (surface === 'progress') {
        response = await request(app)
          .patch(
            `/api/v1/suppliers/receive-jobs/${receive.receiveJobId}/lines/${receive.receiveJobLineId}/progress`
          )
          .set(auth(fixture.operatorBToken))
          .send({
            quantity_sellable_provisional: 0,
          });
      } else if (surface === 'inspect') {
        response = await request(app)
          .post(
            `/api/v1/suppliers/receive-jobs/${receive.receiveJobId}/inspect`
          )
          .set(auth(fixture.operatorBToken))
          .send({
            lasyncro_variant_id:
              receive.lasyncroVariantId,
            receive_job_line_id:
              receive.receiveJobLineId,
            quantity_accepted: 1,
            quantity_rejected: 0,
          });
      } else if (surface === 'exception') {
        response = await request(app)
          .post(
            `/api/v1/suppliers/receive-jobs/${receive.receiveJobId}/exception`
          )
          .set(auth(fixture.operatorBToken))
          .send({
            lasyncro_variant_id:
              receive.lasyncroVariantId,
            receive_job_line_id:
              receive.receiveJobLineId,
            exception_type: 'missing_item',
            quantity_affected: 1,
          });
      } else if (surface === 'close') {
        response = await request(app)
          .post(
            `/api/v1/suppliers/receive-jobs/${receive.receiveJobId}/close`
          )
          .set(auth(fixture.operatorBToken))
          .send({
            actual_delivery_date: '2026-09-14',
          });
      } else {
        response = await request(app)
          .post(
            `/api/v1/wms/receive-job-lines/${receive.receiveJobLineId}/unit-labels/printed`
          )
          .set(auth(fixture.operatorBToken))
          .send({});
      }

      expect(response.status).toBe(409);
      expect(response.body.error).toBe(
        'JOB_CLAIMED_BY_OTHER'
      );
    }
  );

  const preClaimMutationCases = [
    'progress',
    'inspect',
    'exception',
    'close',
    'label acknowledgement',
  ] as const;

  it.each(preClaimMutationCases)(
    'GH1111-B5 — assigned operator cannot mutate before persisted claim via %s',
    async (surface) => {
      const receive = await createReceiveFixture(fixture, {
        assignedOperatorId: fixture.operatorAId,
      });

      let response;

      if (surface === 'progress') {
        response = await request(app)
          .patch(
            `/api/v1/suppliers/receive-jobs/${receive.receiveJobId}/lines/${receive.receiveJobLineId}/progress`
          )
          .set(auth(fixture.operatorAToken))
          .send({
            quantity_sellable_provisional: 0,
          });
      } else if (surface === 'inspect') {
        response = await request(app)
          .post(
            `/api/v1/suppliers/receive-jobs/${receive.receiveJobId}/inspect`
          )
          .set(auth(fixture.operatorAToken))
          .send({
            lasyncro_variant_id:
              receive.lasyncroVariantId,
            receive_job_line_id:
              receive.receiveJobLineId,
            quantity_accepted: 1,
            quantity_rejected: 0,
          });
      } else if (surface === 'exception') {
        response = await request(app)
          .post(
            `/api/v1/suppliers/receive-jobs/${receive.receiveJobId}/exception`
          )
          .set(auth(fixture.operatorAToken))
          .send({
            lasyncro_variant_id:
              receive.lasyncroVariantId,
            receive_job_line_id:
              receive.receiveJobLineId,
            exception_type: 'missing_item',
            quantity_affected: 1,
          });
      } else if (surface === 'close') {
        response = await request(app)
          .post(
            `/api/v1/suppliers/receive-jobs/${receive.receiveJobId}/close`
          )
          .set(auth(fixture.operatorAToken))
          .send({
            actual_delivery_date: '2026-09-14',
          });
      } else {
        response = await request(app)
          .post(
            `/api/v1/wms/receive-job-lines/${receive.receiveJobLineId}/unit-labels/printed`
          )
          .set(auth(fixture.operatorAToken))
          .send({});
      }

      expect(response.status).toBe(409);
      expect(response.body.error).toBe(
        'JOB_NOT_CLAIMED'
      );
    }
  );
});
