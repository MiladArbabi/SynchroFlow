import crypto from 'crypto';
import type { Knex } from 'knex';
import { HttpResponseError } from '@shopify/shopify-api';
import { withTenant } from '@lasyncro/backend-core/db.js';
import { handleAppUninstalled } from '../../api/shopify/handlers/handleAppUninstalled.js';
import { lockShopifyAdminCredentialRotation } from './shopifyAdminCredential.repository.js';
import {
  resolveShopifyAdminCredentialForConsumer,
  resolveShopifyAdminCredentialForDisconnectReconciliation,
} from './shopifyAdminCredentialConsumer.service.js';
import { classifyShopifyConnection, isShopifyConnectionReady, type ShopifyConnectionState } from './shopifyConnectionState.service.js';
import {
  DISCONNECT_LIVE_STATUSES,
  hasUnresolvedShopifyDisconnect,
  SHOPIFY_DISCONNECT_ATTEMPTS,
} from './shopifyDisconnectAttempt.repository.js';

/**
 * GH-979 SECTION C — OWNER-INITIATED SHOPIFY DISCONNECT
 * ------------------------------------------------------
 * Uninstalls LaSyncro from the merchant's Shopify store with the Admin GraphQL
 * appUninstall mutation, then applies the canonical GH-1068 app/uninstalled
 * domain mutation pinned to the exact authority used. The LaSyncro workspace,
 * orders, inventory and history are never deleted.
 *
 * A durable attempt (0219) carries every phase. No database transaction is
 * ever held across Shopify network I/O; each provider call has a deadline.
 *   1. Claim (short tx): one live attempt per tenant across all instances,
 *      with a database-time lease that expires if this process dies.
 *   2. Guard read (no tx): this installation still answers for this store.
 *   3. Intent (short tx, T2 lock): UNINSTALL_SENT is committed, pinned to the
 *      installation, generation and credential material, BEFORE the mutation.
 *      From then on readiness and provider consumers fail closed.
 *   4. appUninstall exactly once (no tx, no SDK retries, deadline).
 *   5. Outcome (short tx): REJECTED resolves; SUCCESS becomes
 *      PROVIDER_CONFIRMED and then the pinned local fence; anything else is
 *      OUTCOME_UNKNOWN and is never repeated.
 *
 * Unknown outcomes stay fail-closed and visible. A later owner request never
 * resends the mutation: after a settle window it reconciles with one read
 * using the pinned grant. Only a successful read for the same provider
 * installation proves the app is still installed; an authentication failure
 * alone never proves an uninstall. The app/uninstalled webhook, a reinstall
 * or a reconnect (new verified authority) end the unresolved state too.
 *
 * Tokens never leave this module: not in results, logs, errors or the database.
 */

const DISCONNECT_LOCK_NAMESPACE = 'shopify_app_disconnect';
export const SHOPIFY_DISCONNECT_PROVIDER_DEADLINE_MS = 8_000;
const CLAIM_LEASE_SECONDS = 45;
const SENT_LEASE_SECONDS = 30;
const RECONCILE_LEASE_SECONDS = 30;
export const RECONCILE_SETTLE_SECONDS = 120;
export const RECONCILE_MAX_ATTEMPTS = 5;

export const SHOPIFY_DISCONNECT_PRECHECK_QUERY = `query LaSyncroDisconnectPrecheck {
  shop { myshopifyDomain }
  currentAppInstallation { id }
}`;

export const SHOPIFY_APP_UNINSTALL_MUTATION = `mutation LaSyncroAppUninstall {
  appUninstall {
    app { id }
    userErrors { field message code }
  }
}`;

export type ShopifyDisconnectRecovery = 'CHECK_LATER' | 'RECONNECT';

export type ShopifyAppDisconnectResult =
  | { kind: 'DISCONNECTED'; shopDomain: string; connectionState: ShopifyConnectionState }
  | { kind: 'PENDING_CONFIRMATION'; shopDomain: string; reason: 'LOCAL_FENCE_PENDING' | 'AUTHORITY_CHANGED' }
  | { kind: 'IN_PROGRESS' }
  | { kind: 'NOT_CONNECTED'; connectionState: ShopifyConnectionState }
  | { kind: 'CONFIRMATION_MISMATCH' }
  | { kind: 'CREDENTIAL_UNAVAILABLE'; retryable: boolean }
  | { kind: 'IDENTITY_MISMATCH' }
  | { kind: 'PROVIDER_UNAVAILABLE'; retryable: boolean }
  | { kind: 'REJECTED'; providerErrorCodes: string[] }
  | { kind: 'OUTCOME_UNKNOWN'; shopDomain: string; recovery: ShopifyDisconnectRecovery }
  | { kind: 'NOT_UNINSTALLED'; shopDomain: string }
  | { kind: 'NO_UNRESOLVED_DISCONNECT'; connectionState: ShopifyConnectionState };

