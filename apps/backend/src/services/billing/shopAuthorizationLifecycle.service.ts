import crypto from 'crypto';
import type { Knex } from 'knex';

const AUTHORIZATION_TABLE = 'shop_authorizations';
const EVENT_TABLE = 'shop_authorization_events';
const COMMERCIAL_LOCK_NAMESPACE = 91002;
const EVENT_IDENTITY_CONSTRAINT = 'shop_authorization_events_identity_unique';

export type AuthorizationTargetKind = 'module' | 'flag';
export type AuthorizationOperation = 'grant' | 'revoke';

export interface AuthorizationIdentity {
  authorizationId?: string;
  shopId: number;
  targetKind: AuthorizationTargetKind;
  targetKey: string;
  authorityKind: string;
  authorityRef: string;
  lifecycleOwnerKind: string;
  lifecycleOwnerRef: string;
  validFrom?: Date;
  validUntil?: Date | null;
  provider?: string | null;
  providerSubscriptionId?: string | null;
}

export interface RevocationScope {
  authorizationId?: string;
  lifecycleOwnerKind?: string;
  lifecycleOwnerRef?: string;
  targetKind?: AuthorizationTargetKind;
  targetKey?: string;
}

export interface RevocationProvenance {
  revokedAt?: Date;
  revokedByKind: string;
  revokedByRef: string;
  reason: string;
}

export interface TrustedAuthorizationEvent {
  shopId: number;
  operation: AuthorizationOperation;
  authorityKind: string;
  authorityRef: string;
  sourceEventKey: string;
  targetKind: AuthorizationTargetKind;
  targetKey: string;
  lifecycleOwnerKind: string;
  lifecycleOwnerRef: string;
  validFrom?: Date;
  validUntil?: Date | null;
  provider?: string | null;
  providerSubscriptionId?: string | null;
  transitionIdentity?: string | null;
  authorizationId?: string;
  revocation?: RevocationProvenance;
}

export interface GrantResult {
  authorizationId: string;
  applied: boolean;
}

export interface RevocationResult {
  authorizationIds: string[];
  applied: boolean;
}

export type AuthorizationEventResult =
  | { outcome: 'applied'; eventId: string; authorizationIds: string[]; payloadHash: string }
  | { outcome: 'replay'; eventId: string; authorizationIds: string[]; payloadHash: string }
  | { outcome: 'conflict'; eventId: string; authorizationIds: string[]; payloadHash: string };

interface PgError extends Error {
  code?: string;
  constraint?: string;
}

function iso(value: Date | null | undefined): string | null {
  return value == null ? null : value.toISOString();
}

function canonicalPayload(event: TrustedAuthorizationEvent): Record<string, unknown> {
  return {
    operation: event.operation,
    targetKind: event.targetKind,
    targetKey: event.targetKey,
    authorityKind: event.authorityKind,
    authorityRef: event.authorityRef,
    lifecycleOwnerKind: event.lifecycleOwnerKind,
    lifecycleOwnerRef: event.lifecycleOwnerRef,
    validFrom: iso(event.validFrom),
    validUntil: iso(event.validUntil),
    provider: event.provider ?? null,
    providerSubscriptionId: event.providerSubscriptionId ?? null,
    transitionIdentity: event.transitionIdentity ?? null,
    authorizationId: event.authorizationId ?? null,
  };
}

export function hashAuthorizationEvent(event: TrustedAuthorizationEvent): string {
  return crypto.createHash('sha256').update(JSON.stringify(canonicalPayload(event))).digest('hex');
}

function requireText(value: string, field: string): void {
  if (value.trim().length === 0) throw new Error(`[authorization-lifecycle] ${field} is required`);
}

function validateIdentity(input: AuthorizationIdentity): void {
  requireText(input.targetKey, 'targetKey');
  requireText(input.authorityKind, 'authorityKind');
  requireText(input.authorityRef, 'authorityRef');
  requireText(input.lifecycleOwnerKind, 'lifecycleOwnerKind');
  requireText(input.lifecycleOwnerRef, 'lifecycleOwnerRef');
  if (input.authorityKind === 'subscription' && (!input.provider || !input.providerSubscriptionId)) {
    throw new Error('[authorization-lifecycle] subscription authority requires verified provider attribution');
  }
}

