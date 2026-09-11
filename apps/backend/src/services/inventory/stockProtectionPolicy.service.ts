// apps/backend/src/services/inventory/stockProtectionPolicy.service.ts
//
// STOCK-PROTECT-01 — canonical mutation/history/resolution boundary for the
// durable Stock Protection Policy (migration 0171:
// stock_protection_policies / stock_protection_policy_transitions).
// ============================================================================
// THE ONE place allowed to mutate stock_protection_policies. Every material
// change writes exactly one append-only transition row in the SAME
// transaction (mirrors subscriptionTransition.service.ts's precedent for
// shop_subscriptions / shop_subscription_transitions). A no-op resubmission
// (resulting authoritative state identical to current) writes no transition
// and does not bump version.
//
// CONCURRENCY: modifying an existing policy requires expected_version.
// `SELECT ... FOR UPDATE` on the current-policy row serializes concurrent
// writers within their own transactions (withTenant gives each call its own
// transaction) — a stale writer's read of `current` after the row lock
// releases already reflects the winner's version, so the expected_version
// comparison below detects it deterministically rather than racing.
//
// SUPPLIER AUTHORITY: an approved policy's planning_supplier_id, once set, is
// never silently reassigned by a newer purchase order. If that anchored
// supplier is later invalid/inactive, resolveEffectivePolicy fails visibly
// into planning_status: 'planning_data_required' rather than substituting a
// different supplier.
//
// TENANT SAFETY: shopId always comes from the caller's authenticated
// context, never trusted from a client-supplied variant/supplier id alone —
// both are re-validated as belonging to that shop inside this boundary.

import type { Knex } from 'knex';
import {
  resolveEffectivePolicy as resolveEffectivePolicyPure,
  type EffectivePolicy,
} from './stockProtectionPolicyResolution.js';

const CURRENT_TABLE = 'stock_protection_policies';
const TRANSITIONS_TABLE = 'stock_protection_policy_transitions';

export class StockProtectionPolicyValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'StockProtectionPolicyValidationError';
  }
}

/** Raised when modifying an existing policy without expected_version. */
export class StockProtectionPolicyVersionRequiredError extends Error {
  readonly shopId: number;
  readonly variantId: string;

  constructor(shopId: number, variantId: string) {
    super(
      `[stock-protection-policy] expected_version is required to modify the existing policy ` +
        `for shop ${shopId}, variant ${variantId}.`
    );
    this.name = 'StockProtectionPolicyVersionRequiredError';
    this.shopId = shopId;
    this.variantId = variantId;
  }
}

/** Raised when a caller's expected_version does not match the current version (stale writer). */
export class StockProtectionPolicyConflictError extends Error {
  readonly shopId: number;
  readonly variantId: string;
  readonly expectedVersion: number;
  readonly currentVersion: number;

  constructor(shopId: number, variantId: string, expectedVersion: number, currentVersion: number) {
    super(
      `[stock-protection-policy] conflict: expected version ${expectedVersion} but current version ` +
        `is ${currentVersion} for shop ${shopId}, variant ${variantId}.`
    );
    this.name = 'StockProtectionPolicyConflictError';
    this.shopId = shopId;
    this.variantId = variantId;
    this.expectedVersion = expectedVersion;
    this.currentVersion = currentVersion;
  }
}

export interface UpsertStockProtectionPolicyInput {
  shopId: number;
  variantId: string;
  safetyDays: number;
  reviewCycleDays: number;
  planningSupplierId: number | null;

  /** Mandatory when modifying an EXISTING policy; ignored on creation. */
  expectedVersion?: number;

  // Mandatory transition provenance.
  source: string;
  reason: string;
  actorType: string;
  actorId?: string | null;

  /**
   * Immutable historical evidence only — persisted to the transition row and
   * NEVER read back by resolveEffectivePolicy as future planning input.
   */
  recommendationSnapshot?: Record<string, unknown> | null;
}