/** UNINSTALL may claim a new attempt; RECONCILE only ever acts on an unresolved one. */
export type ShopifyDisconnectMode = 'UNINSTALL' | 'RECONCILE';

export type ShopifyDisconnectState =
  | null
  | { status: 'IN_PROGRESS' | 'OUTCOME_UNKNOWN' | 'LOCAL_FENCE_PENDING'; shopDomain: string;
      recovery: ShopifyDisconnectRecovery | null };

const normalizeDomain = (value: string) => value.trim().toLowerCase();

/** Provider error enum codes only; Shopify-authored messages are never echoed. */
function providerErrorCodes(userErrors: unknown[]): string[] {
  return [...new Set(userErrors
    .map(error => (error as { code?: unknown })?.code)
    .filter((code): code is string => typeof code === 'string' && /^[A-Z][A-Z0-9_]{0,63}$/.test(code)))];
}

type MutationOutcome = { kind: 'SUCCESS' } | { kind: 'REJECTED'; codes: string[] } | { kind: 'AMBIGUOUS' };

function classifyMutation(response: unknown): MutationOutcome {
  const payload = (response as { data?: { appUninstall?: unknown } } | undefined)?.data?.appUninstall as
    { app?: { id?: unknown } | null; userErrors?: unknown } | null | undefined;
  if (!payload || !Array.isArray(payload.userErrors)) return { kind: 'AMBIGUOUS' };
  if (payload.userErrors.length > 0) return { kind: 'REJECTED', codes: providerErrorCodes(payload.userErrors) };
  return typeof payload.app?.id === 'string' && payload.app.id.length > 0
    ? { kind: 'SUCCESS' }
    : { kind: 'AMBIGUOUS' };
}

function log(event: string, shopId: number, fields: Record<string, unknown> = {}) {
  console.info('[SHOPIFY_APP_DISCONNECT]', { event, shopId, ...fields });
}

export const httpStatus = (error: unknown): number | null => {
  const status = error instanceof HttpResponseError ? error.response?.code : undefined;
  return Number.isInteger(status) ? status as number : null;
};

export type GraphqlClient = { request: (document: string, options?: Record<string, unknown>) => Promise<unknown> };

const DEADLINE_EXCEEDED = 'SHOPIFY_PROVIDER_DEADLINE_EXCEEDED';

/** Bounded provider call: aborted at the deadline, never retried by the SDK. */
export async function providerRequest(client: GraphqlClient, document: string): Promise<unknown> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new Error(DEADLINE_EXCEEDED));
    }, SHOPIFY_DISCONNECT_PROVIDER_DEADLINE_MS);
  });
  const operation = client.request(document, { retries: 0, signal: controller.signal });
  operation.catch(() => undefined); // A failure after the deadline is not unhandled.
  try {
    return await Promise.race([operation, deadline]);
  } finally {
    clearTimeout(timer);
  }
}

export async function graphqlClient(accessToken: string, shopDomain: string, shopId: number): Promise<GraphqlClient> {
  // Loaded on use: the SDK validates its configuration at import time, and
  // the integration routes module must stay importable without it.
  const { createShopifyGraphQLClient } = await import('./shopifyClient.service.js');
  return createShopifyGraphQLClient({ accessToken, platformShopName: shopDomain, shopId }) as unknown as GraphqlClient;
}

interface AttemptRow {
  id: string;
  installation_id: number;
  shop_domain: string;
  credential_generation: string;
  provider_installation_gid: string | null;
  status: (typeof DISCONNECT_LIVE_STATUSES)[number];
  reconcile_attempts: number;
  lease_live: boolean;
  settle_elapsed: boolean;
  provider_confirmed: boolean;
}

const attempts = (trx: Knex.Transaction) => trx(SHOPIFY_DISCONNECT_ATTEMPTS);
const CLEARED_LEASE = { claim_token: null, lease_expires_at: null };
const leaseFor = (trx: Knex.Transaction, seconds: number) =>
  trx.raw('pg_catalog.now() + pg_catalog.make_interval(secs => ?)', [seconds]);

/** Database-time view of the tenant's single live attempt. */
async function readLiveAttempt(trx: Knex.Transaction, shopId: number, lock: boolean): Promise<AttemptRow | undefined> {
  const query = attempts(trx)
    .where({ shop_id: shopId })
    .whereIn('status', DISCONNECT_LIVE_STATUSES)
    .first('id', 'installation_id', 'shop_domain', 'credential_generation', 'provider_installation_gid',
      'status', 'reconcile_attempts',
      trx.raw('(provider_confirmed_at IS NOT NULL) AS provider_confirmed'),
      trx.raw('(lease_expires_at IS NOT NULL AND lease_expires_at > pg_catalog.now()) AS lease_live'),
      trx.raw(`(uninstall_sent_at IS NOT NULL AND uninstall_sent_at
        + pg_catalog.make_interval(secs => ?) <= pg_catalog.now()) AS settle_elapsed`, [RECONCILE_SETTLE_SECONDS]));
  if (lock) query.forUpdate();
  return query as unknown as Promise<AttemptRow | undefined>;
}

