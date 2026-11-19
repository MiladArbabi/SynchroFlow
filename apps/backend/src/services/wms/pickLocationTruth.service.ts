import type { Knex } from 'knex';
import { resolveLocationIdentity } from './locationIdentity.service.js';
import { writeAuditLog } from '../audit/operatorAudit.service.js';
import { fireStowTaskAlert } from './wmsAlerts.service.js';

/**
 * SF-PICK-LOCATION-TRUTH-01 — PICK DESTINATION AND ROOT UNIT IDENTITY
 * --------------------------------------------------------------------
 * Two kinds of Pick stop exist:
 *
 * 1. A real pick bin (type 'bin', zone 'pick', active). The operator walks to
 *    it and scans its label (server-verified), then the product.
 *
 * 2. The warehouse root (WH-{shop}-ROOT). Release may allocate root stock
 *    without Floor Planning or Stow (A18). The root is not a physical place:
 *    it is never scanned, never lit on the map, and never replaced by an
 *    invented bin. The operator scans the product directly.
 *
 * Unit identity (owner decision, Option B as revised by
 * SF-PICK-UX-ADAPTIVE-01-QUANTITY-CUSTODY-001 — root and pick bins alike):
 * - When eligible LSU records exist for the variant at the Pick location, one
 *   scanned LSU verifies the product/location; further units are settled by
 *   the confirmed quantity and recorded as NOT individually verified.
 * - When none exist, product-only picking is allowed.
 * - A scanned identity is never invented; settled records are chosen under
 *   lock and never written as verified lineage.
 * - Picked and settled records leave the eligible set in the same transaction
 *   as the physical inventory write, so they cannot be Stowed or Picked
 *   again; siblings left behind become identity-unverified until a scan
 *   reverifies them. A received unit picked from the root also releases its
 *   Stow obligation.
 *
 * Any other location (zone, aisle, inactive, unknown) fails closed.
 */

export const rootLocationCode = (shopId: number): string => `WH-${shopId}-ROOT`;

export const isRootLocation = (shopId: number, locationCode: string | null | undefined): boolean =>
  locationCode === rootLocationCode(shopId);

export type PickDestinationProblem =
  | 'structural_location'
  | 'not_a_pick_bin'
  | 'inactive_location'
  | 'unknown_location';

export interface PickDestinationLocation {
  type?: string | null;
  zone_type?: string | null;
  active?: boolean | null;
}

/** Pure rule for a NON-root destination: only an active pick bin qualifies. */
export function pickDestinationProblem(
  location: PickDestinationLocation | null | undefined
): PickDestinationProblem | null {
  if (!location) return 'unknown_location';
  if (location.type === 'warehouse') return 'structural_location';
  if (location.type !== 'bin' || location.zone_type !== 'pick') return 'not_a_pick_bin';
  if (location.active === false) return 'inactive_location';
  return null;
}

/** SQL twin of pickDestinationProblem() === null, for a joined `wl` alias. */
export const PICK_DESTINATION_SQL =
  `(wl.type = 'bin' AND wl.zone_type = 'pick' AND wl.active IS TRUE)`;

/**
 * Eligible root LSUs for one variant, as a SQL predicate over alias `iu`
 * (binding: root location code). Two shapes are physically at the root and
 * still eligible for Stow or Pick:
 * - received units of a CLOSED receive job (its stock was credited to the
 *   root at close; units of a receive still in progress are not root stock);
 * - units recorded as stowed at the root code itself.
 */
export const ROOT_ELIGIBLE_UNIT_SQL = `(
  (iu.status = 'received' AND iu.current_location_code IS NULL AND EXISTS (
     SELECT 1 FROM receive_job_lines rjl
       JOIN receive_jobs rj ON rj.receive_job_id = rjl.receive_job_id AND rj.shop_id = rjl.shop_id
      WHERE rjl.receive_job_line_id = iu.receive_job_line_id
        AND rjl.shop_id = iu.shop_id
        AND rj.status = 'closed'))
  OR (iu.status = 'stowed' AND iu.current_location_code = ?)
)`;