async function assertTenantScope(shopId: number, trx: Knex): Promise<void> {
  const { rows } = await trx.raw(
    `SELECT NULLIF(current_setting('app.current_tenant', true), '')::integer AS tenant_id`
  );
  if (rows[0]?.tenant_id !== shopId) {
    throw new Error(`[authorization-lifecycle] caller tenant does not match shop ${shopId}`);
  }
}

async function lockShop(shopId: number, trx: Knex): Promise<void> {
  await assertTenantScope(shopId, trx);
  await trx.raw('SELECT pg_advisory_xact_lock(?, ?)', [COMMERCIAL_LOCK_NAMESPACE, shopId]);
}

async function grantLocked(input: AuthorizationIdentity, trx: Knex): Promise<GrantResult> {
  validateIdentity(input);
  const existing = await trx(AUTHORIZATION_TABLE)
    .where({
      shop_id: input.shopId,
      target_kind: input.targetKind,
      target_key: input.targetKey,
      authority_kind: input.authorityKind,
      authority_ref: input.authorityRef,
    })
    .whereNull('revoked_at')
    .whereNull('valid_until')
    .first('id');
  if (existing) return { authorizationId: existing.id, applied: false };

  const [row] = await trx(AUTHORIZATION_TABLE).insert({
    ...(input.authorizationId ? { id: input.authorizationId } : {}),
    shop_id: input.shopId,
    target_kind: input.targetKind,
    target_key: input.targetKey,
    authority_kind: input.authorityKind,
    authority_ref: input.authorityRef,
    lifecycle_owner_kind: input.lifecycleOwnerKind,
    lifecycle_owner_ref: input.lifecycleOwnerRef,
    valid_from: input.validFrom ?? trx.fn.now(),
    valid_until: input.validUntil ?? null,
    provider: input.provider ?? null,
    provider_subscription_id: input.providerSubscriptionId ?? null,
  }).returning('id');
  return { authorizationId: row.id, applied: true };
}

export async function grantAuthorization(
  input: AuthorizationIdentity,
  trx: Knex
): Promise<GrantResult> {
  await lockShop(input.shopId, trx);
  return grantLocked(input, trx);
}

interface RevokingAuthority {
  authorityKind: string;
  authorityRef: string;
}

async function revokeLocked(
  shopId: number,
  scope: RevocationScope,
  provenance: RevocationProvenance,
  trx: Knex,
  authority?: RevokingAuthority
): Promise<RevocationResult> {
  const targeted = typeof scope.authorizationId === 'string';
  const lifecycleScoped =
    typeof scope.lifecycleOwnerKind === 'string' && typeof scope.lifecycleOwnerRef === 'string';
  if (targeted === lifecycleScoped) {
    throw new Error('[authorization-lifecycle] revocation requires exactly one verified scope');
  }
  requireText(provenance.revokedByKind, 'revokedByKind');
  requireText(provenance.revokedByRef, 'revokedByRef');
  requireText(provenance.reason, 'reason');

  let query = trx(AUTHORIZATION_TABLE).where({ shop_id: shopId }).whereNull('revoked_at');
  // Event revocation may only close authorizations owned by the event's own authority.
  if (authority) {
    query = query.andWhere({
      authority_kind: authority.authorityKind,
      authority_ref: authority.authorityRef,
    });
  }
  if (targeted) {
    query = query.andWhere({ id: scope.authorizationId });
  } else {
    query = query.andWhere({
      lifecycle_owner_kind: scope.lifecycleOwnerKind,
      lifecycle_owner_ref: scope.lifecycleOwnerRef,
    });
    if (scope.targetKind) query = query.andWhere({ target_kind: scope.targetKind });
    if (scope.targetKey) query = query.andWhere({ target_key: scope.targetKey });
  }

  const rows = await query.clone().select('id', 'valid_from', 'valid_until').forUpdate();
  if (rows.length === 0) return { authorizationIds: [], applied: false };
  const requestedAt = provenance.revokedAt ?? new Date();

  for (const row of rows) {
    const validFrom = new Date(row.valid_from);
    const closedAt = requestedAt.getTime() > validFrom.getTime()
      ? requestedAt
      : new Date(validFrom.getTime() + 1);
    // Never extend an earlier recorded expiration.
    const validUntil = row.valid_until != null && new Date(row.valid_until).getTime() < closedAt.getTime()
      ? new Date(row.valid_until)
      : closedAt;
    await trx(AUTHORIZATION_TABLE).where({ shop_id: shopId, id: row.id }).update({
      valid_until: validUntil,
      revoked_at: closedAt,
      revoked_by_kind: provenance.revokedByKind,
      revoked_by_ref: provenance.revokedByRef,
      revocation_reason: provenance.reason,
      updated_at: trx.fn.now(),
    });
  }
  return { authorizationIds: rows.map((row: any) => row.id), applied: true };
}