function resolveAttempt(trx: Knex.Transaction, id: string, status: string, outcomeCode: string) {
  return attempts(trx).where({ id }).update({
    status, outcome_code: outcomeCode, resolved_at: trx.fn.now(), ...CLEARED_LEASE, updated_at: trx.fn.now(),
  });
}

type Owner = { attemptId: string; claimToken: string };

type Directive =
  | { kind: 'RESULT'; result: ShopifyAppDisconnectResult }
  | { kind: 'ATTEMPT'; owner: Owner; installationId: number; shopDomain: string }
  | { kind: 'RECONCILE'; owner: Owner; shopDomain: string; providerInstallationGid: string | null }
  | { kind: 'LOCAL_FENCE'; attemptId: string; shopDomain: string };

const result = (value: ShopifyAppDisconnectResult): Directive => ({ kind: 'RESULT', result: value });

/** Recovery for an attempt that may already have uninstalled the app. Never resends the mutation. */
async function recoveryDirective(trx: Knex.Transaction, shopId: number, attempt: AttemptRow): Promise<Directive> {
  if (attempt.status === 'PROVIDER_CONFIRMED') {
    return { kind: 'LOCAL_FENCE', attemptId: attempt.id, shopDomain: attempt.shop_domain };
  }
  if (attempt.status === 'UNINSTALL_SENT') {
    if (attempt.lease_live) return result({ kind: 'IN_PROGRESS' });
    // The process that sent the mutation never recorded its outcome.
    await attempts(trx).where({ id: attempt.id, status: 'UNINSTALL_SENT' }).update({
      status: 'OUTCOME_UNKNOWN', outcome_code: 'OUTCOME_NOT_RECORDED', ...CLEARED_LEASE, updated_at: trx.fn.now(),
    });
    log('uninstall_outcome_not_recorded', shopId);
    attempt = { ...attempt, lease_live: false };
  }
  if (attempt.provider_confirmed) {
    // A late provider confirmation was recorded. A live reconciliation lease
    // belongs to its owner, which promotes it; otherwise promote it here.
    if (attempt.lease_live) {
      return result({ kind: 'PENDING_CONFIRMATION', shopDomain: attempt.shop_domain, reason: 'LOCAL_FENCE_PENDING' });
    }
    await attempts(trx).where({ id: attempt.id, status: 'OUTCOME_UNKNOWN' }).whereNotNull('provider_confirmed_at')
      .update({ status: 'PROVIDER_CONFIRMED', outcome_code: 'PROVIDER_CONFIRMED_LATE', ...CLEARED_LEASE,
        updated_at: trx.fn.now() });
    return { kind: 'LOCAL_FENCE', attemptId: attempt.id, shopDomain: attempt.shop_domain };
  }
  const unknown = (recovery: ShopifyDisconnectRecovery) =>
    result({ kind: 'OUTCOME_UNKNOWN', shopDomain: attempt.shop_domain, recovery });
  if (attempt.reconcile_attempts >= RECONCILE_MAX_ATTEMPTS) return unknown('RECONNECT');
  if (!attempt.settle_elapsed || attempt.lease_live) return unknown('CHECK_LATER');
  const claimToken = crypto.randomUUID();
  await attempts(trx).where({ id: attempt.id }).update({
    claim_token: claimToken, lease_expires_at: leaseFor(trx, RECONCILE_LEASE_SECONDS),
    reconcile_attempts: trx.raw('reconcile_attempts + 1'), reconcile_last_attempt_at: trx.fn.now(),
    updated_at: trx.fn.now(),
  });
  return { kind: 'RECONCILE', owner: { attemptId: attempt.id, claimToken }, shopDomain: attempt.shop_domain,
    providerInstallationGid: attempt.provider_installation_gid };
}

