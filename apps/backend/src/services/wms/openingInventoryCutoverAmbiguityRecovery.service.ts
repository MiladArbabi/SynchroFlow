// GH-1179 E03A: recover one ambiguous immutable batch through readback.
// No dispatch, resend, final convergence, completion marker or regeneration.
import type { Knex } from 'knex';
import { withTenant } from '@lasyncro/backend-core/db.js';
import { decrypt } from '../../security/encryption.service.js';
import {
  defaultClientFactory,
  OPENING_CUTOVER_EXECUTION_BUSY,
  OPENING_CUTOVER_EXECUTION_STALE_CLAIM,
  OpeningInventoryCutoverStaleClaimError,
  resolveLeaseMs,
  revalidateOpeningInventoryCutoverAuthorityInTransaction,
  withLease,
  type Lease,
  type OpeningInventoryCutoverShopifyClientFactory,
} from './openingInventoryCutoverExecution.service.js';
import {
  collectOpeningInventoryLocationEvidence,
  OPENING_INVENTORY_SNAPSHOT_QUERY,
  servedShopifyApiVersion,
  type OpeningInventoryLocationEvidence,
  type SnapshotLine,
} from './shopifyOpeningInventorySnapshot.service.js';

const GENERATIONS = 'opening_inventory_cutover_generations';
const ENTRIES = 'opening_inventory_cutover_generation_entries';
const BATCHES = 'opening_inventory_cutover_generation_batches';
const EXECUTIONS = 'opening_inventory_cutover_executions';
const BATCH_EXECUTIONS = 'opening_inventory_cutover_batch_executions';
const VERIFICATIONS = 'opening_inventory_cutover_verifications';
const LINES = 'opening_inventory_cutover_verification_lines';
const DRIFT = 'OPENING_CUTOVER_AMBIGUITY_RECOVERY_AUTHORITY_DRIFT';
const MIXED = 'OPENING_CUTOVER_AMBIGUITY_RECOVERY_MIXED';
const INELIGIBLE = 'OPENING_CUTOVER_AMBIGUITY_RECOVERY_INELIGIBLE';
const READ_FAILED = 'OPENING_CUTOVER_AMBIGUITY_RECOVERY_READ_FAILED';

export interface RecoverOpeningInventoryCutoverBatchParams {
  shopId: number;
  generationId: string;
  batchIndex: number;
}
export interface RecoverOpeningInventoryCutoverBatchDeps {
  createShopifyGraphQLClient?: OpeningInventoryCutoverShopifyClientFactory;
  leaseDurationMs?: number;
}
type Verdict = 'applied' | 'not_applied' | 'mixed';
export interface OpeningInventoryCutoverAmbiguityRecoveryResult {
  outcome: Verdict | 'requires_regeneration' | 'read_failed' | 'busy' | 'stale_claim' | 'ineligible';
  code: string | null;
  generationId: string;
  executionId: string | null;
  batchIndex: number;
  verificationId: string | null;
}
interface FrozenEntry {
  shopify_inventory_item_gid: string;
  target_quantity: number | null;
  observed_on_hand_quantity: number | null;
  disposition: string;
  batch_index: number | null;
  batch_position: number | null;
}
interface FrozenGeneration {
  shopify_shop_gid: string;
  shopify_location_gid: string;
  requested_api_version: string;
  served_api_version: string;
  target_fingerprint: string;
  identity_fingerprint: string;
  quantity_name: string;
  status: string;
}
interface Plan {
  lease: Lease;
  generation: FrozenGeneration;
  entries: FrozenEntry[];
  writes: FrozenEntry[];
}
function outcome(params: RecoverOpeningInventoryCutoverBatchParams,
  value: OpeningInventoryCutoverAmbiguityRecoveryResult['outcome'],
  executionId: string | null, verificationId: string | null = null,
  code: string | null = null): OpeningInventoryCutoverAmbiguityRecoveryResult {
  return { outcome: value, code, generationId: params.generationId,
    batchIndex: params.batchIndex, executionId, verificationId };
}
function batchWhere(lease: Lease, batchIndex: number) {
  return { shop_id: lease.shopId, execution_id: lease.executionId,
    generation_id: lease.generationId, batch_index: batchIndex };
}

