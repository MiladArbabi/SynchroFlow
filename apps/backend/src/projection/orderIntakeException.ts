// apps/backend/src/projection/orderIntakeException.ts
import { Knex } from 'knex';

/**
 * ORDER INTAKE EXCEPTION — the ingestion boundary
 * ----------------------------------------------------------------------------
 * SHOP-REVIEW-ORDER-INTAKE-CLASSIFICATION-10.
 *
 * A Shopify record persisted as an `orders` row that cannot become a
 * warehouse-executable order. This is NOT an operational blocker:
 *   - order_constraints        -> valid WMS order, actionable obligation.
 *   - order_intake_exceptions  -> source/system condition, no safe WMS shape.
 *
 * Persistence: one row per order, keyed by lasyncro_order_id (migration 0164),
 * so projection replay upserts idempotently.
 */

export type OrderIntakeExceptionKind =
  /** Shopify supplied a legitimate line/order shape with no warehouse identity. */
  | 'SOURCE_NON_WMS'
  /**
   * Shopify DID supply a variant identity but laSyncro cannot resolve/project
   * it. In Slice B these paths stay fail-closed (throw + rollback), so no row
   * is written for them yet — the kind exists for structured diagnostics and a
   * later slice.
   */
  | 'INGESTION_INTEGRITY_ERROR';

export type OrderIntakeReasonCode =
  /** Every source line dropped; zero usable WMS lines persisted. */
  | 'NO_USABLE_WMS_LINES'
  /** Some source lines mapped, at least one did not — fail closed (PART 3). */
  | 'PARTIALLY_MAPPED';

/** Per-line drop reasons, for diagnostics only (no Shopify PII). */
export type OrderIntakeLineReason =
  | 'NO_VARIANT_ID'
  | 'VARIANT_IDENTITY_MISSING'
  | 'VARIANT_ROW_MISSING';

export interface UpsertOrderIntakeExceptionInput {
  lasyncroOrderId: string;
  shopId: number;
  kind: OrderIntakeExceptionKind;
  reason: OrderIntakeReasonCode;
  sourceLineCount: number;
  usableLineCount: number;
  detail?: Record<string, unknown>;
}

/**
 * Idempotent upsert of the order-level intake exception. Safe on projection
 * replay: the natural key is lasyncro_order_id, so a re-projection of the same
 * source event merges the recomputed diagnostic snapshot rather than
 * duplicating. Never clears `resolved_at` (resolution is owned elsewhere).
 *
 * Caller must already hold the projection transaction + tenant context.
 */
export async function upsertOrderIntakeException(
  trx: Knex.Transaction,
  input: UpsertOrderIntakeExceptionInput
): Promise<void> {
  const now = new Date();
  await trx('order_intake_exceptions')
    .insert({
      lasyncro_order_id: input.lasyncroOrderId,
      shop_id: input.shopId,
      exception_kind: input.kind,
      reason_code: input.reason,
      source_line_count: input.sourceLineCount,
      usable_line_count: input.usableLineCount,
      detail: JSON.stringify(input.detail ?? {}),
      created_at: now,
      updated_at: now,
    })
    .onConflict('lasyncro_order_id')
    .merge({
      exception_kind: input.kind,
      reason_code: input.reason,
      source_line_count: input.sourceLineCount,
      usable_line_count: input.usableLineCount,
      detail: JSON.stringify(input.detail ?? {}),
      updated_at: now,
    });
}