/** Phase 1: one short transaction; no provider I/O. */
function claim(shopId: number, confirmShopDomain: string, mode: ShopifyDisconnectMode): Promise<Directive> {
  return withTenant(shopId, async trx => {
    // Serializes claimers across instances, for this short transaction only.
    await trx.raw('SELECT pg_advisory_xact_lock(hashtext(?), ?)', [DISCONNECT_LOCK_NAMESPACE, shopId]);
    const live = await readLiveAttempt(trx, shopId, true);
    if (live) {
      if (live.status === 'CLAIMED') {
        if (live.lease_live) return result({ kind: 'IN_PROGRESS' });
        // Expired before any intent: nothing irreversible was sent.
        await resolveAttempt(trx, live.id, 'ABORTED', 'LEASE_EXPIRED');
        log('claim_expired', shopId);
      } else if (!await hasUnresolvedShopifyDisconnect(trx, shopId, live.installation_id)) {
        // The app/uninstalled webhook fenced it (provider evidence of the
        // uninstall), or a reinstall/reconnect issued newer verified authority.
        const installation = await trx('shopify_app_installations')
          .where({ id: live.installation_id, shop_id: shopId }).first('uninstalled_at');
        const fenced = !!installation && installation.uninstalled_at !== null;
        await resolveAttempt(trx, live.id, fenced ? 'CONFIRMED' : 'SUPERSEDED',
          fenced ? 'WEBHOOK_FENCED' : 'AUTHORITY_CHANGED');
        log(fenced ? 'attempt_confirmed_by_webhook' : 'attempt_superseded', shopId);
      } else {
        if (normalizeDomain(confirmShopDomain) !== normalizeDomain(live.shop_domain)) {
          return result({ kind: 'CONFIRMATION_MISMATCH' });
        }
        return recoveryDirective(trx, shopId, live);
      }
    }

    const connection = await classifyShopifyConnection(trx, shopId);
    // A status check never starts an irreversible uninstall.
    if (mode === 'RECONCILE') return result({ kind: 'NO_UNRESOLVED_DISCONNECT', connectionState: connection.state });
    if (!isShopifyConnectionReady(connection.state) || !connection.shopDomain || connection.installationId === null) {
      return result({ kind: 'NOT_CONNECTED', connectionState: connection.state });
    }
    if (normalizeDomain(confirmShopDomain) !== normalizeDomain(connection.shopDomain)) {
      return result({ kind: 'CONFIRMATION_MISMATCH' });
    }
    const credential = await trx('shopify_admin_credentials')
      .where({ shop_id: shopId, installation_id: connection.installationId })
      .first('credential_generation');
    if (!credential) return result({ kind: 'NOT_CONNECTED', connectionState: connection.state });

    const claimToken = crypto.randomUUID();
    const [attempt] = await attempts(trx).insert({
      shop_id: shopId, installation_id: connection.installationId, shop_domain: connection.shopDomain,
      credential_generation: credential.credential_generation, status: 'CLAIMED',
      claim_token: claimToken, lease_expires_at: leaseFor(trx, CLAIM_LEASE_SECONDS),
    }).returning('id');
    return { kind: 'ATTEMPT', owner: { attemptId: String(attempt.id), claimToken },
      installationId: connection.installationId, shopDomain: connection.shopDomain };
  });
}

/** Pre-intent exit: nothing was sent, so the attempt simply resolves. */
async function abort(shopId: number, owner: Owner, code: string): Promise<void> {
  await withTenant(shopId, trx => attempts(trx)
    .where({ id: owner.attemptId, claim_token: owner.claimToken, status: 'CLAIMED' })
    .update({ status: 'ABORTED', outcome_code: code, resolved_at: trx.fn.now(), ...CLEARED_LEASE,
      updated_at: trx.fn.now() }));
}

/**
 * Phase 3: commit the durable intent under the canonical T2 lock, pinned to
 * the exact live authority, only while this attempt still owns its lease.
 */
function recordIntent(shopId: number, owner: Owner,
  pin: { installationId: number; generation: string; providerInstallationGid: string },
): Promise<'RECORDED' | 'AUTHORITY_CHANGED' | 'CLAIM_LOST'> {
  return withTenant(shopId, async trx => {
    await lockShopifyAdminCredentialRotation(trx, shopId);
    const current = await trx('shopify_app_installations as installation')
      .join('shopify_admin_credentials as credential', function joinCredential() {
        this.on('credential.installation_id', '=', 'installation.id')
          .andOn('credential.shop_id', '=', 'installation.shop_id');
      })
      .where('installation.shop_id', shopId)
      .andWhere('installation.id', pin.installationId)
      .whereNull('installation.uninstalled_at')
      .first('credential.credential_state', 'credential.credential_generation',
        'credential.access_expires_at', 'credential.refresh_expires_at',
        trx.raw(`(credential.rotation_lease_token IS NOT NULL
          AND credential.rotation_lease_expires_at > pg_catalog.now()) AS lease_live`));
    if (!current || current.credential_state !== 'ACTIVE' || current.lease_live === true
      || String(current.credential_generation) !== pin.generation) return 'AUTHORITY_CHANGED';
    const updated = await attempts(trx)
      .where({ id: owner.attemptId, claim_token: owner.claimToken, status: 'CLAIMED' })
      .whereRaw('lease_expires_at > pg_catalog.now()')
      .update({
        status: 'UNINSTALL_SENT', uninstall_sent_at: trx.fn.now(),
        lease_expires_at: leaseFor(trx, SENT_LEASE_SECONDS),
        credential_generation: pin.generation,
        pinned_access_expires_at: current.access_expires_at,
        pinned_refresh_expires_at: current.refresh_expires_at,
        provider_installation_gid: pin.providerInstallationGid,
        updated_at: trx.fn.now(),
      });
    return updated === 1 ? 'RECORDED' : 'CLAIM_LOST';
  });
}