/** Claim only existing ambiguous work; never create executions or attempts. */
async function claim(params: RecoverOpeningInventoryCutoverBatchParams, leaseMs: number)
  : Promise<Plan | OpeningInventoryCutoverAmbiguityRecoveryResult> {
  return withTenant(params.shopId, async trx => {
    await trx.raw('SELECT pg_advisory_xact_lock(hashtext(?), ?)',
      ['opening_inventory_cutover', params.shopId]);
    const generation = await trx(GENERATIONS).where({ shop_id: params.shopId,
      generation_id: params.generationId }).first();
    const execution = await trx(EXECUTIONS).where({ shop_id: params.shopId,
      generation_id: params.generationId }).forUpdate().first('*',
      trx.raw('(lease_expires_at > now()) AS lease_live'));
    const id = execution ? String(execution.execution_id) : null;
    if (!generation || generation.status !== 'frozen' || !execution || execution.status !== 'executing') {
      return outcome(params, 'ineligible', id, null, INELIGIBLE);
    }
    const batch = await trx(BATCH_EXECUTIONS).where({ shop_id: params.shopId,
      generation_id: params.generationId, execution_id: id, batch_index: params.batchIndex }).first();
    if (!batch || batch.status !== 'ambiguous') {
      return outcome(params, 'ineligible', id, null, INELIGIBLE);
    }
    if (execution.lease_live === true) {
      return outcome(params, 'busy', id, null, OPENING_CUTOVER_EXECUTION_BUSY);
    }
    const entries: FrozenEntry[] = await trx(ENTRIES).where({ shop_id: params.shopId,
      generation_id: params.generationId }).orderBy('ordinal');
    const writes = entries.filter(e => e.disposition === 'write' &&
      Number(e.batch_index) === params.batchIndex).sort((a, b) => Number(a.batch_position) - Number(b.batch_position));
    const frozenBatch = await trx(BATCHES).where({ shop_id: params.shopId,
      generation_id: params.generationId, batch_index: params.batchIndex }).first();
    const quantities = frozenBatch ? JSON.parse(frozenBatch.canonical_variables)?.input : null;
    if (generation.quantity_name !== 'on_hand' || !writes.length || !frozenBatch ||
      Number(frozenBatch.entry_count) !== writes.length ||
      frozenBatch.requested_api_version !== generation.requested_api_version ||
      frozenBatch.served_api_version !== generation.served_api_version ||
      quantities?.name !== 'on_hand' || !Array.isArray(quantities.quantities) ||
      quantities.quantities.length !== writes.length || writes.some((e, i) => {
        const q = quantities.quantities[i];
        return !Number.isSafeInteger(e.target_quantity) || !Number.isSafeInteger(e.observed_on_hand_quantity) ||
          e.target_quantity === e.observed_on_hand_quantity ||
          q?.inventoryItemId !== e.shopify_inventory_item_gid ||
          q?.locationId !== generation.shopify_location_gid ||
          q?.quantity !== e.target_quantity || q?.changeFromQuantity !== e.observed_on_hand_quantity;
      })) {
      throw new Error('[OPENING_CUTOVER_AMBIGUITY_RECOVERY_REQUEST_AUTHORITY] Frozen batch and entries disagree');
    }
    const [owned] = await trx(EXECUTIONS).where({ shop_id: params.shopId,
      execution_id: id, status: 'executing', lease_token: execution.lease_token })
      .whereRaw('lease_expires_at <= now()').update({
        lease_token: trx.raw('gen_random_uuid()'),
        lease_expires_at: trx.raw("now() + (? * interval '1 millisecond')", [leaseMs]),
        lease_heartbeat_at: null, updated_at: trx.fn.now(),
      }).returning('lease_token');
    if (!owned) throw new OpeningInventoryCutoverStaleClaimError();
    const lease: Lease = { shopId: params.shopId, generationId: params.generationId,
      executionId: String(id), leaseToken: String(owned.lease_token) };
    // Prior collectors lost authority. Their append-only lines remain intact;
    // their evidence is never reused to certify this new read.
    await trx(VERIFICATIONS).where({ shop_id: lease.shopId, execution_id: lease.executionId,
      generation_id: lease.generationId, purpose: 'ambiguity_inspection', status: 'collecting' })
      .whereNot('started_by_lease_token', lease.leaseToken).update({ status: 'abandoned',
        verdict: null, read_completed_at: trx.fn.now(), finalized_by_lease_token: lease.leaseToken });
    return { lease, generation, entries, writes };
  });
}