export class PickLocationNotPickableError extends Error {
  readonly code = 'PICK_LOCATION_NOT_PICKABLE';
  constructor(
    public readonly locationCode: string,
    public readonly problem: PickDestinationProblem
  ) {
    super(`[PICK_SCAN] PICK_LOCATION_NOT_PICKABLE: ${locationCode} (${problem})`);
    this.name = 'PickLocationNotPickableError';
  }
}

export class PickLocationMismatchError extends Error {
  readonly code = 'PICK_LOCATION_MISMATCH';
  constructor(
    public readonly scannedValue: string,
    public readonly expectedLocationCode: string
  ) {
    super(`[PICK_SCAN] PICK_LOCATION_MISMATCH: scanned ${scannedValue}, expected ${expectedLocationCode}`);
    this.name = 'PickLocationMismatchError';
  }
}

export class PickLocationTargetNotFoundError extends Error {
  readonly code = 'PICK_LOCATION_TARGET_NOT_FOUND';
  constructor() {
    super('[PICK_SCAN] PICK_LOCATION_TARGET_NOT_FOUND');
    this.name = 'PickLocationTargetNotFoundError';
  }
}

export type PickUnitIdentityCode = 'PICK_UNIT_IDENTITY_REQUIRED' | 'PICK_UNIT_IDENTITY_MISMATCH';

/** A root pick did not carry exactly the required eligible LSU identities. Nothing was written. */
export class PickUnitIdentityError extends Error {
  constructor(
    public readonly code: PickUnitIdentityCode,
    public readonly unitsRequired: number
  ) {
    super(`[PICK_SCAN] ${code}`);
    this.name = 'PickUnitIdentityError';
  }
}

/** Short operator copy; the HTTP layer and the UI both use it. */
export function pickDestinationProblemMessage(
  locationCode: string,
  problem: PickDestinationProblem
): string {
  switch (problem) {
    case 'structural_location':
      return `${locationCode} is the warehouse, not a bin. Scan the product.`;
    case 'inactive_location':
      return `${locationCode} is inactive. Reactivate it or stow this stock into an active pick bin.`;
    case 'unknown_location':
      return `${locationCode} is not a known location. Stow this stock into a pick bin first.`;
    default:
      return `${locationCode} is not a pick bin. Stow this stock into a pick bin first.`;
  }
}

export function pickUnitIdentityMessage(error: PickUnitIdentityError): string {
  if (error.code === 'PICK_UNIT_IDENTITY_MISMATCH') {
    return 'That unit label cannot be picked here. Scan another label.';
  }
  return 'Scan the unit label on one item.';
}

async function readDestination(
  trx: Knex | Knex.Transaction,
  shopId: number,
  locationCode: string
): Promise<PickDestinationLocation | undefined> {
  return trx('warehouse_locations')
    .where({ shop_id: shopId, location_code: locationCode })
    .first('type', 'zone_type', 'active');
}

/**
 * Fail closed when a Pick write targets anything other than the warehouse
 * root (product-scan stop) or an active pick bin.
 */
export async function assertPickScanDestination(
  trx: Knex | Knex.Transaction,
  shopId: number,
  locationCode: string
): Promise<void> {
  if (isRootLocation(shopId, locationCode)) return;
  const problem = pickDestinationProblem(await readDestination(trx, shopId, locationCode));
  if (problem) throw new PickLocationNotPickableError(locationCode, problem);
}

/** Eligible units AT a pick bin (binding: the bin code): stowed there. */
export const BIN_ELIGIBLE_UNIT_SQL = `(iu.status = 'stowed' AND iu.current_location_code = ?)`;

/** An open inbound Stow task locked for reconciliation (outstanding = quantity − placed − excepted). */
export interface LockedStowObligation {
  stow_task_id: string;
  receive_job_line_id: string;
  quantity: number;
  quantity_placed: number;
  quantity_excepted: number;
  status: string;
}

interface EligibleUnitRow {
  lasyncro_unit_id: string;
  status: 'received' | 'stowed';
  receive_job_line_id: string | null;
  identity_unverified: boolean;
}