/** Phase 5: strictly this owner's live UNINSTALL_SENT row. Returns whether it was persisted. */
async function recordOutcome(shopId: number, owner: Owner,
  outcome: { status: 'OUTCOME_UNKNOWN' | 'PROVIDER_CONFIRMED' | 'REJECTED'; code: string }): Promise<boolean> {
  const updated = await withTenant(shopId, trx => attempts(trx)
    .where({ id: owner.attemptId, claim_token: owner.claimToken, status: 'UNINSTALL_SENT' })
    .update({
      status: outcome.status, outcome_code: outcome.code, ...CLEARED_LEASE, updated_at: trx.fn.now(),
      ...(outcome.status === 'PROVIDER_CONFIRMED' ? { provider_confirmed_at: trx.fn.now() } : {}),
      ...(outcome.status === 'REJECTED' ? { resolved_at: trx.fn.now() } : {}),
    }));
  return updated === 1;
}

/**
 * The sender's lease expired before it could record its provider outcome, so
 * the attempt is no longer its own. It never takes over another owner's lease
 * and never touches a resolved attempt (DB-enforced): the result reported is
 * the durable state, plus provider evidence where it can be kept.
 */
async function recordLateOutcome(shopId: number, owner: Owner, outcome: MutationOutcome,
  shopDomain: string): Promise<ShopifyAppDisconnectResult> {
  const current = await withTenant(shopId, async trx => {
    if (outcome.kind === 'SUCCESS') {
      // Additive evidence only: status and any live lease are left to their owner.
      await attempts(trx).where({ id: owner.attemptId })
        .whereIn('status', ['UNINSTALL_SENT', 'OUTCOME_UNKNOWN']).whereNull('provider_confirmed_at')
        .update({ provider_confirmed_at: trx.fn.now(), updated_at: trx.fn.now() });
      // Without a live owner, promote it now.
      await attempts(trx).where({ id: owner.attemptId, status: 'OUTCOME_UNKNOWN' })
        .whereNotNull('provider_confirmed_at')
        .where(function free() {
          this.whereNull('lease_expires_at').orWhereRaw('lease_expires_at <= pg_catalog.now()');
        })
        .update({ status: 'PROVIDER_CONFIRMED', outcome_code: 'PROVIDER_CONFIRMED_LATE', ...CLEARED_LEASE,
          updated_at: trx.fn.now() });
    }
    return attempts(trx).where({ id: owner.attemptId }).first('status', 'outcome_code');
  });
  log('late_provider_outcome', shopId, { outcome: outcome.kind, currentStatus: current?.status ?? null });
  const connectionState = () => withTenant(shopId, trx => classifyShopifyConnection(trx, shopId))
    .then(connection => connection.state);
  switch (current?.status) {
    case 'PROVIDER_CONFIRMED':
      return localFenceOrPending(shopId, owner.attemptId, shopDomain);
    case 'CONFIRMED':
      return { kind: 'DISCONNECTED', shopDomain, connectionState: await connectionState() };
    case 'SUPERSEDED':
      return outcome.kind === 'SUCCESS'
        ? { kind: 'PENDING_CONFIRMATION', shopDomain, reason: 'AUTHORITY_CHANGED' }
        : { kind: 'NO_UNRESOLVED_DISCONNECT', connectionState: await connectionState() };
    case 'NOT_UNINSTALLED':
      if (outcome.kind === 'REJECTED') return { kind: 'REJECTED', providerErrorCodes: outcome.codes };
      if (outcome.kind === 'SUCCESS') {
        // Unreachable within the deadline/settle bounds; never rewritten. The webhook fences it.
        log('late_confirmation_contradicts_reconciliation', shopId);
        return { kind: 'PENDING_CONFIRMATION', shopDomain, reason: 'LOCAL_FENCE_PENDING' };
      }
      return { kind: 'NOT_UNINSTALLED', shopDomain };
    default:
      // Still unresolved: provider confirmation is kept for its owner; anything
      // else is reported as the durable unknown state.
      return outcome.kind === 'SUCCESS'
        ? { kind: 'PENDING_CONFIRMATION', shopDomain, reason: 'LOCAL_FENCE_PENDING' }
        : { kind: 'OUTCOME_UNKNOWN', shopDomain, recovery: 'CHECK_LATER' };
  }
}

/**
 * Local fence for a provider-confirmed uninstall, pinned to the attempt's
 * installation and generation through the canonical GH-1068 handler. A moved
 * authority is never fenced.
 */