/** Recheck wall-clock expiry after local reads, while the E02 lease lock is held. */
async function assertLive(trx: Knex.Transaction, lease: Lease) {
  const row = await trx(EXECUTIONS).where({ shop_id: lease.shopId,
    generation_id: lease.generationId, execution_id: lease.executionId,
    lease_token: lease.leaseToken, status: 'executing' })
    .whereRaw('lease_expires_at > clock_timestamp()').first('execution_id');
  if (!row) throw new OpeningInventoryCutoverStaleClaimError();
}
async function assertBatch(trx: Knex.Transaction, lease: Lease, batchIndex: number) {
  const batch = await trx(BATCH_EXECUTIONS).where(batchWhere(lease, batchIndex))
    .where({ status: 'ambiguous' }).forUpdate().first('batch_index');
  if (!batch) throw new OpeningInventoryCutoverStaleClaimError();
}
async function requiresRegeneration(trx: Knex.Transaction, lease: Lease, reason: string) {
  await trx(EXECUTIONS).where({ shop_id: lease.shopId, execution_id: lease.executionId })
    .update({ status: 'requires_regeneration', terminal_at: trx.fn.now(),
      terminal_reason: `${DRIFT}:${reason}`, lease_token: null,
      lease_expires_at: null, lease_heartbeat_at: null, updated_at: trx.fn.now() });
}
async function assertVerification(trx: Knex.Transaction, plan: Plan, batchIndex: number,
  verificationId: string) {
  await assertBatch(trx, plan.lease, batchIndex);
  const header = await trx(VERIFICATIONS).where({
    verification_id: verificationId, shop_id: plan.lease.shopId,
    execution_id: plan.lease.executionId, generation_id: plan.lease.generationId,
    purpose: 'ambiguity_inspection', batch_index: batchIndex,
    started_by_lease_token: plan.lease.leaseToken, status: 'collecting',
  }).forUpdate().first('verification_id');
  if (!header) throw new OpeningInventoryCutoverStaleClaimError();
}

type LineVerdict = 'match' | 'old_state' | 'mismatch' | 'inactive' | 'untracked' | 'unknown_item';
interface VerificationLine {
  shopify_inventory_item_gid: string;
  observed_on_hand: number | null;
  level_present: boolean;
  active: boolean | null;
  tracked: boolean | null;
  expected_target: number | null;
  frozen_change_from: number | null;
  line_verdict: LineVerdict;
}
function classify(entry: FrozenEntry | undefined, line: SnapshotLine | undefined): LineVerdict {
  if (!entry) return 'unknown_item';
  if (!line?.inventory_level_present) return 'mismatch';
  if (line.inventory_level_active === false) return 'inactive';
  if (line.tracked === false) return 'untracked';
  if (line.inventory_level_active !== true || line.tracked !== true) return 'mismatch';
  if (entry.target_quantity !== null && line.on_hand_quantity === entry.target_quantity) return 'match';
  if (entry.observed_on_hand_quantity !== null && line.on_hand_quantity === entry.observed_on_hand_quantity) return 'old_state';
  return 'mismatch';
}
function inspect(plan: Plan, evidence: OpeningInventoryLocationEvidence) {
  const frozen = new Map(plan.entries.map(e => [e.shopify_inventory_item_gid, e]));
  const observed = new Map(evidence.lines.map(l => [l.shopify_inventory_item_id, l]));
  const items = new Set([...observed.keys(), ...plan.writes.map(e => e.shopify_inventory_item_gid)]);
  const lines: VerificationLine[] = [...items].sort().map(item => {
    const entry = frozen.get(item);
    const line = observed.get(item);
    return { shopify_inventory_item_gid: item,
      observed_on_hand: line?.on_hand_quantity ?? null,
      level_present: line?.inventory_level_present ?? false,
      active: line?.inventory_level_active ?? null, tracked: line?.tracked ?? null,
      expected_target: entry?.target_quantity ?? null,
      frozen_change_from: entry?.observed_on_hand_quantity ?? null,
      line_verdict: classify(entry, line) };
  });
  const byItem = new Map(lines.map(l => [l.shopify_inventory_item_gid, l]));
  const own = plan.writes.map(e => byItem.get(e.shopify_inventory_item_gid)!);
  const hazard = lines.some(l => l.line_verdict === 'unknown_item' && l.observed_on_hand !== 0);
  const verdict: Verdict = !hazard && own.every(l => l.line_verdict === 'match') ? 'applied' :
    !hazard && own.every(l => l.line_verdict === 'old_state') ? 'not_applied' : 'mixed';
  return { lines, verdict };
}