/** A unit record settled by quantity: physically counted, NOT individually verified. */
export interface QuantitySettledUnit {
  lasyncro_unit_id: string;
  origin_status: 'received' | 'stowed';
  receive_job_line_id: string | null;
}

export interface ResolvedPickUnits {
  /** The LSUs the operator actually scanned (verified evidence); never inferred. */
  unitIds: string[];
  /**
   * SF-PICK-UX-ADAPTIVE-01-QUANTITY-CUSTODY-001 — further eligible unit
   * records consumed by the confirmed quantity. Chosen deterministically
   * under the eligible-set lock; recorded as NOT individually verified.
   */
  settledUnits: QuantitySettledUnit[];
  /** Eligible siblings left at the location whose identity is no longer trusted. */
  uncertainUnitIds: string[];
  /** The Pick location the units leave (root code or bin). */
  locationCode: string;
  /** Picked units (scanned or settled) that were still awaiting Stow ('received'), by Receive line. */
  receivedByLine: Map<string, string[]>;
  /** Open inbound Stow tasks for those lines, locked before the units. */
  stowTasks: LockedStowObligation[];
}

/**
 * Pick identity gate for any Pick destination (owner decision B, revised by
 * SF-PICK-UX-ADAPTIVE-01-QUANTITY-CUSTODY-001). Locks, in Stow's order
 * (stow task → unit → inventory_truth):
 *  1. the open inbound Stow tasks of every Receive line whose units could be
 *     consumed here (root only);
 *  2. every eligible unit of the variant at the location.
 *
 * When eligible labelled units exist, at least one scanned LSU is required as
 * verification that the operator is at the right product and location. Every
 * scanned LSU must be eligible here. The remaining min(quantity, eligible) −
 * scanned unit records are settled by quantity and recorded as unverified;
 * the siblings left behind lose identity trust (which physical ones remain is
 * unknown). Product-only picking is allowed only when no eligible labelled
 * unit of the variant is at the location. Throws before any write.
 */
