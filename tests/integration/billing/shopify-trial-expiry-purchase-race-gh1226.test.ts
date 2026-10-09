// tests/integration/billing/shopify-trial-expiry-purchase-race-gh1226.test.ts
//
// GH-1226 / TIER-11 — RED CONTRACT: Shopify paid-plan purchase vs trial expiry.
// ===========================================================================
// Both paths serialize on transitionShopSubscription()'s canonical per-shop
// lock pg_advisory_xact_lock(91002, shopId). Trial expiry decides eligibility
// from a status read taken BEFORE that lock, so a purchase that commits while
// expiry waits on the lock is still downgraded by the stale candidate.
//
// Deterministic barrier (precedent:
// tests/integration/wms/cancellation-unwind-pick-concurrency-r0-1.test.ts):
// a disposable-DB BEFORE UPDATE trigger on shop_subscriptions, narrowed to one
// fixture shop and one exact tier transition, parks the FIRST transaction on a
// test-only advisory barrier K while it still owns the canonical commercial
// lock. The second path is started, proven blocked on 91002/shopId by the
// parked backend (pg_locks + pg_blocking_pids), and only then is K released.
//
// R1 — purchase first, expiry loses:      EXPECTED RED today.
// R2 — expiry first, Shopify wins last:   EXPECTED GREEN control.
//
// Real: runTrialExpiryCycle(), applyShopifyBillingState(),
// transitionShopSubscription(), EntitlementsService, commercial-policy,
// disposable Postgres. Mocked ONLY: global.fetch (Shopify Partner API truth),
// the trial email senders, and analytics captureEvent.

import crypto from 'crypto';
import { knex as knexFactory } from 'knex';
import db, {
  setTenantContext,
  systemTransaction,
  withTenant,
} from '@lasyncro/backend-core/db.js';
import { createTenantShop } from '@lasyncro/backend-core/services/pre-tenant.service.js';
import { EntitlementsService } from '@lasyncro/backend-core/services/entitlements.service.js';
import { modulesForTier, flagsForTier } from '@lasyncro/commercial-policy';
import { transitionShopSubscription } from 'api-src/services/billing/subscriptionTransition.service';
import { applyShopifyBillingState } from 'api-src/services/shopify/applyShopifyBillingState.service';
import { runTrialExpiryCycle } from 'api-src/services/trial-expiry.service';
import { sendTrialExpiryEmail } from 'api-src/services/email/email.service';
import { captureEvent } from 'api-src/utils/analytics';

jest.mock('api-src/services/email/email.service', () => ({
  ...jest.requireActual('api-src/services/email/email.service'),
  sendTrialExpiryEmail: jest.fn(async () => undefined),
  sendTrialReminderEmail: jest.fn(async () => undefined),
}));

jest.mock('api-src/utils/analytics', () => ({
  ...jest.requireActual('api-src/utils/analytics'),
  captureEvent: jest.fn(),
}));

const sendTrialExpiryEmailMock = sendTrialExpiryEmail as unknown as jest.Mock;
const captureEventMock = captureEvent as unknown as jest.Mock;

const COMMERCIAL_LOCK_NAMESPACE = 91002;
const PARTNER_URL = 'https://partners.shopify.com/123/api/2026-07/graphql.json';
const PARTNER_TOKEN = 'test-partner-token-not-printed';
const SCALE_MODULES = [...modulesForTier('scale')];
const SCALE_FLAGS = [...flagsForTier('scale')];

const realFetch = global.fetch;
let partnerFetch: jest.Mock;

type Fixture = {
  shopId: number;
  userId: number;
  email: string;
  shopGid: string;
};

// ---------------------------------------------------------------------------
// Fixture
// ---------------------------------------------------------------------------

