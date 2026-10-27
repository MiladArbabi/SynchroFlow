import crypto from 'crypto';
import type { Knex } from 'knex';

import {
  systemTransaction,
  setTenantContext,
  withTenant,
} from '@lasyncro/backend-core/db.js';

import { createTenantShop } from
  '@lasyncro/backend-core/services/pre-tenant.service.js';

import { handleInvoicePaid } from
  'api-src/api/billing/handlers/handleInvoicePaid';

import type { WebhookEnvelope } from
  'api-src/api/webhooks/types';

// FI002_PRICE_FIXTURE: local synthetic Stripe price only.
const fi002PriorPrice = process.env.STRIPE_PRICE_SELF_SERVE_CORE_MONTHLY_USD;

beforeAll(() => {
  process.env.STRIPE_PRICE_SELF_SERVE_CORE_MONTHLY_USD =
    'price_fi002_core';
});

afterAll(() => {
  if (fi002PriorPrice === undefined) {
    delete process.env.STRIPE_PRICE_SELF_SERVE_CORE_MONTHLY_USD;
  } else {
    process.env.STRIPE_PRICE_SELF_SERVE_CORE_MONTHLY_USD =
      fi002PriorPrice;
  }
});

const SEP = new Date('2026-09-01T00:00:00Z');
const OCT = new Date('2026-10-01T00:00:00Z');
const NOV = new Date('2026-11-01T00:00:00Z');

async function fixture(
  provider: 'stripe' | 'shopify' = 'stripe',
  start = OCT
) {
  const suffix = crypto.randomBytes(6).toString('hex');

  const shopId = await systemTransaction(async trx => {
    const id = await createTenantShop(trx, `fi002-${suffix}`);
    await setTenantContext(trx, id);
    return id;
  });

  const customerId = `cus_fi002_${shopId}`;
  const subscriptionId = `sub_fi002_${shopId}`;

  await withTenant(shopId, async trx => {
    await trx('shop_subscriptions').insert({
      shop_id: shopId,
      tier: 'core',
      status: 'active',
      billing_provider: provider,
      stripe_customer_id: customerId,
      stripe_subscription_id: subscriptionId,
      current_period_start: start,
      current_period_end:
        start.getTime() === SEP.getTime() ? OCT : NOV,
    });

    await trx('shop_usage_metrics').insert({
      shop_id: shopId,
      tier_at_period_start: 'core',
      period_starts_at: start,
      period_ends_at: null,
      ingested_orders: 12,
      shipped_orders: 8,
    });
  });

  return { shopId, customerId, subscriptionId };
}

type Fixture = Awaited<ReturnType<typeof fixture>>;

// FI002-SERVICE-PERIOD-V2:
// Invoice-level periods are not subscription billing-cycle authority.
// Use the non-proration subscription line's service period.
function invoiceEnvelope(
  f: Fixture,
  overrides: Record<string, unknown> = {}
): WebhookEnvelope {
  const lineStart = Object.prototype.hasOwnProperty.call(
    overrides, 'servicePeriodStart'
  ) ? overrides.servicePeriodStart : OCT.getTime() / 1000;

  const lineEnd = Object.prototype.hasOwnProperty.call(
    overrides, 'servicePeriodEnd'
  ) ? overrides.servicePeriodEnd : NOV.getTime() / 1000;

  const invoiceOverrides = { ...overrides };
  delete invoiceOverrides.servicePeriodStart;
  delete invoiceOverrides.servicePeriodEnd;

  return {
    integration: 'stripe',
    eventType: 'invoice.payment_succeeded',
    eventId: `evt_fi002_${crypto.randomBytes(6).toString('hex')}`,
    verified: true,
    receivedAt: new Date(),
    shopId: f.shopId,
    rawPayload: {
      id: `in_fi002_${crypto.randomBytes(6).toString('hex')}`,
      status: 'paid',
      billing_reason: 'subscription_cycle',
      customer: f.customerId,
      subscription: f.subscriptionId,
      parent: {
        type: 'subscription_details',
        subscription_details: { subscription: f.subscriptionId },
      },
      metadata: { shopId: String(f.shopId) },

      // Stripe's invoice-level period can describe the prior cycle.
      // It must NOT be used as the next allowance reset boundary.
      period_start: SEP.getTime() / 1000,
      period_end: OCT.getTime() / 1000,

      lines: {
        has_more: false,
        data: [{
          parent: {
            type: 'subscription_item_details',
            subscription_item_details: {
              subscription: f.subscriptionId,
              proration: false,
            },
          },
          period: { start: lineStart, end: lineEnd },
          pricing: {
            type: 'price_details',
            price_details: { price: 'price_fi002_core' },
          },
        }],
      },

      ...invoiceOverrides,
    },
  };
}