export async function resolvePickUnits(
  trx: Knex.Transaction,
  input: { shopId: number; locationCode: string; lasyncroVariantId: string; quantity: number; unitIds: readonly string[]; operatorId?: number }
): Promise<ResolvedPickUnits> {
  const { shopId, locationCode, lasyncroVariantId, quantity } = input;
  const provided = input.unitIds.map((id) => id.trim()).filter(Boolean);
  const atRoot = isRootLocation(shopId, locationCode);

  // 1. Stow obligations first. Any received root unit of the variant may be
  //    consumed (scanned, settled or reverified), so lock every open inbound
  //    task of those Receive lines before any unit row.
  let stowTasks: LockedStowObligation[] = [];
  const lockedLines = new Set<string>();
  if (atRoot) {
    const lines = [...new Set(
      (await trx('inventory_units')
        .where({ shop_id: shopId, lasyncro_variant_id: lasyncroVariantId })
        .where((q) => {
          q.where({ status: 'received' });
          if (provided.length > 0) q.orWhereIn('lasyncro_unit_id', provided);
        })
        .whereNotNull('receive_job_line_id')
        .select('receive_job_line_id'))
        .map((r: { receive_job_line_id: string }) => r.receive_job_line_id)
    )];
    lines.forEach((l) => lockedLines.add(l));
    if (lines.length > 0) {
      stowTasks = (await trx('stow_tasks')
        .where({ shop_id: shopId, trigger: 'inbound_stock' })
        .whereIn('receive_job_line_id', lines)
        .whereIn('status', ['pending', 'in_progress'])
        .orderBy([{ column: 'created_at' }, { column: 'stow_task_id' }])
        .forUpdate()
        .select('stow_task_id', 'receive_job_line_id', 'quantity', 'quantity_placed', 'quantity_excepted', 'status'))
        .map((t: any) => ({
          ...t,
          quantity: Number(t.quantity),
          quantity_placed: Number(t.quantity_placed),
          quantity_excepted: Number(t.quantity_excepted),
        }));
    }
  }

  // 2. The eligible set, locked. Concurrent Picks of this variant here queue on it.
  const eligibleRows: EligibleUnitRow[] = (
    await trx.raw(
      `SELECT iu.lasyncro_unit_id, iu.status, iu.receive_job_line_id, iu.identity_unverified
         FROM inventory_units iu
        WHERE iu.shop_id = ?
          AND iu.lasyncro_variant_id = ?
          AND ${atRoot ? ROOT_ELIGIBLE_UNIT_SQL : BIN_ELIGIBLE_UNIT_SQL}
        ORDER BY iu.id
        FOR UPDATE OF iu`,
      [shopId, lasyncroVariantId, locationCode]
    )
  ).rows;

  // 3. A scanned LSU an earlier quantity settlement recorded as picked, but
  //    which is physically here, is reverified by exchanging records with an
  //    unverified sibling of the same origin (inventory counts unchanged).
  if (new Set(provided).size === provided.length) {
    const eligibleIds = new Set(eligibleRows.map((r) => r.lasyncro_unit_id));
    for (const id of provided) {
      if (eligibleIds.has(id)) continue;
      const swapped = await reverifySettledUnit(trx, {
        shopId, lasyncroVariantId, locationCode, unitId: id,
        candidates: eligibleRows.filter((r) => r.identity_unverified && !provided.includes(r.lasyncro_unit_id)),
        operatorId: input.operatorId ?? null,
      });
      if (!swapped) continue;
      const i = eligibleRows.findIndex((r) => r.lasyncro_unit_id === swapped.replacedUnitId);
      eligibleRows[i] = swapped.restored;
      eligibleIds.delete(swapped.replacedUnitId);
      eligibleIds.add(id);
    }
  }

  const capacity = Math.min(quantity, eligibleRows.length);
  const required = capacity > 0 ? 1 : 0;
  const eligible = new Map(eligibleRows.map((r) => [r.lasyncro_unit_id, r]));

  if (
    new Set(provided).size !== provided.length ||
    provided.length > quantity ||
    provided.some((id) => !eligible.has(id))
  ) {
    throw new PickUnitIdentityError('PICK_UNIT_IDENTITY_MISMATCH', required);
  }
  if (provided.length < required) {
    throw new PickUnitIdentityError('PICK_UNIT_IDENTITY_REQUIRED', required);
  }

  const providedSet = new Set(provided);
  const others = eligibleRows.filter((r) => !providedSet.has(r.lasyncro_unit_id));
  const settledRows = others.slice(0, capacity - provided.length);
  const remainingRows = others.slice(capacity - provided.length);

  const receivedByLine = new Map<string, string[]>();
  for (const row of [...provided.map((id) => eligible.get(id)!), ...settledRows]) {
    if (row.status !== 'received') continue;
    if (!row.receive_job_line_id || !lockedLines.has(row.receive_job_line_id)) {
      // A unit became eligible after the Stow-task lock (Receive closed in
      // between): its obligation is not locked. Retry instead of guessing.
      throw new Error('[PICK_SCAN] UNIT_SET_CHANGED');
    }
    const line = row.receive_job_line_id;
    receivedByLine.set(line, [...(receivedByLine.get(line) ?? []), row.lasyncro_unit_id]);
  }

  // A Receive that closed after step 1 may have created an open inbound Stow
  // task for a consumed line that is not locked here. Retry, never guess.
  if (receivedByLine.size > 0) {
    const lockedTaskIds = stowTasks.map((t) => t.stow_task_id);
    const unlocked = await trx('stow_tasks')
      .where({ shop_id: shopId, trigger: 'inbound_stock' })
      .whereIn('receive_job_line_id', [...receivedByLine.keys()])
      .whereIn('status', ['pending', 'in_progress'])
      .modify((q) => { if (lockedTaskIds.length > 0) q.whereNotIn('stow_task_id', lockedTaskIds); })
      .first('stow_task_id');
    if (unlocked) throw new Error('[PICK_SCAN] UNIT_SET_CHANGED');
  }

  return {
    unitIds: provided,
    settledUnits: settledRows.map((r) => ({
      lasyncro_unit_id: r.lasyncro_unit_id,
      origin_status: r.status,
      receive_job_line_id: r.receive_job_line_id,
    })),
    uncertainUnitIds: settledRows.length > 0 ? remainingRows.map((r) => r.lasyncro_unit_id) : [],
    locationCode,
    receivedByLine,
    stowTasks,
  };
}

