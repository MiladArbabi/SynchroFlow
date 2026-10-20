import { Knex } from 'knex';
import { ensureVariantBarcode } from '../wms/productBarcode.service.js';

/**
 * mapShopifyProductType
 * ---------------------
 * Maps Shopify's free-text productType to canonical product_type values.
 *
 * Shopify productType is merchant-defined free text — not an enum.
 * We pattern-match known digital/gift/service types.
 * Everything else defaults to 'physical'.
 *
 * Canonical values:
 * - 'physical'   → requires warehouse picking, shipping, SKU
 * - 'digital'    → no warehouse ops, no SKU requirement
 * - 'gift_card'  → financial instrument, no warehouse ops
 * - 'service'    → subscription/plan, no physical fulfillment
 */
function mapShopifyProductType(productType: string | null | undefined): string {
  if (!productType) return 'physical';
  const t = productType.toLowerCase().trim();
  if (t === 'gift_card' || t === 'gift card' || t === 'giftcard') return 'gift_card';
  if (t === 'digital' || t === 'download' || t === 'e-book' || t === 'ebook') return 'digital';
  if (t === 'service' || t === 'subscription' || t === 'plan' || t === 'membership') return 'service';
  return 'physical';
}

const SOURCE_TIMESTAMP_PATTERN =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,9})?(?:Z|[+-](\d{2}):(\d{2}))$/;

/**
 * parseShopifySourceTimestamp (GH-1262 A2.2)
 * ------------------------------------------
 * Shopify product source timestamp: GraphQL updatedAt / REST updated_at.
 * Absent (undefined / null) → null: timestamp-free input. Anything else must
 * be an ISO-8601 instant with an explicit Z or ±HH:MM offset and a real
 * calendar date, or ingestion fails closed — a malformed timestamp is never
 * treated as absent. The validated string is returned unchanged so PostgreSQL
 * parses it to timestamptz at full supported precision; instants are compared
 * there, never lexically.
 */
function parseShopifySourceTimestamp(value: unknown, externalProductId: string): string | null {
  if (value === undefined || value === null) return null;
  const match = typeof value === 'string' ? SOURCE_TIMESTAMP_PATTERN.exec(value) : null;
  const valid = !!match && (() => {
    const [year, month, day, hour, minute, second] = match.slice(1, 7).map(Number);
    const calendar = new Date(Date.UTC(year, month - 1, day));
    const offsetHour = match[7] === undefined ? 0 : Number(match[7]);
    const offsetMinute = match[8] === undefined ? 0 : Number(match[8]);
    return calendar.getUTCFullYear() === year
      && calendar.getUTCMonth() === month - 1
      && calendar.getUTCDate() === day
      && hour <= 23 && minute <= 59 && second <= 59
      && offsetHour <= 14 && offsetMinute <= 59;
  })();
  if (!valid) {
    throw new Error(`SHOPIFY_PRODUCT_SOURCE_TIMESTAMP_INVALID: product ${externalProductId}`);
  }
  return value as string;
}

/**
 * SHOPIFY PRODUCTS CORE
 * ---------------------
 * Low-level product persistence logic.
 *
 * Separated from orchestration to:
 * - prevent cross-service coupling
 * - avoid circular dependencies
 * - isolate DB logic
 */
/**
 * TENANT-SCOPED TRANSACTION REQUIRED (GH-1085)
 * --------------------------------------------
 * Tightened from `Knex | Knex.Transaction`. Every production caller already
 * supplies a transaction with app.current_tenant set — seed_fresh_install
 * (withTenant), shopify.service (db.transaction + SET LOCAL), and the two
 * product webhooks (WebhookRouter's db.transaction + SET LOCAL) — so this
 * narrows the type to what the call sites already pass.
 *
 * It is a real requirement, not a formality: variants is FORCE ROW LEVEL
 * SECURITY (migration 0027), so an untenanted query returns zero rows instead
 * of erroring, and ensureVariantBarcode's collision retry needs SAVEPOINTs,
 * which only exist inside a transaction.
 */
/**
 * Per-product result of one syncProducts pass (GH-1262 A2.2 B1).
 * applied               catalog written, watermark advanced
 * tombstoned            deletion tombstone won; nothing written
 * stale                 older than the watermark (or unprovable); nothing written
 * reconcile_requested   equal-timestamp conflict queued for authoritative fetch
 * skipped               unknown product with no variants; nothing written
 * claim_lost            reconcile mode only: token gone or lease expired
 * generation_superseded reconcile mode only: a newer conflict arrived
 */
