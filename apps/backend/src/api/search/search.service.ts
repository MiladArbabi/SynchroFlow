import { Knex } from 'knex';
import {
  rankSearchResults,
  SearchCandidate,
  SearchResult,
} from './searchRanking.js';

const SOURCE_LIMIT = 12;
const RESULT_LIMIT = 6;

function searchTerm(query: string): string {
  return query
    .trim()
    .replace(/^#\s*/, '')
    .replace(/^order\s+/i, '')
    .replace(/^(product|sku|batch)\s+/i, '')
    .trim();
}

function variantLabel(row: {
  product_title: string | null;
  variant_title: string | null;
}): string {
  const productTitle = row.product_title?.trim();
  const variantTitle = row.variant_title?.trim();

  if (productTitle && variantTitle && variantTitle !== 'Default Title') {
    return `${productTitle} - ${variantTitle}`;
  }

  return productTitle || variantTitle || 'Untitled variant';
}

export async function searchOperationalEntities(
  trx: Knex.Transaction,
  shopId: number,
  query: string
): Promise<SearchResult[]> {
  const q = searchTerm(query);
  if (q.length < 2) return [];

  const like = `%${q}%`;
  const prefix = `${q}%`;

  const orders = await trx('external_order_identity_map as eim')
    .join('orders as o', function joinOrders() {
      this.on('o.lasyncro_order_id', 'eim.lasyncro_order_id')
        .andOn('o.shop_id', 'eim.shop_id');
    })
    .leftJoin('order_fulfillment_status as ofs', 'ofs.lasyncro_order_id', 'o.lasyncro_order_id')
    .where('eim.shop_id', shopId)
    .andWhere(function orderMatches() {
      this.whereILike('eim.external_order_id', like);
    })
    .select(
      'eim.lasyncro_order_id',
      'eim.external_order_id',
      'o.payment_state',
      'ofs.status as fulfillment_status',
      'o.total_price',
      'o.currency'
    )
    .orderByRaw(
      `CASE
        WHEN eim.external_order_id = ? THEN 0
        WHEN eim.external_order_id ILIKE ? THEN 1
        ELSE 2
      END`,
      [q, prefix]
    )
    .orderBy('eim.external_order_id', 'asc')
    .limit(SOURCE_LIMIT);

  const variants = await trx('variants as v')
    .join('products as p', function joinProducts() {
      this.on('p.lasyncro_product_id', 'v.lasyncro_product_id')
        .andOn('p.shop_id', 'v.shop_id');
    })
    .where('v.shop_id', shopId)
    .andWhere(function variantMatches() {
      this.whereILike('v.sku', like)
        .orWhereILike('v.title', like)
        .orWhereILike('p.title', like)
        .orWhereILike('v.barcode', like)
        .orWhereILike('v.lasyncro_barcode', like);
    })
    .select(
      'v.lasyncro_variant_id',
      'v.sku',
      'v.title as variant_title',
      'v.barcode',
      'v.lasyncro_barcode',
      'p.title as product_title'
    )
    .orderBy('p.title', 'asc')
    .orderBy('v.title', 'asc')
    .limit(SOURCE_LIMIT);

  const batches = await trx('pick_batches')
    .where('shop_id', shopId)
    .whereNotIn('status', ['pack_complete', 'cancelled'])
    .andWhereRaw('pick_batch_id::text ILIKE ?', [like])
    .select('pick_batch_id', 'status', 'release_trigger')
    .orderByRaw(
      `CASE
        WHEN pick_batch_id::text = ? THEN 0
        WHEN pick_batch_id::text ILIKE ? THEN 1
        ELSE 2
      END`,
      [q, prefix]
    )
    .orderBy('released_at', 'desc')
    .limit(SOURCE_LIMIT);

  const candidates: SearchCandidate[] = [
    ...orders.map((row) => ({
      type: 'order' as const,
      id: row.lasyncro_order_id as string,
      label: row.external_order_id as string,
      secondary: row.payment_state ?? null,
      meta: row.currency && row.total_price ? `${row.currency} ${row.total_price}` : row.fulfillment_status ?? null,
      identifiers: [row.external_order_id],
      text: [row.payment_state, row.fulfillment_status].filter(Boolean),
      match: 'text' as const,
    })),
    ...variants.map((row) => ({
      type: 'variant' as const,
      id: row.lasyncro_variant_id as string,
      label: variantLabel(row),
      secondary: row.sku ?? row.barcode ?? row.lasyncro_barcode ?? null,
      meta: row.barcode ?? row.lasyncro_barcode ?? null,
      identifiers: [row.sku, row.barcode, row.lasyncro_barcode].filter(Boolean),
      text: [row.product_title, row.variant_title].filter(Boolean),
      match: 'text' as const,
    })),
    ...batches.map((row) => ({
      type: 'batch' as const,
      id: row.pick_batch_id as string,
      label: row.pick_batch_id as string,
      secondary: row.status ?? null,
      meta: row.release_trigger ?? null,
      identifiers: [row.pick_batch_id],
      text: [row.status, row.release_trigger].filter(Boolean),
      match: 'text' as const,
    })),
  ];

  return rankSearchResults(query, candidates, RESULT_LIMIT);
}
