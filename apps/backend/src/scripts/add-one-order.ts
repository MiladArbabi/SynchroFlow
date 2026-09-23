// apps/backend/src/scripts/add-one-order.ts
//
// PICK-REMOVAL-RUNTIME-01 — add ONE releasable order to a fresh-install tenant
// ---------------------------------------------------------------------------
// Migration 0147 added the pick_removal movement type and pickScan.service.ts
// now writes it, but NO ROW OF THAT TYPE HAS EVER BEEN WRITTEN. The fix was
// validated by simulating the on-hand CASE against existing data. This script
// builds the fixture needed for a real runtime proof: a single order that can
// be released, claimed and picked through the operator UI.
//
// Shop 2's five seeded orders are all inside a pick_complete batch, so the
// pool reports ALL_ELIGIBLE_ORDERS_ALREADY_BATCHED and nothing is releasable.
//
// WHY NOT re-run seed_fresh_install: it is idempotent on orders
// (external_event_id dedup) but NOT on inventory — a second run writes another
// set of physical fixture-stock movements (manual_adjustment, GH-1145-A1) and
// inflates stock by 125, destroying the only tenant whose ledger currently
// reconciles with truth.
//
// This script writes NO inventory movements. syncShopifyOrders emits domain
// events only ("responsible ONLY for transforming Shopify orders → domain
// events"); the projection worker derives the rest, including the single
// ingestion `sale` debit via revenue-units.writer.ts. That debit is correct —
// a new order should reduce on-hand exactly once.
//
// Order shape is deliberately minimal: ONE line, ONE unit, so the resulting
// pick_removal row is unambiguous — one scan, one movement, quantity_delta -1.
// The seeded orders used split allocations, which made earlier ledger
// arithmetic harder to read than necessary.
//
// n=6 continues the seeder's numbering (existing orders are n=1..5), so the
// deterministic ids cannot collide.
//
// USAGE: npx tsx apps/backend/src/scripts/add-one-order.ts --shop 2

import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import path from 'path';

// ENV BOOTSTRAP — same contract as rebuild-from-events.ts and
// backfill-pick-sale-corrections.ts. Static ESM imports are hoisted above the
// module body, so the DB import must be dynamic or the pool is constructed
// with undefined PG* vars ("SASL: client password must be a string").
const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../../../../.env') });

const { withTenant } = await import('@lasyncro/backend-core/db.js');
const { syncShopifyOrders } = await import(
  '../services/shopify/shopifyOrderSync.service.js'
);

/*
 * Mirrors PRODUCTS[0] in seed_fresh_install.ts.
 * NOTE: that array is 0-indexed but each entry carries its own `n`, and
 * orderEdge() selects by ARRAY INDEX (PRODUCTS[o.p]) while building ids from
 * product.n. Do not conflate the two.
 *   index 0 → n=1  MCS-001  Merino Crew Sweater  79.00
 *   index 1 → n=2  CWB-002  Canvas Weekender Bag 129.00
 *   index 2 → n=3  WBE-003  Wool Beanie          29.00
 *
 * MCS-001 chosen: largest remaining stock (37) and its barcode
 * (501234567891) is already proven to resolve at pick scan.
 */
const PRODUCT_N = 1;      // MCS-001
const PRICE = '79.00';
const ORDER_N = 6;
const QTY = 1;

function buildOrderEdge(shopId: number) {
  const lineTotal = (Number(PRICE) * QTY).toFixed(2);
  const created = new Date().toISOString();
  return {
    node: {
      id: `9${shopId}10${ORDER_N}`,
      name: `#${shopId}10${ORDER_N}`,
      customer: { id: `gid://shopify/Customer/6${shopId}00${ORDER_N}` },
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
        name: `Runtime Proof ${ORDER_N}`,
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
              id: `gid://shopify/LineItem/9${shopId}10${ORDER_N}001`,
              product: { id: `gid://shopify/Product/9${shopId}00${PRODUCT_N}` },
              variant: { id: `gid://shopify/ProductVariant/8${shopId}00${PRODUCT_N}` },
              quantity: QTY,
              originalTotalSet: { shopMoney: { amount: lineTotal } },
              originalUnitPriceSet: { shopMoney: { amount: PRICE } },
              discountedUnitPriceSet: { shopMoney: { amount: PRICE } },
            },
          },
        ],
      },
    },
  };
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const i = argv.indexOf('--shop');
  const shopId = i >= 0 ? Number(argv[i + 1]) : NaN;

  if (!Number.isInteger(shopId) || shopId <= 0) {
    console.error('Usage: add-one-order.ts --shop <id>');
    process.exit(1);
  }

  console.info('[ADD_ONE_ORDER] start', { shopId, orderN: ORDER_N, qty: QTY });

  await withTenant(shopId, async (trx: any) => {
    await syncShopifyOrders({
      trx,
      shopId,
      orderEdges: [buildOrderEdge(shopId)],
    });
  });

  console.info('[ADD_ONE_ORDER] domain event emitted — worker will project it');
  process.exit(0);
}

main().catch((err) => {
  console.error('[ADD_ONE_ORDER_FAILED]', err);
  process.exit(1);
});
