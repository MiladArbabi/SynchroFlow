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
export async function syncProducts(
  trx: Knex.Transaction,
  shopId: number,
  edges: any[]
) {
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
    const mappedParents: Array<{ lasyncro_product_id: string }> = await trx('external_product_identity_map as m')
      .join('variants as v', 'v.lasyncro_variant_id', 'm.lasyncro_variant_id')
      .join('products as p', 'p.lasyncro_product_id', 'v.lasyncro_product_id')
      .where({
        'm.shop_id': shopId,
        'm.platform': 'shopify',
        'm.external_product_id': node.id,
        'p.shop_id': shopId,
      })
      .groupBy('p.lasyncro_product_id', 'p.created_at')
      .orderBy([
        { column: 'p.created_at', order: 'asc' },
        { column: 'p.lasyncro_product_id', order: 'asc' },
      ])
      .select('p.lasyncro_product_id');

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
      continue;
    } else {
      productId = crypto.randomUUID();

      // Insert product container
      await trx('products').insert({
        lasyncro_product_id: productId,
        shop_id: shopId,
        title: node.title,
        status: shopifyStatus ?? 'active',
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
          sku: variant.sku || null,
          title: variant.title,
          // Absent provider cost (REST webhooks never carry it) keeps the stored
          // cost; the 0 placeholder applies to first insert only.
          ...(unitCostAmount != null ? { unit_cost: unitCost } : {}),
          status: 'active',
          barcode: variant.barcode || null, // merchant may add EAN after initial sync
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

      // 3. Insert external identity mapping (variant-level)
      await trx('external_product_identity_map')
        .insert({
          id: crypto.randomUUID(),
          shop_id: shopId,
          lasyncro_variant_id: variantId,
          platform: 'shopify',
          external_product_id: node.id,
          external_variant_id: variant.id,
          external_inventory_item_id: variant.inventoryItem?.id || null,
          external_sku: variant.sku || null,
          barcode: variant.barcode || null,
        })
        .onConflict([
          'shop_id',
          'platform',
          'external_product_id',
          'external_variant_id',
        ])
        .merge({
          /**
           * RESYNC UPDATE POLICY
           * --------------------
           * These fields may change in Shopify after initial sync:
           * - barcode: merchant adds/updates barcode on variant
           * - external_sku: merchant updates SKU
           * - external_inventory_item_id: platform internal update
           *
           * lasyncro_variant_id is NOT merged — it is immutable once assigned.
           */
          barcode: variant.barcode || null,
          external_sku: variant.sku || null,
          external_inventory_item_id: variant.inventoryItem?.id || null,
        });
    }
  }

  console.log(`[ShopifyService] Synced ${edges.length} products (variant-atomic).`);
};