/**
 * SF-PICK-UX-ADAPTIVE-01-QUANTITY-CUSTODY-001 — reverification exchange.
 *
 * `unitId` was consumed by an earlier quantity settlement (status 'picked',
 * active settlement row) but has just been scanned at its settlement origin,
 * so it is physically present. One unverified sibling of the same origin
 * (same status shape; same Receive line for received stock, so Stow
 * obligations are unchanged) must therefore be the unit that actually left.
 * The two records exchange states; the settlement moves to the sibling and
 * the old row is released (never deleted). Every row involved is already
 * locked by the caller or locked here. Returns null when no exchange is
 * possible — the caller then refuses the scan (no duplicate Pick).
 */
async function reverifySettledUnit(
  trx: Knex.Transaction,
  input: {
    shopId: number; lasyncroVariantId: string; locationCode: string; unitId: string;
    candidates: EligibleUnitRow[]; operatorId: number | null;
  }
): Promise<{ replacedUnitId: string; restored: EligibleUnitRow } | null> {
  const { shopId, lasyncroVariantId, locationCode, unitId } = input;
  const unit = await trx('inventory_units')
    .where({ shop_id: shopId, lasyncro_unit_id: unitId, lasyncro_variant_id: lasyncroVariantId, status: 'picked' })
    .whereNull('current_location_code')
    .forUpdate()
    .first('lasyncro_unit_id', 'receive_job_line_id');
  if (!unit) return null;
  const settlement = await trx('pick_scan_unit_settlement')
    .where({ shop_id: shopId, lasyncro_unit_id: unitId, origin_location_code: locationCode })
    .whereNull('released_at')
    .forUpdate()
    .first('scan_id', 'origin_status', 'origin_location_code');
  if (!settlement) return null;
  const sibling = input.candidates.find((r) =>
    r.status === settlement.origin_status &&
    (r.status !== 'received' || r.receive_job_line_id === unit.receive_job_line_id));
  if (!sibling) return null;

  const at = new Date();
  await exchangeSettledUnit(trx, {
    shopId, at, scanId: settlement.scan_id, unitId, siblingId: sibling.lasyncro_unit_id,
    originStatus: settlement.origin_status, originLocationCode: settlement.origin_location_code,
    operatorId: input.operatorId, via: 'pick_scan',
  });
  return {
    replacedUnitId: sibling.lasyncro_unit_id,
    restored: {
      lasyncro_unit_id: unitId,
      status: settlement.origin_status,
      receive_job_line_id: unit.receive_job_line_id,
      identity_unverified: false,
    },
  };
}