function applyLocalFence(shopId: number, attemptId: string): Promise<ShopifyAppDisconnectResult> {
  return withTenant(shopId, async trx => {
    const attempt = await attempts(trx).where({ id: attemptId, shop_id: shopId, status: 'PROVIDER_CONFIRMED' })
      .forUpdate().first('installation_id', 'shop_domain', 'credential_generation');
    if (!attempt) {
      const connection = await classifyShopifyConnection(trx, shopId);
      return { kind: 'NOT_CONNECTED', connectionState: connection.state } as const;
    }
    const shopDomain = attempt.shop_domain as string;
    const fenced = await handleAppUninstalled(shopId, trx, {
      installationId: attempt.installation_id, shopDomain,
      credentialGeneration: String(attempt.credential_generation),
    });
    if (!fenced) {
      const installation = await trx('shopify_app_installations')
        .where({ id: attempt.installation_id, shop_id: shopId }).first('uninstalled_at');
      if (!installation || installation.uninstalled_at === null) {
        if (await hasUnresolvedShopifyDisconnect(trx, shopId, attempt.installation_id)) {
          // Same material under a moved epoch: stay fail-closed for the webhook or a reconnect.
          log('local_fence_deferred', shopId, { reason: 'EPOCH_MOVED' });
          return { kind: 'PENDING_CONFIRMATION', shopDomain, reason: 'LOCAL_FENCE_PENDING' } as const;
        }
        // A newer verified authority exists (reinstall or reconnect). Never fence it.
        await resolveAttempt(trx, attemptId, 'SUPERSEDED', 'AUTHORITY_CHANGED');
        log('local_fence_superseded', shopId);
        return { kind: 'PENDING_CONFIRMATION', shopDomain, reason: 'AUTHORITY_CHANGED' } as const;
      }
      // Otherwise the app/uninstalled webhook fenced this installation first.
    }
    await resolveAttempt(trx, attemptId, 'CONFIRMED', fenced ? 'LOCAL_FENCE_APPLIED' : 'WEBHOOK_FENCED');
    const after = await classifyShopifyConnection(trx, shopId);
    log('disconnected', shopId, { connectionState: after.state });
    return { kind: 'DISCONNECTED', shopDomain, connectionState: after.state } as const;
  });
}

async function localFenceOrPending(shopId: number, attemptId: string, shopDomain: string): Promise<ShopifyAppDisconnectResult> {
  try {
    return await applyLocalFence(shopId, attemptId);
  } catch (error) {
    // Shopify confirmed; the durable PROVIDER_CONFIRMED record keeps LaSyncro
    // fail-closed and the next owner request (or the webhook) completes it.
    log('local_fence_failed', shopId, { message: error instanceof Error ? error.message : 'unknown' });
    return { kind: 'PENDING_CONFIRMATION', shopDomain, reason: 'LOCAL_FENCE_PENDING' };
  }
}

/** Bounded reconciliation: one read with the pinned grant, never the mutation. */
async function reconcile(shopId: number, directive: Extract<Directive, { kind: 'RECONCILE' }>): Promise<ShopifyAppDisconnectResult> {
  const { owner } = directive;
  const inconclusive = async (reason: string): Promise<ShopifyAppDisconnectResult> => {
    log('reconcile_inconclusive', shopId, { reason });
    const settled = await withTenant(shopId, async trx => {
      // A late provider confirmation recorded during this lease: its owner promotes it.
      const promoted = await attempts(trx)
        .where({ id: owner.attemptId, claim_token: owner.claimToken, status: 'OUTCOME_UNKNOWN' })
        .whereNotNull('provider_confirmed_at')
        .update({ status: 'PROVIDER_CONFIRMED', outcome_code: 'PROVIDER_CONFIRMED_LATE', ...CLEARED_LEASE,
          updated_at: trx.fn.now() });
      if (promoted === 1) return { promoted: true, used: 0 };
      await attempts(trx).where({ id: owner.attemptId, claim_token: owner.claimToken, status: 'OUTCOME_UNKNOWN' })
        .update({ ...CLEARED_LEASE, updated_at: trx.fn.now() });
      const row = await attempts(trx).where({ id: owner.attemptId }).first('reconcile_attempts');
      return { promoted: false, used: Number(row?.reconcile_attempts) };
    });
    if (settled.promoted) return localFenceOrPending(shopId, owner.attemptId, directive.shopDomain);
    return { kind: 'OUTCOME_UNKNOWN', shopDomain: directive.shopDomain,
      recovery: settled.used < RECONCILE_MAX_ATTEMPTS ? 'CHECK_LATER' : 'RECONNECT' };
  };

  const credential = await resolveShopifyAdminCredentialForDisconnectReconciliation({ shopId, attemptId: owner.attemptId });
  if (credential.kind !== 'READY') return inconclusive('PINNED_CREDENTIAL_UNAVAILABLE');
  let evidence: any;
  try {
    const client = await graphqlClient(credential.accessToken, credential.shopDomain, shopId);
    evidence = await providerRequest(client, SHOPIFY_DISCONNECT_PRECHECK_QUERY);
  } catch (error) {
    // 401/403 included: an authentication failure alone is not proof of uninstall.
    const status = httpStatus(error);
    return inconclusive(status === null ? 'TRANSPORT' : `HTTP_${status}`);
  }
  const servedDomain = evidence?.data?.shop?.myshopifyDomain;
  const installationGid = evidence?.data?.currentAppInstallation?.id;
  if (typeof servedDomain !== 'string' || normalizeDomain(servedDomain) !== normalizeDomain(credential.shopDomain)
    || typeof installationGid !== 'string' || !directive.providerInstallationGid
    || installationGid !== directive.providerInstallationGid) {
    return inconclusive('EVIDENCE_MISMATCH');
  }
  // The same provider installation still answers with the pinned grant after
  // the settle window: the uninstall did not take effect. Nothing is resent.
  const resolved = await withTenant(shopId, trx => attempts(trx)
    .where({ id: owner.attemptId, claim_token: owner.claimToken, status: 'OUTCOME_UNKNOWN' })
    // Provider confirmation outranks a read: never resolve NOT_UNINSTALLED over it.
    .whereNull('provider_confirmed_at')
    .update({ status: 'NOT_UNINSTALLED', outcome_code: 'PROVIDER_STILL_INSTALLED', resolved_at: trx.fn.now(),
      ...CLEARED_LEASE, updated_at: trx.fn.now() }));
  if (resolved !== 1) return inconclusive('NOT_RESOLVABLE');
  log('reconciled_not_uninstalled', shopId);
  return { kind: 'NOT_UNINSTALLED', shopDomain: directive.shopDomain };
}