export async function revokeAuthorization(
  shopId: number,
  scope: RevocationScope,
  provenance: RevocationProvenance,
  trx: Knex
): Promise<RevocationResult> {
  await lockShop(shopId, trx);
  return revokeLocked(shopId, scope, provenance, trx);
}

export async function processAuthorizationEvent(
  event: TrustedAuthorizationEvent,
  trx: Knex
): Promise<AuthorizationEventResult> {
  requireText(event.sourceEventKey, 'sourceEventKey');
  await lockShop(event.shopId, trx);
  const payloadHash = hashAuthorizationEvent(event);

  const existing = await trx(EVENT_TABLE).where({
    shop_id: event.shopId,
    authority_kind: event.authorityKind,
    authority_ref: event.authorityRef,
    source_event_key: event.sourceEventKey,
  }).first('id', 'authorization_id', 'payload_hash');
  if (existing) {
    return {
      outcome: existing.payload_hash === payloadHash ? 'replay' : 'conflict',
      eventId: existing.id,
      authorizationIds: [existing.authorization_id],
      payloadHash,
    };
  }

  let mutation: GrantResult | RevocationResult;
  if (event.operation === 'grant') {
    mutation = await grantLocked({
      authorizationId: event.authorizationId,
      shopId: event.shopId,
      targetKind: event.targetKind,
      targetKey: event.targetKey,
      authorityKind: event.authorityKind,
      authorityRef: event.authorityRef,
      lifecycleOwnerKind: event.lifecycleOwnerKind,
      lifecycleOwnerRef: event.lifecycleOwnerRef,
      validFrom: event.validFrom,
      validUntil: event.validUntil,
      provider: event.provider,
      providerSubscriptionId: event.providerSubscriptionId,
    }, trx);
  } else {
    if (!event.revocation) {
      throw new Error('[authorization-lifecycle] revocation provenance is required');
    }
    mutation = await revokeLocked(event.shopId, event.authorizationId
      ? { authorizationId: event.authorizationId }
      : {
          lifecycleOwnerKind: event.lifecycleOwnerKind,
          lifecycleOwnerRef: event.lifecycleOwnerRef,
          targetKind: event.targetKind,
          targetKey: event.targetKey,
        }, event.revocation, trx, {
          authorityKind: event.authorityKind,
          authorityRef: event.authorityRef,
        });
    if (!mutation.applied || mutation.authorizationIds.length !== 1) {
      throw new Error('[authorization-lifecycle] event revocation must resolve exactly one authorization');
    }
  }

  const authorizationIds = 'authorizationId' in mutation
    ? [mutation.authorizationId]
    : mutation.authorizationIds;
  if (authorizationIds.length !== 1) {
    throw new Error('[authorization-lifecycle] event must produce exactly one authorization effect');
  }

  try {
    const [inserted] = await trx(EVENT_TABLE).insert({
      shop_id: event.shopId,
      authority_kind: event.authorityKind,
      authority_ref: event.authorityRef,
      source_event_key: event.sourceEventKey,
      payload_hash: payloadHash,
      event_kind: event.operation,
      target_kind: event.targetKind,
      target_key: event.targetKey,
      authorization_id: authorizationIds[0],
      occurred_at: trx.fn.now(),
    }).returning('id');
    return { outcome: 'applied', eventId: inserted.id, authorizationIds, payloadHash };
  } catch (error) {
    const pgError = error as PgError;
    if (pgError.code === '23505' && pgError.constraint === EVENT_IDENTITY_CONSTRAINT) {
      throw new Error('[authorization-lifecycle] event identity raced after canonical shop lock');
    }
    throw error;
  }
}