async function exchangeSettledUnit(
  trx: Knex.Transaction,
  input: {
    shopId: number; at: Date; scanId: string; unitId: string; siblingId: string;
    originStatus: 'received' | 'stowed'; originLocationCode: string;
    operatorId: number | null; via: 'pick_scan' | 'stow_confirm';
  }
): Promise<void> {
  const { shopId, at, scanId, unitId, siblingId } = input;
  const released = await trx('pick_scan_unit_settlement')
    .where({ shop_id: shopId, scan_id: scanId, lasyncro_unit_id: unitId })
    .whereNull('released_at')
    .update({ released_at: at, released_reason: 'reverified_present', replaced_by_unit_id: siblingId });
  if (released !== 1) throw new Error('[PICK_SCAN] SETTLEMENT_REVERIFY_FAILED');
  await trx('pick_scan_unit_settlement').insert({
    scan_id: scanId,
    shop_id: shopId,
    lasyncro_unit_id: siblingId,
    origin_status: input.originStatus,
    origin_location_code: input.originLocationCode,
    settled_at: at,
  });
  const siblingMoved = await trx('inventory_units')
    .where({ shop_id: shopId, lasyncro_unit_id: siblingId, status: input.originStatus })
    .update({ status: 'picked', current_location_code: null, identity_unverified: false, updated_at: at });
  const unitRestored = await trx('inventory_units')
    .where({ shop_id: shopId, lasyncro_unit_id: unitId, status: 'picked' })
    .update({
      status: input.originStatus,
      current_location_code: input.originStatus === 'stowed' ? input.originLocationCode : null,
      identity_unverified: false,
      updated_at: at,
    });
  if (siblingMoved !== 1 || unitRestored !== 1) throw new Error('[PICK_SCAN] SETTLEMENT_REVERIFY_FAILED');
  if (input.operatorId != null) {
    await writeAuditLog(trx, {
      shopId,
      operatorId: input.operatorId,
      actionType: 'pick_unit_reverified',
      entityType: 'inventory_unit',
      entityId: unitId,
      metadata: {
        via: input.via,
        settlement_scan_id: scanId,
        reverified_present_unit_id: unitId,
        quantity_settled_unit_id: siblingId,
        origin_location_code: input.originLocationCode,
      },
    });
  }
}

/**
 * Inbound Stow counterpart of the Pick reverification exchange: a received
 * LSU scanned for Stow that a root quantity settlement recorded as picked is
 * physically on the floor, so an unverified received sibling of the same
 * Receive line takes its settlement. The caller holds the Stow task lock;
 * the unit rows are locked here. Returns true when an exchange happened.
 */
export async function reverifySettledUnitForStow(
  trx: Knex.Transaction,
  input: { shopId: number; unitId: string; lasyncroVariantId: string; receiveJobLineId: string; operatorId: number | null }
): Promise<boolean> {
  const { shopId, unitId } = input;
  const root = rootLocationCode(shopId);
  const unit = await trx('inventory_units')
    .where({
      shop_id: shopId, lasyncro_unit_id: unitId, lasyncro_variant_id: input.lasyncroVariantId,
      receive_job_line_id: input.receiveJobLineId, status: 'picked',
    })
    .whereNull('current_location_code')
    .forUpdate()
    .first('lasyncro_unit_id');
  if (!unit) return false;
  const settlement = await trx('pick_scan_unit_settlement')
    .where({ shop_id: shopId, lasyncro_unit_id: unitId, origin_location_code: root, origin_status: 'received' })
    .whereNull('released_at')
    .forUpdate()
    .first('scan_id');
  if (!settlement) return false;
  const sibling = await trx('inventory_units')
    .where({
      shop_id: shopId, lasyncro_variant_id: input.lasyncroVariantId,
      receive_job_line_id: input.receiveJobLineId, status: 'received', identity_unverified: true,
    })
    .whereNull('current_location_code')
    .whereNot({ lasyncro_unit_id: unitId })
    .orderBy('id')
    .forUpdate()
    .first('lasyncro_unit_id');
  if (!sibling) return false;
  await exchangeSettledUnit(trx, {
    shopId, at: new Date(), scanId: settlement.scan_id, unitId, siblingId: sibling.lasyncro_unit_id,
    originStatus: 'received', originLocationCode: root, operatorId: input.operatorId, via: 'stow_confirm',
  });
  return true;
}

/**
 * Settles units resolved by resolvePickUnits() in the same transaction as the
 * physical inventory write (every row is already locked):
 *  - scanned LSUs → picked, with verified pick_scan_unit_lineage;
 *  - quantity-settled records → picked, with pick_scan_unit_settlement only
 *    (never lineage: they were not individually verified);
 *  - siblings left at the location → identity_unverified;
 *  - units picked straight from Receive → Stow obligation reconciled.
 */