async function arrangeExpiredShopifyGrowthTrial(label: string): Promise<Fixture> {
  const suffix = crypto.randomBytes(5).toString('hex');
  const shopGid = `gid://shopify/Shop/${Date.now()}${crypto.randomInt(1000, 9999)}`;
  const shopDomain = `gh1226-${label}-${suffix}.myshopify.com`;
  const email = `gh1226-${label}-${suffix}@test.example`;

  const shopId = await systemTransaction(async (trx) => {
    const id = await createTenantShop(trx, `gh1226-race-${label}-${suffix}`);
    await setTenantContext(trx, id);
    return id;
  });

  const userId = await withTenant(shopId, async (trx) => {
    const [owner] = await trx('users')
      .insert({
        shop_id: shopId,
        email,
        password_hash: 'test',
        first_name: 'Owner',
        role: 'owner',
      })
      .returning('id');

    await trx('shop_memberships').insert({ shop_id: shopId, user_id: owner.id, role: 'owner' });

    await trx('shopify_app_installations').insert({
      shop_id: shopId,
      shop_domain: shopDomain,
      shop_gid: shopGid,
      scopes: 'read_products',
      installed_at: new Date(),
      uninstalled_at: null,
    });

    // Authoritative initial state through the canonical service: an already
    // expired growth/trialing/shopify trial.
    await transitionShopSubscription(
      {
        shopId,
        to: { tier: 'growth', status: 'trialing', billingProvider: 'shopify' },
        fields: { trial_ends_at: new Date(Date.now() - 60_000) },
        source: 'gh1226_test_fixture',
        reason: 'expired_growth_trial_fixture',
        actorType: 'system',
        actorId: 'gh1226-test',
        actingProvider: 'shopify',
      },
      trx,
    );

    // Growth commercial entitlement rows, so expiry revocation is observable.
    const growthModuleRows = [...modulesForTier('growth')].map((moduleKey) => ({
      shop_id: shopId,
      module_key: moduleKey,
      flag_key: null as string | null,
      source: 'gh1226_test_fixture:growth',
    }));
    const growthFlagRows = [...flagsForTier('growth')].map((flagKey) => ({
      shop_id: shopId,
      module_key: flagKey.split('.')[0],
      flag_key: flagKey,
      source: 'gh1226_test_fixture:growth',
    }));
    await EntitlementsService.applyFromCommercialGrant(trx, [...growthModuleRows, ...growthFlagRows]);

    return Number(owner.id);
  });

  // Discovery precondition: the real worker query sees this shop as expired.
  const discovered = await withTenant(shopId, (trx) =>
    trx.raw('SELECT shop_id, trial_ends_at FROM public.list_trialing_tenants() WHERE shop_id = ?', [shopId]),
  );
  expect(discovered.rows).toHaveLength(1);
  expect(new Date(discovered.rows[0].trial_ends_at).getTime()).toBeLessThan(Date.now());

  return { shopId, userId, email, shopGid };
}

/** Authoritative Partner API truth: an active Shopify Scale plan for this shop. */
function programPartnerActiveScale(shopGid: string) {
  partnerFetch.mockImplementation(async (url: unknown, init?: RequestInit) => {
    const href = String(url);
    if (href !== PARTNER_URL) {
      throw new Error(`PROVIDER_NETWORK_ESCAPE_BLOCKED:${href}`);
    }
    const headers = new Headers(init?.headers);
    if (headers.get('X-Shopify-Access-Token') !== PARTNER_TOKEN) {
      throw new Error('PARTNER_TOKEN_MISMATCH');
    }
    return {
      ok: true,
      status: 200,
      json: async () => ({
        data: {
          activeSubscription: {
            shop: { id: shopGid },
            billingPeriod: 'EVERY_30_DAYS',
            cancelAtEndOfCycle: false,
            trialEndsAt: null,
            currentBillingCycle: {
              startTime: '2026-10-01T00:00:00Z',
              endTime: '2026-11-01T00:00:00Z',
            },
            items: [
              {
                handle: 'scale',
                description: 'Scale',
                price: { __typename: 'FlatRatePrice', active: true, currency: 'USD', amount: '299.00' },
                usage: null,
              },
            ],
            pendingUpdate: null,
            legacySubscriptionId: 'gid://shopify/AppSubscription/gh1226-scale',
          },
        },
      }),
    };
  });
}

// ---------------------------------------------------------------------------
// Commercial paths under test (real, unmocked)
// ---------------------------------------------------------------------------

function startShopifyReconciliation(shopId: number) {
  return withTenant(shopId, (trx) => applyShopifyBillingState(shopId, trx));
}

function startTrialExpiryCycle() {
  return runTrialExpiryCycle();
}

// ---------------------------------------------------------------------------
// Deterministic interleaving harness
// ---------------------------------------------------------------------------