export interface UpsertStockProtectionPolicyResult {
  current: CurrentPolicyRowDb;
  transitionCreated: boolean;
}

interface CurrentPolicyRowDb {
  id: number;
  shop_id: number;
  lasyncro_variant_id: string;
  version: number;
  safety_days: number;
  review_cycle_days: number;
  planning_supplier_id: number | null;
  source: string;
  approved_by_actor_type: string;
  approved_by_actor_id: string | null;
  approved_at: Date;
  created_at: Date;
  updated_at: Date;
}

async function assertVariantOwnedByTenant(trx: Knex.Transaction, shopId: number, variantId: string): Promise<void> {
  const variant = await trx('variants')
    .where({ lasyncro_variant_id: variantId, shop_id: shopId })
    .first('lasyncro_variant_id');
  if (!variant) {
    throw new StockProtectionPolicyValidationError(
      `[stock-protection-policy] variant ${variantId} does not belong to shop ${shopId}.`
    );
  }
}

async function assertSupplierUsableByTenant(
  trx: Knex.Transaction,
  shopId: number,
  supplierId: number
): Promise<void> {
  const supplier = await trx('suppliers').where({ id: supplierId, shop_id: shopId }).first('id', 'active');
  if (!supplier) {
    throw new StockProtectionPolicyValidationError(
      `[stock-protection-policy] supplier ${supplierId} does not belong to shop ${shopId}.`
    );
  }
  if (!supplier.active) {
    throw new StockProtectionPolicyValidationError(
      `[stock-protection-policy] supplier ${supplierId} is not active and cannot be set as the planning anchor.`
    );
  }
}

/**
 * Creates or changes the approved policy for one shop+variant. See module
 * header for the concurrency, atomicity, and no-op contracts.
 */