export async function settlePickedUnits(
  trx: Knex.Transaction,
  input: {
    shopId: number; scanId: string; resolved: ResolvedPickUnits; at: Date;
    operatorId: number; pickBatchId: string;
  }
): Promise<void> {
  const { shopId, scanId, resolved, at } = input;
  const settledIds = resolved.settledUnits.map((u) => u.lasyncro_unit_id);
  const allIds = [...resolved.unitIds, ...settledIds];
  if (allIds.length === 0) return;
  const transitioned = await trx('inventory_units')
    .where({ shop_id: shopId })
    .whereIn('lasyncro_unit_id', allIds)
    .whereIn('status', ['received', 'stowed'])
    .update({ status: 'picked', current_location_code: null, identity_unverified: false, updated_at: at })
    .returning('lasyncro_unit_id');
  if (transitioned.length !== allIds.length) {
    throw new Error('[PICK_SCAN] UNIT_SETTLEMENT_FAILED');
  }
  // A record consumed now that still carries an active settlement came back to
  // stock by another route (e.g. cancelled-pick recovery): that settlement is
  // stale. Release it (never delete) before this consumption is recorded.
  await trx('pick_scan_unit_settlement')
    .where({ shop_id: shopId })
    .whereIn('lasyncro_unit_id', allIds)
    .whereNull('released_at')
    .update({ released_at: at, released_reason: 'returned_to_stock' });
  if (resolved.unitIds.length > 0) {
    await trx('pick_scan_unit_lineage').insert(
      resolved.unitIds.map((id) => ({ scan_id: scanId, shop_id: shopId, lasyncro_unit_id: id }))
    );
  }
  if (settledIds.length > 0) {
    await trx('pick_scan_unit_settlement').insert(
      resolved.settledUnits.map((u) => ({
        scan_id: scanId,
        shop_id: shopId,
        lasyncro_unit_id: u.lasyncro_unit_id,
        origin_status: u.origin_status,
        origin_location_code: resolved.locationCode,
        settled_at: at,
      }))
    );
  }
  if (resolved.uncertainUnitIds.length > 0) {
    const flagged = await trx('inventory_units')
      .where({ shop_id: shopId })
      .whereIn('lasyncro_unit_id', resolved.uncertainUnitIds)
      .whereIn('status', ['received', 'stowed'])
      .update({ identity_unverified: true, updated_at: at });
    if (flagged !== resolved.uncertainUnitIds.length) {
      throw new Error('[PICK_SCAN] UNIT_SETTLEMENT_FAILED');
    }
  }
  await reconcileStowObligations(trx, input);
}

/**
 * SF-PICK-LOCATION-TRUTH-01 P1 — a received unit picked straight from the
 * root no longer needs stowing. Its Receive line's open inbound Stow task
 * (oldest first) gives up exactly that unit of outstanding quantity, so the
 * remaining Stow work stays exactly the units still on the floor: the task
 * can neither stall on a unit that left nor report it missing. A task whose
 * outstanding work reaches zero closes with the existing completion rule
 * (or 'cancelled' when nothing was ever placed or excepted).
 */
async function reconcileStowObligations(
  trx: Knex.Transaction,
  input: { shopId: number; scanId: string; resolved: ResolvedPickUnits; at: Date; operatorId: number; pickBatchId: string }
): Promise<void> {
  const { shopId, resolved, at } = input;
  for (const [line, ids] of resolved.receivedByLine) {
    let pending = [...ids];
    for (const task of resolved.stowTasks.filter((t) => t.receive_job_line_id === line)) {
      if (pending.length === 0) break;
      const accounted = task.quantity_placed + task.quantity_excepted;
      const take = Math.min(pending.length, task.quantity - accounted);
      if (take <= 0) continue;
      const units = pending.slice(0, take);
      pending = pending.slice(take);
      const quantityAfter = task.quantity - take;
      const closed = quantityAfter === accounted;
      const statusAfter = !closed
        ? task.status
        : accounted === 0
          ? 'cancelled'
          : task.quantity_excepted > 0 ? 'finished_with_exceptions' : 'completed';
      const updated = await trx('stow_tasks')
        .where({ shop_id: shopId, stow_task_id: task.stow_task_id, quantity: task.quantity })
        .update({
          quantity: quantityAfter,
          status: statusAfter,
          updated_at: at,
          ...(closed ? { completed_at: at } : {}),
        });
      if (updated !== 1) throw new Error('[PICK_SCAN] STOW_RECONCILE_FAILED');
      if (closed) {
        await fireStowTaskAlert(trx, { shopId, stowTaskId: task.stow_task_id, isActive: false, trigger: 'inbound_stock' });
      }
      await writeAuditLog(trx, {
        shopId,
        operatorId: input.operatorId,
        actionType: 'stow_reconcile',
        entityType: 'stow_task',
        entityId: task.stow_task_id,
        metadata: {
          reason: 'units_picked_from_root',
          pick_batch_id: input.pickBatchId,
          scan_id: input.scanId,
          // Scanned (verified) vs settled by quantity (NOT individually verified).
          lasyncro_unit_ids: units.filter((u) => resolved.unitIds.includes(u)),
          quantity_settled_unit_ids: units.filter((u) => !resolved.unitIds.includes(u)),
          quantity_before: task.quantity,
          quantity_after: quantityAfter,
          status_before: task.status,
          status_after: statusAfter,
        },
      });
      task.quantity = quantityAfter;
      task.status = statusAfter;
    }
  }
}