export type SyncProductOutcome =
  | 'applied'
  | 'tombstoned'
  | 'stale'
  | 'reconcile_requested'
  | 'skipped'
  | 'claim_lost'
  | 'generation_superseded';

/**
 * Authoritative reconciliation mode: set ONLY by the reconciliation service
 * for a claimed product. Equal source timestamps are accepted only after this
 * claim's token, generation and live lease are re-validated under the product
 * lock, inside the same transaction as the catalog writes.
 */
export type ReconcileClaimFence = { claimToken: string; generation: number };

/**
 * Pre-fetch freshness baseline of one shop's watermarks (GH-1262 A2.2 C4a).
 * Read before the first provider request of a full GraphQL catalog snapshot;
 * sourceUpdatedAt is the exact UTC microsecond text of the stored timestamptz.
 */
export type CatalogFreshnessBaselineRow = {
  sourceUpdatedAt: string | null;
  reconcileGeneration: number;
  isDeleted: boolean;
};
export type CatalogFreshnessBaseline = {
  shopId: number;
  rows: ReadonlyMap<string, CatalogFreshnessBaselineRow>;
};

export async function syncProducts(
  trx: Knex.Transaction,
  shopId: number,
  edges: any[],
  options: { reconcileClaim?: ReconcileClaimFence; freshnessBaseline?: CatalogFreshnessBaseline } = {}
): Promise<Array<{ externalProductId: string; outcome: SyncProductOutcome }>> {
  const reconcileClaim = options.reconcileClaim;
  if (reconcileClaim && edges.length !== 1) {
    throw new Error('SHOPIFY_RECONCILE_REQUIRES_SINGLE_PRODUCT');
  }
  if (reconcileClaim && options.freshnessBaseline) {
    throw new Error('SHOPIFY_RECONCILE_SNAPSHOT_MODE_CONFLICT');
  }
  // A baseline vouches only for the shop it was read from.
  const freshnessBaseline = options.freshnessBaseline?.shopId === shopId
    ? options.freshnessBaseline
    : undefined;
  const results: Array<{ externalProductId: string; outcome: SyncProductOutcome }> = [];

  // GH-1262 A1 / R14:
  // Multiple products share one transaction. Acquire their advisory locks
  // in a deterministic order to prevent reversed-order sync deadlocks.
  // Sort a copy: never mutate the caller's Shopify payload.
  const orderedEdges = [...edges].sort((left, right) => {
    const leftId = String(left.node.id);
    const rightId = String(right.node.id);

    return leftId < rightId ? -1 : leftId > rightId ? 1 : 0;
  });

  for (const { node } of orderedEdges) {
    const variantEdges = node.variants?.edges || [];
    const sourceUpdatedAt = parseShopifySourceTimestamp(node.updatedAt, node.id);

    /**
     * 0. PER-PRODUCT SERIALIZATION (GH-1262)
     * --------------------------------------
     * The parent lookup below is read-then-write. Two concurrent syncs of the
     * same Shopify product (initial sync racing a products/* webhook, or two
     * webhook deliveries) would both see no mapping and each create a parent.
     * A transaction-scoped advisory lock keyed by shop + Shopify product makes
     * the second caller wait for the first commit; under READ COMMITTED its
     * next statement then sees the first caller's mappings and reuses them.
     */
    await trx.raw('SELECT pg_advisory_xact_lock(hashtext(?), hashtext(?))', [
      'shopify_catalog_product', `${shopId}:${node.id}`,
    ]);

    /**
     * 0a. RECONCILE CLAIM FENCE (GH-1262 A2.2 B1)
     * -------------------------------------------
     * Lock order: product advisory lock (above) → claim row lock (here) →
     * catalog writes → fenced completion by the caller. The webhook path takes
     * the same advisory lock before touching this row, so the order is shared.
     * The live-lease check uses clock_timestamp(), not transaction-start now().
     */
    if (reconcileClaim) {
      const fenceResult = await trx.raw(
        `SELECT reconcile_generation, (lease_expires_at > clock_timestamp()) AS lease_live
           FROM shopify_product_source_watermarks
          WHERE shop_id = ? AND platform = 'shopify' AND external_product_id = ? AND claim_token = ?
          FOR UPDATE`,
        [shopId, node.id, reconcileClaim.claimToken]
      );
      const fence: { reconcile_generation: number; lease_live: boolean } | undefined = fenceResult.rows[0];
      if (!fence || fence.lease_live !== true) {
        results.push({ externalProductId: node.id, outcome: 'claim_lost' });
        continue;
      }
      if (Number(fence.reconcile_generation) !== reconcileClaim.generation) {
        results.push({ externalProductId: node.id, outcome: 'generation_superseded' });
        continue;
      }
    }

    /**
     * 1. CANONICAL PRODUCT PARENT (GH-1262)
     * -------------------------------------
     * products carries no Shopify id. A Shopify product is identified only
     * through external_product_identity_map → variants → products, so the
     * persisted parents are exactly the parents its mapped variants use.
     *
     * Historical ingestion minted a new parent on every sync, so one Shopify
     * product may already be split across several parents. All of them are
     * kept (never reparented, never deleted) and all receive the product-level
     * fields. New variants attach to one deterministic parent: the oldest.
     */
    const mappedParents: Array<{ lasyncro_product_id: string; status: string }> = await trx('external_product_identity_map as m')
      .join('variants as v', 'v.lasyncro_variant_id', 'm.lasyncro_variant_id')
      .join('products as p', 'p.lasyncro_product_id', 'v.lasyncro_product_id')
      .where({
        'm.shop_id': shopId,
        'm.platform': 'shopify',
        'm.external_product_id': node.id,
        'p.shop_id': shopId,
      })
      .groupBy('p.lasyncro_product_id', 'p.created_at', 'p.status')
      .orderBy([
        { column: 'p.created_at', order: 'asc' },
        { column: 'p.lasyncro_product_id', order: 'asc' },
      ])
      .select('p.lasyncro_product_id', 'p.status');

    /**
     * 1a. DELETION TOMBSTONE (GH-1262 A2.2)
     * -------------------------------------
     * products/delete soft-deletes every mapped parent under this same lock.
     * A Shopify deletion is terminal for its external product id, so any later
     * catalog input for it — a delayed products/update or a stale full-sync
     * snapshot — is stale: it must neither reactivate the parents nor upsert
     * or add variants. Identity, mappings and history are left untouched.
     * Resolved after the lock so a concurrent deletion is always observed.
     */
    if (mappedParents.some((p) => p.status === 'deleted')) {
      console.info('[SHOPIFY_PRODUCT_TOMBSTONED_SKIPPED]', { shopId, externalProductId: node.id });
      results.push({ externalProductId: node.id, outcome: 'tombstoned' });
      continue;
    }

    /**
     * 1b. SOURCE FRESHNESS (GH-1262 A2.2)
     * -----------------------------------
     * Shopify delivers products/* webhooks out of order and a full-sync
     * snapshot can be older than a webhook already applied. One watermark per
     * external product (shared by every split parent) holds the newest source
     * timestamp applied. Once it exists, input must be strictly newer: an
     * older or equal timestamp, or no timestamp at all, cannot be proven newer
     * and leaves products, variants, mappings, costs and barcodes untouched.
     * Without a watermark, timestamp-free input keeps legacy behaviour.
     * Read under the per-product lock; compared as timestamptz instants.
     *
     * The same row carries the persisted deletion tombstone (is_deleted),
     * written by products/delete even for a never-ingested product. It blocks
     * every creation, reactivation and variant upsert, whatever the timestamp.
     *
     * EQUAL TIMESTAMPS (B1): two distinct Shopify states can share one source
     * timestamp and arrival order is not source order, so untrusted input
     * (webhook, initial sync) with an EQUAL timestamp is never applied and
     * never dropped: it records a durable reconciliation obligation on this
     * row instead. Only a fenced authoritative snapshot may apply at an equal
     * timestamp; an older one is always rejected. Two snapshots are fenced:
     *  - reconcileClaim: the claimed obligation's token, generation and live
     *    lease still hold;
     *  - freshnessBaseline (C4a): a full GraphQL catalog snapshot whose
     *    watermark row is exactly as it was BEFORE the provider fetch began
     *    (same source timestamp, generation and tombstone). The snapshot was
     *    read after every input that row reflects; any later equal-timestamp
     *    input bumps the generation, which forces the obligation path here.
     *
     * The compared columns are written only under the product lock held here.
     */
    const baselineRow = freshnessBaseline?.rows.get(node.id);
    const watermarkResult = await trx.raw(
      `SELECT is_deleted,
              reconcile_generation,
              (?::timestamptz > source_updated_at) AS is_newer,
              (?::timestamptz = source_updated_at) AS is_equal,
              (source_updated_at IS NOT DISTINCT FROM ?::timestamptz) AS matches_baseline_time
         FROM shopify_product_source_watermarks
        WHERE shop_id = ? AND platform = 'shopify' AND external_product_id = ?`,
      [sourceUpdatedAt, sourceUpdatedAt, baselineRow?.sourceUpdatedAt ?? null, shopId, node.id]
    );
    const watermark: {
      is_deleted: boolean;
      reconcile_generation: number;
      is_newer: boolean | null;
      is_equal: boolean | null;
      matches_baseline_time: boolean;
    } | undefined = watermarkResult.rows[0];

    if (watermark?.is_deleted) {
      console.info('[SHOPIFY_PRODUCT_TOMBSTONED_SKIPPED]', { shopId, externalProductId: node.id });
      results.push({ externalProductId: node.id, outcome: 'tombstoned' });
      continue;
    }

    const baselineUnchanged = !!watermark && !!baselineRow
      && !baselineRow.isDeleted
      && baselineRow.sourceUpdatedAt !== null
      && watermark.matches_baseline_time === true
      && Number(watermark.reconcile_generation) === baselineRow.reconcileGeneration;

    const acceptable = !watermark
      || watermark.is_newer === true
      || (watermark.is_equal === true && (!!reconcileClaim || baselineUnchanged));

    if (!acceptable && watermark!.is_equal === true) {
      // Attempts restart only with a new episode (no obligation pending); a
      // further input while pending supersedes in-flight claims via the
      // generation but never revives a failing or exhausted obligation.
      await trx.raw(
        `UPDATE shopify_product_source_watermarks
            SET reconcile_generation = reconcile_generation + 1,
                reconcile_attempts = CASE WHEN reconcile_requested_at IS NULL THEN 0
                                          ELSE reconcile_attempts END,
                reconcile_requested_at = COALESCE(reconcile_requested_at, clock_timestamp()),
                updated_at = clock_timestamp()
          WHERE shop_id = ? AND platform = 'shopify' AND external_product_id = ?`,
        [shopId, node.id]
      );
      console.info('[SHOPIFY_PRODUCT_RECONCILE_REQUESTED]', {
        shopId,
        externalProductId: node.id,
        sourceUpdatedAt,
      });
      results.push({ externalProductId: node.id, outcome: 'reconcile_requested' });
      continue;
    }

    if (!acceptable) {
      console.info('[SHOPIFY_PRODUCT_STALE_SKIPPED]', {
        shopId,
        externalProductId: node.id,
        sourceUpdatedAt,
      });
      results.push({ externalProductId: node.id, outcome: 'stale' });
      continue;
    }

    // An absent status is unknown, not 'active' — it must never reactivate an
    // archived or draft product.
    const shopifyStatus = typeof node.status === 'string' && node.status
      ? node.status.toLowerCase()
      : null;

    let productId: string;

    if (mappedParents.length > 0) {
      productId = mappedParents[0].lasyncro_product_id;

      // Update mutable fields on resync — title, status and type can change in Shopify
      await trx('products')
        .where({ shop_id: shopId })
        .whereIn('lasyncro_product_id', mappedParents.map((p) => p.lasyncro_product_id))
        .update({
          ...(node.title != null ? { title: node.title } : {}),
          ...(shopifyStatus ? { status: shopifyStatus } : {}),
          // Missing Shopify type is unknown, not physical.
          // Preserve the existing classification on partial updates.
          ...(node.productType != null
            ? {
                product_type: mapShopifyProductType(node.productType),
                shopify_product_type_raw: node.productType,
              }
            : {}),
          updated_at: new Date().toISOString(),
        });
    } else if (variantEdges.length === 0) {
      // Unknown product and nothing to map: a parent written here could never
      // be resolved back to Shopify. Skip rather than invent an identity.
      console.warn('[SHOPIFY_PRODUCT_SKIPPED_NO_VARIANTS]', { shopId, externalProductId: node.id });
      results.push({ externalProductId: node.id, outcome: 'skipped' });
      continue;
    } else {
      // A new product is never created from incomplete lifecycle input: an
      // absent status is unknown, not 'active' (GH-1262 A2.3 O3). Fail closed
      // so the caller's transaction rolls back and the webhook is not acked.
      if (!shopifyStatus) {
        throw new Error(`SHOPIFY_PRODUCT_STATUS_REQUIRED: new product ${node.id}`);
      }
      // Only an EXISTING product may be updated without a title; a first write
      // (products/create or products/update alike) must carry a real one.
      if (typeof node.title !== 'string' || node.title.trim() === '') {
        throw new Error(`SHOPIFY_PRODUCT_TITLE_REQUIRED: new product ${node.id}`);
      }
      productId = crypto.randomUUID();

      // Insert product container
      await trx('products').insert({
        lasyncro_product_id: productId,
        shop_id: shopId,
        title: node.title,
        status: shopifyStatus,
        // product_type sourced from Shopify productType field.
        // Maps to canonical values: physical, digital, gift_card, service.
        // Defaults to 'physical' — most products are physical.
        product_type: mapShopifyProductType(node.productType),
        shopify_product_type_raw: node.productType ?? null,
      });
    }

    // Variants absent from this payload are left untouched: a webhook payload
    // is not proof of catalog completeness, so omission never deactivates.
    for (const { node: variant } of variantEdges) {

      /**
       * CATALOG COST EXTRACTION
       * -----------------------
       * Shopify frequently omits variant cost.
       *
       * Ingestion must never fail because of missing cost.
       * Instead we record the variant with a placeholder
       * cost and allow the economics pipeline to detect
       * missing cost during reconciliation.
       * TODO: Capture the products with missing costs and prompt user
       * to fill in the missing costs!
       */
      const unitCostAmount = variant.inventoryItem?.unitCost?.amount;

      let unitCost = 0;

      if (unitCostAmount == null) {
        console.warn(
          `[SHOPIFY_COST_MISSING] Variant ${variant.id} has no inventory cost`
        );
      } else {
        unitCost = Number(unitCostAmount);
      }

      /**
       * FIELD PRESENCE (GH-1262 A2.3 O1)
       * --------------------------------
       * undefined = the source did not carry the field (a partial REST
       * payload): the persisted value is preserved on resync. null or '' is
       * an explicit clear. GraphQL catalog queries always select sku, barcode
       * and inventoryItem, so their behaviour is unchanged.
       */
      const skuPresent = variant.sku !== undefined;
      const barcodePresent = variant.barcode !== undefined;
      const inventoryItemId: string | null | undefined =
        variant.inventoryItem === undefined ? undefined
        : variant.inventoryItem === null ? null
        : variant.inventoryItem.id === undefined ? undefined
        : variant.inventoryItem.id || null;

      // Look up existing lasyncro_variant_id by Shopify variant ID to ensure
      // resync updates the same row (image_url, sku, barcode etc) rather than
      // inserting a duplicate with a new UUID.
      const existingMapping = await trx('external_product_identity_map')
        .where({ shop_id: shopId, platform: 'shopify', external_variant_id: variant.id })
        .select('lasyncro_variant_id')
        .first();
      const variantId = existingMapping?.lasyncro_variant_id ?? crypto.randomUUID();

      // 2. Insert variant (atomic unit)
      await trx('variants')
        .insert({
          lasyncro_variant_id: variantId,
          lasyncro_product_id: productId,
          shop_id: shopId,
          sku: variant.sku || null,
          title: variant.title,
          unit_cost: unitCost,
          status: 'active',
          // Global identifier (EAN/UPC/GTIN) from Shopify variant.barcode.
          // Drives receive flow branching — scan-to-match vs manual selection.
          barcode: variant.barcode || null,
          // Variant image from Shopify — nullable, falls back to product image in UI
          image_url: variant.image?.url || node.featuredImage?.url || null,
        })
        .onConflict('lasyncro_variant_id')
        .merge({
          // Update mutable variant fields on resync. lasyncro_product_id is
          // deliberately absent — an existing variant is never reparented.
          ...(skuPresent ? { sku: variant.sku || null } : {}),
          title: variant.title,
          // Absent provider cost (REST webhooks never carry it) keeps the stored
          // cost; the 0 placeholder applies to first insert only.
          ...(unitCostAmount != null ? { unit_cost: unitCost } : {}),
          status: 'active',
          // merchant may add EAN after initial sync
          ...(barcodePresent ? { barcode: variant.barcode || null } : {}),
          image_url: variant.image?.url || node.featuredImage?.url || null, // merchant may add image after initial sync
          updated_at: new Date().toISOString(),
        });

      /**
       * 2b. LASYNCRO PRODUCT IDENTITY (GH-1085 / BARCODE-LIFECYCLE-01)
       * --------------------------------------------------------------
       * Shopify paused App Store review (ref 102766, 2.1.1) because "the
       * product barcodes are not generating": on a test store every variant
       * ships with an empty barcode field, so a merchant had nothing to scan
       * and nothing to print. Ingestion is the only place that sees every
       * variant, so identity is established here.
       *
       * ensureVariantBarcode is the single canonical minting implementation —
       * deliberately reused rather than reimplemented. It is idempotent:
       *   new / legacy NULL → mints once
       *   already carrying an LSP- → returns it unchanged, never rotates
       * so a resync heals barcode-less rows without renumbering labels that
       * are already stuck to physical stock.
       *
       * NAMESPACE BOUNDARY: this writes variants.lasyncro_barcode only. The
       * Shopify-owned variants.barcode and external_product_identity_map.barcode
       * columns are left exactly as the platform supplied them — minting into
       * them would fabricate a GTIN we hold no GS1 prefix for, and the next
       * sync would overwrite it anyway.
       *
       * Fail closed: null means the variant we just upserted is not visible in
       * this shop, which can only be a tenant/RLS mismatch. Rolling the whole
       * sync back is correct — a mapped catalog variant with no scannable
       * identity is the exact defect this slice exists to remove.
       */
      const lasyncroBarcode = await ensureVariantBarcode(trx, shopId, variantId);
      if (!lasyncroBarcode) {
        throw new Error(
          `PRODUCT_BARCODE_IDENTITY_FAILED: variant ${variantId} not resolvable in shop ${shopId}`
        );
      }

      /**
       * RESYNC UPDATE POLICY
       * --------------------
       * These fields may change in Shopify after initial sync:
       * - barcode: merchant adds/updates barcode on variant
       * - external_sku: merchant updates SKU
       * - external_inventory_item_id: platform internal update
       *
       * lasyncro_variant_id is NOT merged — it is immutable once assigned.
       * A field absent from the source is preserved (A2.3 O1); when none is
       * present the existing mapping is left exactly as it is.
       */
      const mappingUpdate = {
        ...(barcodePresent ? { barcode: variant.barcode || null } : {}),
        ...(skuPresent ? { external_sku: variant.sku || null } : {}),
        ...(inventoryItemId !== undefined ? { external_inventory_item_id: inventoryItemId } : {}),
      };

      // 3. Insert external identity mapping (variant-level)
      const mappingUpsert = trx('external_product_identity_map')
        .insert({
          id: crypto.randomUUID(),
          shop_id: shopId,
          lasyncro_variant_id: variantId,
          platform: 'shopify',
          external_product_id: node.id,
          external_variant_id: variant.id,
          external_inventory_item_id: inventoryItemId ?? null,
          external_sku: variant.sku || null,
          barcode: variant.barcode || null,
        })
        .onConflict([
          'shop_id',
          'platform',
          'external_product_id',
          'external_variant_id',
        ]);
      await (Object.keys(mappingUpdate).length > 0
        ? mappingUpsert.merge(mappingUpdate)
        : mappingUpsert.ignore());
    }

    // Advance the watermark in the same tenant transaction as the catalog
    // writes it vouches for. Only a real source timestamp is ever recorded.
    if (sourceUpdatedAt) {
      await trx('shopify_product_source_watermarks')
        .insert({
          shop_id: shopId,
          platform: 'shopify',
          external_product_id: node.id,
          source_updated_at: sourceUpdatedAt,
        })
        .onConflict(['shop_id', 'platform', 'external_product_id'])
        .merge({
          source_updated_at: sourceUpdatedAt,
          updated_at: new Date().toISOString(),
        });
    }

    results.push({ externalProductId: node.id, outcome: 'applied' });
  }

  console.log(`[ShopifyService] Synced ${edges.length} products (variant-atomic).`);
  return results;
};