export async function upsertStockProtectionPolicy(
  trx: Knex.Transaction,
  input: UpsertStockProtectionPolicyInput
): Promise<UpsertStockProtectionPolicyResult> {
  const { shopId, variantId } = input;

  await assertVariantOwnedByTenant(trx, shopId, variantId);
  if (input.planningSupplierId != null) {
    await assertSupplierUsableByTenant(trx, shopId, input.planningSupplierId);
  }

  const current = (await trx(CURRENT_TABLE)
    .where({ shop_id: shopId, lasyncro_variant_id: variantId })
    .forUpdate()
    .first()) as CurrentPolicyRowDb | undefined;

  const now = new Date();
  const nextPlanningSupplierId = input.planningSupplierId ?? null;
  const recommendationSnapshot =
    input.recommendationSnapshot != null ? JSON.stringify(input.recommendationSnapshot) : null;

  if (!current) {
    const [inserted] = (await trx(CURRENT_TABLE)
      .insert({
        shop_id: shopId,
        lasyncro_variant_id: variantId,
        version: 1,
        safety_days: input.safetyDays,
        review_cycle_days: input.reviewCycleDays,
        planning_supplier_id: nextPlanningSupplierId,
        source: input.source,
        approved_by_actor_type: input.actorType,
        approved_by_actor_id: input.actorId ?? null,
        approved_at: now,
        created_at: now,
        updated_at: now,
      })
      .returning('*')) as CurrentPolicyRowDb[];

    await trx(TRANSITIONS_TABLE).insert({
      shop_id: shopId,
      policy_id: inserted.id,
      lasyncro_variant_id: variantId,
      from_version: null,
      to_version: 1,
      from_safety_days: null,
      to_safety_days: input.safetyDays,
      from_review_cycle_days: null,
      to_review_cycle_days: input.reviewCycleDays,
      from_planning_supplier_id: null,
      to_planning_supplier_id: nextPlanningSupplierId,
      source: input.source,
      reason: input.reason,
      actor_type: input.actorType,
      actor_id: input.actorId ?? null,
      recommendation_snapshot: recommendationSnapshot,
      occurred_at: now,
      created_at: now,
    });

    return { current: inserted, transitionCreated: true };
  }

  if (input.expectedVersion === undefined || input.expectedVersion === null) {
    throw new StockProtectionPolicyVersionRequiredError(shopId, variantId);
  }
  if (input.expectedVersion !== current.version) {
    throw new StockProtectionPolicyConflictError(shopId, variantId, input.expectedVersion, current.version);
  }

  const unchanged =
    current.safety_days === input.safetyDays &&
    current.review_cycle_days === input.reviewCycleDays &&
    current.planning_supplier_id === nextPlanningSupplierId;

  if (unchanged) {
    return { current, transitionCreated: false };
  }

  const nextVersion = current.version + 1;

  const [updated] = (await trx(CURRENT_TABLE)
    .where({ shop_id: shopId, lasyncro_variant_id: variantId, version: current.version })
    .update({
      version: nextVersion,
      safety_days: input.safetyDays,
      review_cycle_days: input.reviewCycleDays,
      planning_supplier_id: nextPlanningSupplierId,
      source: input.source,
      approved_by_actor_type: input.actorType,
      approved_by_actor_id: input.actorId ?? null,
      approved_at: now,
      updated_at: now,
    })
    .returning('*')) as CurrentPolicyRowDb[];

  if (!updated) {
    // The FOR UPDATE lock + version predicate above means this can only
    // happen if a stale reader raced past the version check somehow; treat
    // it as the same conflict rather than a partial/undefined write.
    throw new StockProtectionPolicyConflictError(shopId, variantId, input.expectedVersion, current.version);
  }

  await trx(TRANSITIONS_TABLE).insert({
    shop_id: shopId,
    policy_id: updated.id,
    lasyncro_variant_id: variantId,
    from_version: current.version,
    to_version: nextVersion,
    from_safety_days: current.safety_days,
    to_safety_days: input.safetyDays,
    from_review_cycle_days: current.review_cycle_days,
    to_review_cycle_days: input.reviewCycleDays,
    from_planning_supplier_id: current.planning_supplier_id,
    to_planning_supplier_id: nextPlanningSupplierId,
    source: input.source,
    reason: input.reason,
    actor_type: input.actorType,
    actor_id: input.actorId ?? null,
    recommendation_snapshot: recommendationSnapshot,
    occurred_at: now,
    created_at: now,
  });

  return { current: updated, transitionCreated: true };
}

export interface ResolvedEffectivePolicy extends EffectivePolicy {
  /**
   * Present only when an approved policy's anchored supplier is invalid or
   * inactive — fails visibly rather than silently substituting a different
   * supplier. Reuses the existing 'planning_data_required' vocabulary from
   * demandIntelligence.service.ts.
   */
  planning_status?: 'planning_data_required';
}

/**
 * DB-aware effective-policy resolution: loads the current row (if any) for
 * shop+variant, applies the pure no-policy/approved-policy rule, and then
 * checks the anchored supplier's tenant-scoped usability. Read-only.
 */
export async function resolveEffectivePolicy(
  trx: Knex.Transaction,
  shopId: number,
  variantId: string
): Promise<ResolvedEffectivePolicy> {
  const current = (await trx(CURRENT_TABLE)
    .where({ shop_id: shopId, lasyncro_variant_id: variantId })
    .first()) as CurrentPolicyRowDb | undefined;

  const effective = resolveEffectivePolicyPure(current ?? null);

  if (effective.source === 'merchant_approved' && effective.planning_supplier_id !== null) {
    const supplier = await trx('suppliers')
      .where({ id: effective.planning_supplier_id, shop_id: shopId })
      .first('id', 'active');

    if (!supplier || !supplier.active) {
      // Never silently substitute another supplier — the anchor id is kept
      // exactly as approved; only a visible needs-attention flag is added.
      return { ...effective, planning_status: 'planning_data_required' };
    }
  }

  return effective;
}