function invoke(
  f: Fixture,
  overrides: Record<string, unknown> = {}
) {
  return withTenant(f.shopId, trx =>
    handleInvoicePaid(
      invoiceEnvelope(f, overrides),
      trx as Knex.Transaction
    )
  );
}

function periods(f: Fixture) {
  return withTenant(f.shopId, trx =>
    trx('shop_usage_metrics')
      .where({ shop_id: f.shopId })
      .orderBy('period_starts_at', 'asc')
      .select(
        'period_starts_at',
        'period_ends_at',
        'tier_at_period_start',
        'ingested_orders',
        'shipped_orders'
      )
  );
}

describe('FI-002 — Stripe invoice usage-period authority', () => {
  it('FI002-VALID: advances a legitimate billing period', async () => {
    const f = await fixture('stripe', SEP);

    await invoke(f);

    const rows = await periods(f);

    expect(rows).toHaveLength(2);
    expect(new Date(rows[0].period_ends_at).toISOString())
      .toBe(OCT.toISOString());

    expect(rows[0]).toMatchObject({
      ingested_orders: 12,
      shipped_orders: 8,
    });

    expect(new Date(rows[1].period_starts_at).toISOString())
      .toBe(OCT.toISOString());

    expect(rows[1]).toMatchObject({
      period_ends_at: null,
      tier_at_period_start: 'core',
      ingested_orders: 0,
      shipped_orders: 0,
    });
  });

  it('FI002-CONCURRENT: concurrent renewals rotate only once', async () => {
    const f = await fixture('stripe', SEP);

    await Promise.all(
      Array.from({ length: 3 }, () => invoke(f))
    );

    const rows = await periods(f);

    expect(rows).toHaveLength(2);
    expect(new Date(rows[0].period_ends_at).toISOString())
      .toBe(OCT.toISOString());
    expect(rows[0]).toMatchObject({
      ingested_orders: 12,
      shipped_orders: 8,
    });

    expect(new Date(rows[1].period_starts_at).toISOString())
      .toBe(OCT.toISOString());
    expect(rows[1]).toMatchObject({
      period_ends_at: null,
      ingested_orders: 0,
      shipped_orders: 0,
    });

    // Distinct event IDs reporting the same cycle must not reset again.
    await invoke(f);
    expect(await periods(f)).toEqual(rows);

    // A late older invoice must not rewind the committed cycle.
    await invoke(f, {
      servicePeriodStart: SEP.getTime() / 1000,
      servicePeriodEnd: OCT.getTime() / 1000,
    });
    expect(await periods(f)).toEqual(rows);
  });

  it('FI002-STALE: an older invoice cannot rewind usage', async () => {
    const f = await fixture();
    const before = await periods(f);

    await invoke(f, {
      servicePeriodStart: SEP.getTime() / 1000,
      servicePeriodEnd: OCT.getTime() / 1000,
    });

    expect(await periods(f)).toEqual(before);
  });

  it('FI002-NONCYCLE: a subscription update invoice cannot reset usage', async () => {
    const f = await fixture('stripe', SEP);
    const before = await periods(f);

    await expect(invoke(f, {
      billing_reason: 'subscription_update',
    })).rejects.toThrow();

    expect(await periods(f)).toEqual(before);
  });

  it.each([
    {
      name: 'foreign Shopify-owned shop',
      provider: 'shopify' as const,
      overrides: {},
    },
    {
      name: 'mismatched Stripe subscription',
      provider: 'stripe' as const,
      overrides: { subscription: 'sub_fi002_unrelated' },
    },
    {
      name: 'missing authoritative period start',
      provider: 'stripe' as const,
      overrides: { servicePeriodStart: undefined },
    },
  ])(
    'FI002-AUTHORITY: rejects $name without changing usage',
    async ({ provider, overrides }) => {
      const f = await fixture(provider);
      const before = await periods(f);

      await expect(invoke(f, overrides)).rejects.toThrow();

      expect(await periods(f)).toEqual(before);
    }
  );
});