export interface VerifyPickLocationInput {
  shopId: number;
  pickBatchId: string;
  lasyncroLineItemId: string;
  reservationAllocationId?: string;
  /** Legacy (pre-allocation) batches only; ignored when an allocation exists. */
  expectedLocationCode?: string;
  scannedValue: string;
}

/**
 * Read-only server confirmation of a Pick location scan. The target comes from
 * the persisted allocation, never from the client, and must be a pick bin. The
 * root has no location scan; a verify against it is refused. The scanned label
 * must resolve to exactly the target.
 */
export async function verifyPickLocationScan(
  trx: Knex.Transaction,
  input: VerifyPickLocationInput
): Promise<{ location_code: string }> {
  const { shopId, pickBatchId, lasyncroLineItemId, reservationAllocationId, scannedValue } = input;

  const batch = await trx('pick_batches')
    .where({ shop_id: shopId, pick_batch_id: pickBatchId })
    .first('pick_batch_id');
  if (!batch) throw new PickLocationTargetNotFoundError();

  const allocationBacked = await trx('pick_reservation_allocations')
    .where({ shop_id: shopId, pick_batch_id: pickBatchId, lasyncro_line_item_id: lasyncroLineItemId })
    .first('allocation_id');

  let target: string | undefined;
  if (allocationBacked) {
    if (!reservationAllocationId) throw new PickLocationTargetNotFoundError();
    const allocation = await trx('pick_reservation_allocations')
      .where({
        shop_id: shopId,
        pick_batch_id: pickBatchId,
        lasyncro_line_item_id: lasyncroLineItemId,
        allocation_id: reservationAllocationId,
      })
      .first('location_code');
    target = allocation?.location_code;
  } else {
    const inBatch = await trx('order_line_items as oli')
      .join('pick_batch_orders as pbo', 'pbo.lasyncro_order_id', 'oli.lasyncro_order_id')
      .where({
        'oli.lasyncro_line_item_id': lasyncroLineItemId,
        'pbo.pick_batch_id': pickBatchId,
        'pbo.shop_id': shopId,
      })
      .first('oli.lasyncro_line_item_id');
    target = inBatch ? input.expectedLocationCode : undefined;
  }
  if (!target) throw new PickLocationTargetNotFoundError();

  if (isRootLocation(shopId, target)) {
    throw new PickLocationNotPickableError(target, 'structural_location');
  }
  await assertPickScanDestination(trx, shopId, target);

  const raw = scannedValue.trim();
  const resolved =
    (await resolveLocationIdentity(trx as Knex.Transaction, shopId, raw)) ??
    (/^LOC-/i.test(raw)
      ? await resolveLocationIdentity(trx as Knex.Transaction, shopId, raw.slice(4))
      : null);

  if (!resolved || resolved.location_code !== target) {
    throw new PickLocationMismatchError(raw, target);
  }
  return { location_code: target };
}