export async function recoverOpeningInventoryCutoverBatch(
  params: RecoverOpeningInventoryCutoverBatchParams,
  deps: RecoverOpeningInventoryCutoverBatchDeps = {}
): Promise<OpeningInventoryCutoverAmbiguityRecoveryResult> {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(params.generationId) ||
    !Number.isSafeInteger(params.batchIndex) || params.batchIndex <= 0) {
    throw new Error('[OPENING_CUTOVER_AMBIGUITY_RECOVERY] Invalid generation UUID or batch index');
  }
  const claimed = await claim(params, resolveLeaseMs(deps.leaseDurationMs));
  if (!('lease' in claimed)) return claimed;
  const plan = claimed;
  const { lease, generation } = plan;
  let verificationId: string | null = null;
  try {
    // Same authority logic as E02, in one RR snapshot. Drift cannot start I/O.
    const authority = await withTenant(lease.shopId,
      trx => revalidateOpeningInventoryCutoverAuthorityInTransaction(trx, lease.shopId, lease.generationId),
      { isolationLevel: 'repeatable read' });
    if (!authority.ok) {
      await withLease(lease, async trx => {
        await assertBatch(trx, lease, params.batchIndex);
        await assertLive(trx, lease);
        await requiresRegeneration(trx, lease, authority.reason);
      });
      return outcome(params, 'requires_regeneration', lease.executionId, null, `${DRIFT}:${authority.reason}`);
    }
    verificationId = await withLease(lease, async trx => {
      await assertBatch(trx, lease, params.batchIndex);
      await assertLive(trx, lease);
      const [header] = await trx(VERIFICATIONS).insert({ shop_id: lease.shopId,
        execution_id: lease.executionId, generation_id: lease.generationId,
        purpose: 'ambiguity_inspection', batch_index: params.batchIndex,
        started_by_lease_token: lease.leaseToken, status: 'collecting',
        requested_api_version: generation.requested_api_version,
        shop_gid: generation.shopify_shop_gid, location_gid: generation.shopify_location_gid,
      }).returning('verification_id');
      return String(header.verification_id);
    });
    let collected: OpeningInventoryLocationEvidence;
    let pages = 0;
    let served: string | null = null;
    try {
      const factory = deps.createShopifyGraphQLClient ?? (await defaultClientFactory());
      const client = factory({ shopId: lease.shopId, platformShopName: authority.shopDomain,
        accessToken: decrypt(authority.encryptedAccessToken, 'wms.openingInventoryCutover'),
        apiVersion: generation.requested_api_version });
      collected = await collectOpeningInventoryLocationEvidence({
        shopId: lease.shopId, locationGid: generation.shopify_location_gid,
        identities: new Map(), retainUnknownItems: true, requireServedApiVersion: true,
        readLocationPage: async ({ variables }) => {
          const response = await client.request(OPENING_INVENTORY_SNAPSHOT_QUERY, { variables, retries: 0 });
          pages += 1;
          served = servedShopifyApiVersion(response);
          if (!served || served !== generation.served_api_version) {
            throw new Error('[OPENING_CUTOVER_AMBIGUITY_RECOVERY_SERVED_VERSION] Frozen served version mismatch');
          }
          return response;
        },
      });
    } catch {
      await withLease(lease, async trx => {
        await assertVerification(trx, plan, params.batchIndex, verificationId!);
        await assertLive(trx, lease);
        await trx(VERIFICATIONS).where({ verification_id: verificationId, shop_id: lease.shopId })
          .update({ status: 'failed', verdict: null, read_completed_at: trx.fn.now(),
            finalized_by_lease_token: lease.leaseToken, page_count: pages, served_api_version: served });
      });
      return outcome(params, 'read_failed', lease.executionId, verificationId, READ_FAILED);
    }
    const inspection = inspect(plan, collected);
    return await withLease(lease, async trx => {
      await assertVerification(trx, plan, params.batchIndex, verificationId!);
      // Authority and acceptance share this fresh RR snapshot and lease lock.
      const current = await revalidateOpeningInventoryCutoverAuthorityInTransaction(
        trx, lease.shopId, lease.generationId);
      await assertLive(trx, lease);
      for (let offset = 0; offset < inspection.lines.length; offset += 500) {
        await trx(LINES).insert(inspection.lines.slice(offset, offset + 500).map(line => ({
          ...line, verification_id: verificationId, shop_id: lease.shopId,
        })));
      }
      await trx(VERIFICATIONS).where({ verification_id: verificationId, shop_id: lease.shopId,
        status: 'collecting', started_by_lease_token: lease.leaseToken }).update({
        status: current.ok ? 'complete' : 'failed', verdict: current.ok ? inspection.verdict : null,
        finalized_by_lease_token: lease.leaseToken, read_completed_at: collected.readCompletedAt,
        page_count: collected.pageCount, served_api_version: collected.servedApiVersion,
        readiness_passed: current.ok ? true : current.reason.startsWith('PHYSICAL_NOT_READY:') ? false : null,
        target_fingerprint: current.ok ? generation.target_fingerprint : null,
        identity_fingerprint: current.ok ? generation.identity_fingerprint : null,
      });
      if (!current.ok) {
        await requiresRegeneration(trx, lease, current.reason);
        return outcome(params, 'requires_regeneration', lease.executionId, verificationId, `${DRIFT}:${current.reason}`);
      }
      if (inspection.verdict === 'applied') {
        const changed = await trx(BATCH_EXECUTIONS).where(batchWhere(lease, params.batchIndex))
          .where({ status: 'ambiguous' }).update({ status: 'succeeded', succeeded_at: trx.fn.now(),
            updated_at: trx.fn.now() });
        if (changed !== 1) throw new OpeningInventoryCutoverStaleClaimError();
      } else if (inspection.verdict === 'mixed') {
        await trx(EXECUTIONS).where({ shop_id: lease.shopId, execution_id: lease.executionId })
          .update({ status: 'blocked', blocked_at: trx.fn.now(), blocked_reason: MIXED,
            lease_token: null, lease_expires_at: null, lease_heartbeat_at: null, updated_at: trx.fn.now() });
      }
      return outcome(params, inspection.verdict, lease.executionId, verificationId,
        inspection.verdict === 'mixed' ? MIXED : null);
    }, { isolationLevel: 'repeatable read' });
  } catch (error) {
    // RR loses to a concurrent reclaim by serialization failure as well as CAS.
    if (error instanceof OpeningInventoryCutoverStaleClaimError || (error as { code?: string })?.code === '40001') {
      return outcome(params, 'stale_claim', lease.executionId, verificationId, OPENING_CUTOVER_EXECUTION_STALE_CLAIM);
    }
    throw error;
  }
}
