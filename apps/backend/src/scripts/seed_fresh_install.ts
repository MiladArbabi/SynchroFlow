/**
 * FRESH-INSTALL SEEDER
 * --------------------
 * Reproduces the tenant shape a real Shopify install produces — one warehouse
 * root, zero bins, stock unlocated at WH-{shopId}-ROOT — by driving the actual
 * ingestion code paths rather than hand-writing read models.
 *
 * Why this exists: dev_seed hand-builds 22 locations including 18 bins, while a
 * real install gets one root. That single difference hid SHOP-REV-02 for seven
 * sprints and cost two Shopify review cycles.
 *
 *   syncShopifyProducts  -> products / variants / external_product_identity_map
 *   inventory_movements  -> opening_balance at WH-{shopId}-ROOT (verbatim from
 *                           seedShopifyOpeningBalances)
 *   rebuild projection   -> inventory_truth
 *   syncShopifyOrders    -> domain_events -> projection worker builds the rest
 *
 * Usage: npx tsx apps/backend/src/scripts/seed_fresh_install.cli.ts <shopId>
 *
 * FRESH-INSTALL-04: this module is import-safe — no argv parsing, no
 * process.exit at module scope — so integration tests can call
 * seedFreshInstall(shopId) directly. The CLI lives in seed_fresh_install.cli.ts.
 */
import crypto from 'crypto';
import { withTenant } from '@lasyncro/backend-core/db.js';
import { syncShopifyProducts } from '../services/shopify/shopifyProductSync.service.js';
import { syncShopifyOrders } from '../services/shopify/shopifyOrderSync.service.js';
import { rebuildInventoryProjectionForVariants } from '../services/inventory/rebuildInventoryProjection.js';

const PRODUCTS = [
  { n: 1, title: 'Merino Crew Sweater', sku: 'MCS-001', cost: '18.00', price: '79.00', qty: 40 },
  { n: 2, title: 'Canvas Weekender Bag', sku: 'CWB-002', cost: '31.50', price: '129.00', qty: 25 },
  { n: 3, title: 'Wool Beanie', sku: 'WBE-003', cost: '6.25', price: '29.00', qty: 60 },
];

const buildProductEdges = (shopId: number) => PRODUCTS.map((p) => ({
  node: {
    id: `gid://shopify/Product/9${shopId}00${p.n}`,
    title: p.title,
    status: 'ACTIVE',
    productType: 'Apparel',
    featuredImage: { url: null },
    variants: {
      edges: [
        {
          node: {
            id: `gid://shopify/ProductVariant/8${shopId}00${p.n}`,
            sku: p.sku,
            title: 'Default Title',
            barcode: `50123456789${p.n}`,
            image: { url: null },
            inventoryItem: {
              id: `gid://shopify/InventoryItem/7${shopId}00${p.n}`,
              unitCost: { amount: p.cost },
            },
          },
        },
      ],
    },
  },
}));

const ORDERS = [
  { n: 1, p: 0, qty: 2 },
  { n: 2, p: 1, qty: 1 },
  { n: 3, p: 2, qty: 3 },
  { n: 4, p: 0, qty: 1 },
  { n: 5, p: 2, qty: 2 },
];

function orderEdge(shopId: number, o: { n: number; p: number; qty: number }) {
  const product = PRODUCTS[o.p];
  const lineTotal = (Number(product.price) * o.qty).toFixed(2);
  const created = new Date(Date.now() - o.n * 36e5).toISOString();

  return {
    node: {
      id: `9${shopId}10${o.n}`,
      name: `#${shopId}10${o.n}`,
      customer: { id: `gid://shopify/Customer/6${shopId}00${o.n}` },
      createdAt: created,
      updatedAt: created,
      processedAt: created,
      sourceName: 'web',
      currencyCode: 'USD',
      displayFinancialStatus: 'PAID',
      displayFulfillmentStatus: 'UNFULFILLED',
      totalPriceSet: { shopMoney: { amount: lineTotal, currencyCode: 'USD' } },
      subtotalPriceSet: { shopMoney: { amount: lineTotal } },
      totalTaxSet: { shopMoney: { amount: '0.0' } },
      shippingAddress: {
        zip: '11245',
        city: 'Stockholm',
        name: `Test Customer ${o.n}`,
        phone: null,
        address1: 'Sankt Goransgatan 95',
        address2: null,
        countryCode: 'SE',
        provinceCode: null,
      },
      lineItems: {
        edges: [
          {
            node: {
              id: `gid://shopify/LineItem/9${shopId}10${o.n}001`,
              product: { id: `gid://shopify/Product/9${shopId}00${product.n}` },
              variant: { id: `gid://shopify/ProductVariant/8${shopId}00${product.n}` },
              quantity: o.qty,
              originalTotalSet: { shopMoney: { amount: lineTotal } },
              originalUnitPriceSet: { shopMoney: { amount: product.price } },
              discountedUnitPriceSet: { shopMoney: { amount: product.price } },
            },
          },
        ],
      },
    },
  };
}

export async function seedFreshInstall(shopId: number) {
  if (!Number.isInteger(shopId) || shopId <= 0) {
    throw new Error(`FRESH_INSTALL_SEED_ABORTED: invalid shopId ${shopId}`);
  }

  const rootLocationCode = `WH-${shopId}-ROOT`;

  await withTenant(shopId, async (trx) => {
    const location = await trx('warehouse_locations')
      .where({ shop_id: shopId, location_code: rootLocationCode })
      .first();

    if (!location) {
      throw new Error(
        `FRESH_INSTALL_SEED_ABORTED: ${rootLocationCode} not found. ` +
          'Register or install this tenant first — do not bootstrap it here.'
      );
    }

    await syncShopifyProducts({
      trx,
      shopId,
      integrationId: 0,
      accessToken: 'offline-seed-no-network-call',
      platformShopName: `fresh-install-${shopId}`,
      products: buildProductEdges(shopId),
    });

    const variants = await trx('variants')
      .where({ shop_id: shopId })
      .select('lasyncro_variant_id', 'sku');

    for (const product of PRODUCTS) {
      const variant = variants.find(
        (v: { sku: string | null }) => v.sku === product.sku
      );

      if (!variant) {
        throw new Error(`FRESH_INSTALL_SEED_ABORTED: variant missing for ${product.sku}`);
      }

      await trx('inventory_movements').insert({
        lasyncro_inventory_movement_id: crypto.randomUUID(),
        device_event_id: crypto.randomUUID(),
        shop_id: shopId,
        lasyncro_variant_id: variant.lasyncro_variant_id,
        movement_type: 'opening_balance',
        quantity_delta: product.qty,
        reference_type: 'opening_balance',
        reference_id: crypto.randomUUID(),
        platform: 'shopify',
        location_code: rootLocationCode,
        occurred_at: new Date(),
        triggered_by: 'system',
      });
    }

    await rebuildInventoryProjectionForVariants(
      shopId,
      variants.map((v: { lasyncro_variant_id: string }) => v.lasyncro_variant_id),
      trx,
      new Date()
    );

    await syncShopifyOrders({
      trx,
      shopId,
      orderEdges: ORDERS.map((o) => orderEdge(shopId, o)),
    });
  });

  console.info('[FRESH_INSTALL_SEEDED]', {
    shopId,
    rootLocationCode,
    products: PRODUCTS.length,
    orders: ORDERS.length,
  });

  return { shopId, rootLocationCode, products: PRODUCTS.length, orders: ORDERS.length };
}