/** Phases 2–5 for a fresh claim. */
async function attemptUninstall(shopId: number, directive: Extract<Directive, { kind: 'ATTEMPT' }>): Promise<ShopifyAppDisconnectResult> {
  const { owner } = directive;
  let client: GraphqlClient;
  try {
    // Phase 2: credential (its own short lifecycle transactions) and guard read; no tx held.
    const credential = await resolveShopifyAdminCredentialForConsumer({ shopId, now: new Date() });
    if (credential.kind !== 'READY') {
      log('credential_unavailable', shopId, { credentialKind: credential.kind });
      await abort(shopId, owner, 'CREDENTIAL_UNAVAILABLE');
      return { kind: 'CREDENTIAL_UNAVAILABLE',
        retryable: credential.kind === 'REFRESH_IN_PROGRESS' || credential.kind === 'RETRYABLE' };
    }
    if (credential.installationId !== directive.installationId
      || normalizeDomain(credential.shopDomain) !== normalizeDomain(directive.shopDomain)) {
      log('credential_identity_moved', shopId);
      await abort(shopId, owner, 'AUTHORITY_CHANGED');
      return { kind: 'CREDENTIAL_UNAVAILABLE', retryable: true };
    }

    client = await graphqlClient(credential.accessToken, credential.shopDomain, shopId);
    let providerInstallationGid: string;
    try {
      const precheck: any = await providerRequest(client, SHOPIFY_DISCONNECT_PRECHECK_QUERY);
      const servedDomain = precheck?.data?.shop?.myshopifyDomain;
      const installationGid = precheck?.data?.currentAppInstallation?.id;
      if (typeof servedDomain !== 'string' || typeof installationGid !== 'string' || !installationGid) {
        log('precheck_malformed', shopId);
        await abort(shopId, owner, 'PRECHECK_MALFORMED');
        return { kind: 'PROVIDER_UNAVAILABLE', retryable: true };
      }
      if (normalizeDomain(servedDomain) !== normalizeDomain(credential.shopDomain)) {
        log('precheck_identity_mismatch', shopId);
        await abort(shopId, owner, 'IDENTITY_MISMATCH');
        return { kind: 'IDENTITY_MISMATCH' };
      }
      providerInstallationGid = installationGid;
    } catch (error) {
      const status = httpStatus(error);
      log('precheck_failed', shopId, { httpStatus: status,
        deadline: error instanceof Error && error.message === DEADLINE_EXCEEDED });
      await abort(shopId, owner, 'PRECHECK_FAILED');
      return { kind: 'PROVIDER_UNAVAILABLE', retryable: status !== 401 && status !== 403 };
    }

    // Phase 3: durable intent before the irreversible mutation. The in-memory
    // grant is exactly the generation pinned here under the T2 lock.
    const intent = await recordIntent(shopId, owner, { installationId: credential.installationId,
      generation: credential.generation, providerInstallationGid });
    if (intent !== 'RECORDED') {
      log('intent_refused', shopId, { reason: intent });
      await abort(shopId, owner, intent);
      return intent === 'CLAIM_LOST'
        ? { kind: 'PROVIDER_UNAVAILABLE', retryable: true }
        : { kind: 'CREDENTIAL_UNAVAILABLE', retryable: true };
    }
  } catch (error) {
    // Interrupted before any intent: nothing was sent. If this abort cannot
    // commit either, the claim lease expires and the next request resolves it.
    await abort(shopId, owner, 'INTERRUPTED').catch(() => undefined);
    throw error;
  }

  // Phase 4: exactly one appUninstall. Every failure from here is AMBIGUOUS.
  let outcome: MutationOutcome;
  try {
    outcome = classifyMutation(await providerRequest(client, SHOPIFY_APP_UNINSTALL_MUTATION));
  } catch (error) {
    outcome = { kind: 'AMBIGUOUS' };
    log('uninstall_ambiguous', shopId, { httpStatus: httpStatus(error),
      reason: error instanceof Error && error.message === DEADLINE_EXCEEDED ? 'deadline' : 'thrown' });
  }

  // Phase 5: durable outcome. A recording failure leaves UNINSTALL_SENT, which
  // expires into OUTCOME_UNKNOWN: still fail-closed, never repeated. Zero rows
  // means this sender lost its lease: never treated as persisted.
  try {
    if (outcome.kind === 'REJECTED') {
      if (!await recordOutcome(shopId, owner, { status: 'REJECTED', code: outcome.codes[0] ?? 'PROVIDER_REJECTED' })) {
        return await recordLateOutcome(shopId, owner, outcome, directive.shopDomain);
      }
      log('uninstall_rejected', shopId, { providerErrorCodes: outcome.codes });
      return { kind: 'REJECTED', providerErrorCodes: outcome.codes };
    }
    if (outcome.kind === 'AMBIGUOUS') {
      if (!await recordOutcome(shopId, owner, { status: 'OUTCOME_UNKNOWN', code: 'PROVIDER_OUTCOME_UNKNOWN' })) {
        return await recordLateOutcome(shopId, owner, outcome, directive.shopDomain);
      }
      log('uninstall_outcome_unknown', shopId);
      return { kind: 'OUTCOME_UNKNOWN', shopDomain: directive.shopDomain, recovery: 'CHECK_LATER' };
    }
    if (!await recordOutcome(shopId, owner, { status: 'PROVIDER_CONFIRMED', code: 'PROVIDER_CONFIRMED' })) {
      return await recordLateOutcome(shopId, owner, outcome, directive.shopDomain);
    }
  } catch (error) {
    log('outcome_record_failed', shopId, { outcome: outcome.kind,
      message: error instanceof Error ? error.message : 'unknown' });
    return outcome.kind === 'SUCCESS'
      ? { kind: 'PENDING_CONFIRMATION', shopDomain: directive.shopDomain, reason: 'LOCAL_FENCE_PENDING' }
      : { kind: 'OUTCOME_UNKNOWN', shopDomain: directive.shopDomain, recovery: 'CHECK_LATER' };
  }
  log('uninstall_confirmed_by_provider', shopId);
  return localFenceOrPending(shopId, owner.attemptId, directive.shopDomain);
}