function assertDisposableTestDb(): string {
  const pgdb = process.env.PGDATABASE ?? '';
  if (!/^synchroflow_test_[A-Za-z0-9_]+$/.test(pgdb)) {
    throw new Error(`GH-1226 RED: refusing test DDL in non-disposable PGDATABASE "${pgdb}"`);
  }
  return pgdb;
}

async function waitFor<T>(
  probe: () => Promise<T>,
  label: string,
  { tries = 400, intervalMs = 25 } = {},
): Promise<NonNullable<T>> {
  for (let i = 0; i < tries; i++) {
    const v = await probe();
    if (v) return v as NonNullable<T>;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  throw new Error(`waitFor timed out: ${label}`);
}

function timeoutAfter(ms: number, label: string): Promise<never> {
  return new Promise((_, reject) => {
    setTimeout(() => reject(new Error(`BLOCKED_BY_TEST_INFRA: ${label}`)), ms).unref?.();
  });
}

type TxOutcome =
  | { committed: true }
  | { committed: false; code: string | null; message: string };

function settle(p: Promise<unknown>): Promise<TxOutcome> {
  return p.then(
    () => ({ committed: true } as TxOutcome),
    (e: any) => ({ committed: false, code: e?.code ?? null, message: String(e?.message ?? e) } as TxOutcome),
  );
}

async function runParkedInterleaving(opts: {
  shopId: number;
  /** Exact UPDATE the FIRST path's transaction is parked on. */
  park: { oldTier: string; newTier: string; newStatus: string };
  first: { label: string; start: () => Promise<unknown> };
  second: { label: string; start: () => Promise<unknown> };
}) {
  const pgdb = assertDisposableTestDb();
  const shopId = Number(opts.shopId);
  if (!Number.isInteger(shopId) || shopId <= 0) throw new Error('GH-1226 RED: invalid fixture shopId');
  const sqlLiteral = (v: string) => {
    if (!/^[a-z_]+$/.test(v)) throw new Error(`GH-1226 RED: unexpected park literal ${v}`);
    return `'${v}'`;
  };

  const uniq = crypto.randomUUID().replace(/-/g, '');
  const K = 1 + Math.floor(Math.random() * 2_000_000_000);
  const fnName = `gh1226_park_fn_${uniq}`;
  const trgName = `gh1226_park_trg_${uniq}`;
  const coord = knexFactory({
    client: 'pg',
    connection: {
      host: process.env.PGHOST,
      port: Number(process.env.PGPORT),
      user: process.env.PGMIGRATION_USER,
      password: String(process.env.PGMIGRATION_PASSWORD || ''),
      database: pgdb,
    },
    pool: { min: 1, max: 1 },
  });

  let firstPromise: Promise<TxOutcome> | null = null;
  let secondPromise: Promise<TxOutcome> | null = null;
  let firstSettled: TxOutcome | null = null;
  let secondSettled: TxOutcome | null = null;

  try {
    await coord.raw(
      `CREATE FUNCTION ${fnName}() RETURNS trigger LANGUAGE plpgsql AS $$ ` +
        `BEGIN PERFORM pg_advisory_xact_lock(${K}); RETURN NEW; END; $$;`,
    );
    await coord.raw(
      `CREATE TRIGGER ${trgName} BEFORE UPDATE ON shop_subscriptions FOR EACH ROW ` +
        `WHEN (NEW.shop_id = ${shopId} ` +
        `AND OLD.tier = ${sqlLiteral(opts.park.oldTier)} ` +
        `AND NEW.tier = ${sqlLiteral(opts.park.newTier)} ` +
        `AND NEW.status = ${sqlLiteral(opts.park.newStatus)}) ` +
        `EXECUTE FUNCTION ${fnName}();`,
    );
    await coord.raw(`SELECT pg_advisory_lock(${K})`);

    firstPromise = settle(opts.first.start()).then((o) => {
      firstSettled = o;
      return o;
    });

    // 1. First path is parked on K inside its UPDATE.
    const parkedPid = await waitFor(async () => {
      if (firstSettled) {
        throw new Error(
          `BLOCKED_BY_TEST_INFRA: ${opts.first.label} completed before parking: ${JSON.stringify(firstSettled)}`,
        );
      }
      const r = await coord.raw(
        `SELECT pid FROM pg_locks WHERE locktype='advisory' AND classid=0 AND objid=${K} AND objsubid=1 AND NOT granted`,
      );
      return (r.rows[0]?.pid as number | undefined) ?? null;
    }, `${opts.first.label} parked on barrier K`);

    // 2. While parked it still owns the canonical commercial lock 91002/shopId.
    const ownsCommercialLock = await coord.raw(
      `SELECT 1 FROM pg_locks WHERE locktype='advisory' AND classid=${COMMERCIAL_LOCK_NAMESPACE} ` +
        `AND objid=${shopId} AND objsubid=2 AND granted AND pid=${Number(parkedPid)}`,
    );
    expect(ownsCommercialLock.rows).toHaveLength(1);

    secondPromise = settle(opts.second.start()).then((o) => {
      secondSettled = o;
      return o;
    });

    // 3. Second path is blocked on 91002/shopId by the parked backend.
    const blocked = await waitFor(async () => {
      if (secondSettled) {
        throw new Error(
          `BLOCKED_BY_TEST_INFRA: ${opts.second.label} completed while ${opts.first.label} was parked: ${JSON.stringify(secondSettled)}`,
        );
      }
      const r = await coord.raw(
        `SELECT a.pid, pg_blocking_pids(a.pid) AS blockers
           FROM pg_stat_activity a
           JOIN pg_locks l ON l.pid = a.pid
          WHERE a.backend_type = 'client backend'
            AND a.pid <> ${Number(parkedPid)}
            AND l.locktype = 'advisory'
            AND l.classid = ${COMMERCIAL_LOCK_NAMESPACE}
            AND l.objid = ${shopId}
            AND l.objsubid = 2
            AND NOT l.granted
            AND ${Number(parkedPid)} = ANY(pg_blocking_pids(a.pid))
          LIMIT 1`,
      );
      return r.rows[0] ?? null;
    }, `${opts.second.label} blocked on commercial lock by parked ${opts.first.label}`);

    // 4. Release the barrier; both paths run to completion in lock order.
    await coord.raw(`SELECT pg_advisory_unlock(${K})`);
    const [first, second] = await Promise.race([
      Promise.all([firstPromise, secondPromise]),
      timeoutAfter(30_000, 'commercial transactions did not settle after barrier release'),
    ]);

    return {
      parkedPid: Number(parkedPid),
      blockedPid: Number(blocked.pid),
      blockers: blocked.blockers as number[],
      first,
      second,
    };
  } finally {
    try { await coord.raw(`SELECT pg_advisory_unlock_all()`); } catch { /* best-effort cleanup */ }
    // Let any in-flight path finish before dropping its trigger.
    try {
      await Promise.race([
        Promise.all([firstPromise, secondPromise].filter(Boolean) as Promise<TxOutcome>[]),
        timeoutAfter(30_000, 'in-flight commercial transactions during cleanup'),
      ]);
    } catch { /* surfaced by the main path */ }
    try { await coord.raw(`DROP TRIGGER IF EXISTS ${trgName} ON shop_subscriptions`); } catch { /* best-effort cleanup */ }
    try { await coord.raw(`DROP FUNCTION IF EXISTS ${fnName}()`); } catch { /* best-effort cleanup */ }
    const leakedTriggers = await coord.raw(`SELECT tgname FROM pg_trigger WHERE tgname LIKE 'gh1226_park%'`);
    const leakedFunctions = await coord.raw(`SELECT proname FROM pg_proc WHERE proname LIKE 'gh1226_park%'`);
    await coord.destroy();
    if (leakedTriggers.rows.length > 0 || leakedFunctions.rows.length > 0) {
      throw new Error(
        `GH-1226 RED test-only DDL leaked: ${JSON.stringify({
          triggers: leakedTriggers.rows,
          functions: leakedFunctions.rows,
        })}`,
      );
    }
  }
}

// ---------------------------------------------------------------------------
// Observation
// ---------------------------------------------------------------------------

async function subscription(shopId: number) {
  return withTenant(shopId, (trx) =>
    trx('shop_subscriptions')
      .where({ shop_id: shopId })
      .first('tier', 'status', 'billing_provider', 'trial_ends_at'),
  );
}

async function raceLedger(shopId: number) {
  return withTenant(shopId, (trx) =>
    trx('shop_subscription_transitions')
      .where({ shop_id: shopId })
      .whereNot({ source: 'gh1226_test_fixture' })
      .orderBy('id', 'asc')
      .select(
        'from_tier',
        'from_status',
        'from_billing_provider',
        'to_tier',
        'to_status',
        'to_billing_provider',
        'source',
      ),
  );
}

async function entitlementRows(shopId: number) {
  return withTenant(shopId, (trx) =>
    trx('shop_module_entitlements')
      .where({ shop_id: shopId })
      .orderBy('id', 'asc')
      .select('module_key', 'flag_key', 'source', 'valid_until'),
  );
}

type EntRow = { module_key: string; flag_key: string | null; source: string; valid_until: Date | null };

function activeModuleKeys(rows: EntRow[]): string[] {
  return rows.filter((r) => r.flag_key === null && r.valid_until === null).map((r) => r.module_key);
}

function expiryEventsFor(shopId: number) {
  return captureEventMock.mock.calls
    .map((c) => c[0])
    .filter((p: { shopId?: number; event?: string }) => p?.shopId === shopId && p?.event === 'trial_expired');
}

function expiryEmailsFor(email: string) {
  return sendTrialExpiryEmailMock.mock.calls
    .map((c) => c[0])
    .filter((p: { toEmail?: string }) => p?.toEmail === email);
}

function emitEvidence(label: string, evidence: unknown): void {
  process.stdout.write(`\n[${label}] ${JSON.stringify(evidence)}\n`);
}

// ---------------------------------------------------------------------------

describe('GH-1226 — Shopify paid-plan purchase vs trial expiry lock order', () => {
  beforeAll(() => {
    partnerFetch = jest.fn();
    (global as unknown as { fetch: unknown }).fetch = partnerFetch;
  });

  afterAll(async () => {
    (global as unknown as { fetch: unknown }).fetch = realFetch;
    await db.destroy();
  });

  beforeEach(() => {
    process.env.SHOPIFY_PARTNER_ORG_ID = '123';
    process.env.SHOPIFY_APP_GID = 'gid://shopify/App/320563019777';
    process.env.SHOPIFY_PARTNER_API_ACCESS_TOKEN = PARTNER_TOKEN;
    partnerFetch.mockReset();
    captureEventMock.mockClear();
    sendTrialExpiryEmailMock.mockClear();
  });

  it('R1 — Shopify Scale purchase commits first: the stale expiry candidate performs zero mutation and zero expiry side effects', async () => {
    const f = await arrangeExpiredShopifyGrowthTrial('r1');
    programPartnerActiveScale(f.shopGid);

    const interleaving = await runParkedInterleaving({
      shopId: f.shopId,
      park: { oldTier: 'growth', newTier: 'scale', newStatus: 'active' },
      first: { label: 'shopify-scale-reconciliation', start: () => startShopifyReconciliation(f.shopId) },
      second: { label: 'trial-expiry-cycle', start: startTrialExpiryCycle },
    });

    const post = {
      subscription: await subscription(f.shopId),
      ledger: await raceLedger(f.shopId),
      entitlements: (await entitlementRows(f.shopId)) as EntRow[],
      effective: await EntitlementsService.getForUser(f.userId),
      trialExpiredEvents: expiryEventsFor(f.shopId),
      trialExpiryEmails: expiryEmailsFor(f.email),
    };
    emitEvidence('GH1226_R1_EVIDENCE', { shopId: f.shopId, interleaving, post });

    expect(interleaving.first).toEqual({ committed: true });
    expect(interleaving.second).toEqual({ committed: true });
    expect(interleaving.blockers).toContain(interleaving.parkedPid);
    expect(partnerFetch).toHaveBeenCalled();

    // Paid plan is final authority.
    expect(post.subscription).toMatchObject({ tier: 'scale', status: 'active', billing_provider: 'shopify' });
    expect(post.subscription.trial_ends_at).toBeNull();

    // Ledger: the Shopify reconciliation transition exists; expiry wrote nothing.
    expect(post.ledger).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          from_tier: 'growth',
          from_status: 'trialing',
          to_tier: 'scale',
          to_status: 'active',
          to_billing_provider: 'shopify',
          source: 'shopify_billing_reconciliation',
        }),
      ]),
    );
    expect(post.ledger.filter((r: { source: string }) => r.source === 'trial_expiry_worker')).toEqual([]);

    // Entitlements: no Starter seeding, no closure of Scale-relevant rows.
    expect(post.entitlements.filter((r) => r.source === 'trial_expiry:downgrade_to_starter')).toEqual([]);
    expect(activeModuleKeys(post.entitlements)).toEqual(expect.arrayContaining(SCALE_MODULES));
    const closedScaleRows = post.entitlements.filter(
      (r) =>
        r.valid_until !== null &&
        ((r.flag_key === null && SCALE_MODULES.includes(r.module_key)) ||
          (r.flag_key !== null && SCALE_FLAGS.includes(r.flag_key))),
    );
    expect(closedScaleRows).toEqual([]);

    expect(post.effective).not.toBeNull();
    expect(post.effective!.modules).toEqual(expect.arrayContaining(SCALE_MODULES));
    expect(post.effective!.flags).toEqual(expect.arrayContaining(SCALE_FLAGS));

    // No expiry success side effects.
    expect(post.trialExpiredEvents).toEqual([]);
    expect(post.trialExpiryEmails).toEqual([]);
  }, 120_000);

  it('R2 — trial expiry commits Starter first: later Shopify reconciliation converges to the purchased Scale plan', async () => {
    const f = await arrangeExpiredShopifyGrowthTrial('r2');
    programPartnerActiveScale(f.shopGid);

    const interleaving = await runParkedInterleaving({
      shopId: f.shopId,
      park: { oldTier: 'growth', newTier: 'starter', newStatus: 'active' },
      first: { label: 'trial-expiry-cycle', start: startTrialExpiryCycle },
      second: { label: 'shopify-scale-reconciliation', start: () => startShopifyReconciliation(f.shopId) },
    });

    const post = {
      subscription: await subscription(f.shopId),
      ledger: await raceLedger(f.shopId),
      entitlements: (await entitlementRows(f.shopId)) as EntRow[],
      effective: await EntitlementsService.getForUser(f.userId),
    };
    emitEvidence('GH1226_R2_EVIDENCE', {
      shopId: f.shopId,
      interleaving,
      post: {
        ...post,
        scaleFlagRows: post.entitlements.filter((r) => r.flag_key !== null && SCALE_FLAGS.includes(r.flag_key)),
      },
    });

    expect(interleaving.first).toEqual({ committed: true });
    expect(interleaving.second).toEqual({ committed: true });
    expect(interleaving.blockers).toContain(interleaving.parkedPid);
    expect(partnerFetch).toHaveBeenCalled();

    expect(post.subscription).toMatchObject({ tier: 'scale', status: 'active', billing_provider: 'shopify' });
    expect(post.subscription.trial_ends_at).toBeNull();

    // Serial chain: expiry first, Shopify reconciliation last.
    expect(post.ledger).toEqual([
      {
        from_tier: 'growth',
        from_status: 'trialing',
        from_billing_provider: 'shopify',
        to_tier: 'starter',
        to_status: 'active',
        to_billing_provider: 'shopify',
        source: 'trial_expiry_worker',
      },
      {
        from_tier: 'starter',
        from_status: 'active',
        from_billing_provider: 'shopify',
        to_tier: 'scale',
        to_status: 'active',
        to_billing_provider: 'shopify',
        source: 'shopify_billing_reconciliation',
      },
    ]);

    // Final state equals the final ledger row.
    const last = post.ledger[post.ledger.length - 1];
    expect({
      tier: post.subscription.tier,
      status: post.subscription.status,
      billing_provider: post.subscription.billing_provider,
    }).toEqual({ tier: last.to_tier, status: last.to_status, billing_provider: last.to_billing_provider });

    // Final Scale entitlements are active.
    expect(activeModuleKeys(post.entitlements)).toEqual(expect.arrayContaining(SCALE_MODULES));
    expect(post.effective).not.toBeNull();
    expect(post.effective!.modules).toEqual(expect.arrayContaining(SCALE_MODULES));
    expect(post.effective!.flags).toEqual(expect.arrayContaining(SCALE_FLAGS));
  }, 120_000);
});