export async function disconnectShopifyApp(input: {
  shopId: number;
  confirmShopDomain: string;
  mode?: ShopifyDisconnectMode;
}): Promise<ShopifyAppDisconnectResult> {
  const directive = await claim(input.shopId, input.confirmShopDomain, input.mode ?? 'UNINSTALL');
  switch (directive.kind) {
    case 'RESULT': return directive.result;
    case 'RECONCILE': return reconcile(input.shopId, directive);
    case 'LOCAL_FENCE': return localFenceOrPending(input.shopId, directive.attemptId, directive.shopDomain);
    case 'ATTEMPT': return attemptUninstall(input.shopId, directive);
  }
}

/** Visibility for Settings: the tenant's unresolved disconnect, if any. Pure read. */
export function readShopifyDisconnectState(shopId: number): Promise<ShopifyDisconnectState> {
  return withTenant(shopId, async trx => {
    const live = await readLiveAttempt(trx, shopId, false);
    if (!live || live.status === 'CLAIMED') return null;
    if (!await hasUnresolvedShopifyDisconnect(trx, shopId, live.installation_id)) return null;
    if (live.status === 'PROVIDER_CONFIRMED' || live.provider_confirmed) {
      return { status: 'LOCAL_FENCE_PENDING', shopDomain: live.shop_domain, recovery: null };
    }
    if (live.status === 'UNINSTALL_SENT' && live.lease_live) {
      return { status: 'IN_PROGRESS', shopDomain: live.shop_domain, recovery: null };
    }
    return { status: 'OUTCOME_UNKNOWN', shopDomain: live.shop_domain,
      recovery: live.reconcile_attempts >= RECONCILE_MAX_ATTEMPTS ? 'RECONNECT' : 'CHECK_LATER' };
  });
}
