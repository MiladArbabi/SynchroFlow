/**
 * SHOPIFY CATALOG PAGINATION SERVICE (GH-1262 A2.1)
 * -------------------------------------------------
 * Collects the COMPLETE products connection, and every product's COMPLETE
 * nested variants connection, before any consumer persists anything.
 *
 * Catalog-specific on purpose: shopifyPagination.service.ts is the order
 * paginator (page.orders) and keeps its own contracts.
 *
 * FAIL CLOSED — for every products and variants connection:
 * - edges must be an array;
 * - pageInfo must be present and hasNextPage must be a boolean;
 * - hasNextPage=true requires a nonempty string endCursor;
 * - a repeated cursor (stall or cycle) is an error;
 * - provider errors propagate unchanged.
 * Missing pageInfo is NOT a terminal page. No partial collection is returned.
 */

import { withTenant } from '@lasyncro/backend-core/db.js';
import { GET_PRODUCTS_QUERY } from './shopify.queries.js';
import type { CatalogFreshnessBaseline, CatalogFreshnessBaselineRow } from './shopifyProducts.core.js';

type ShopifyGraphqlLike = {
  request: (query: string, opts?: any) => Promise<{ data?: any }>;
};

type ConnectionPage = {
  edges: any[];
  hasNextPage: boolean;
  endCursor: string | null;
};

const FATAL = '[SHOPIFY_CATALOG_PAGINATION_FATAL]';

function readConnection(connection: any, label: string): ConnectionPage {
  if (!connection || typeof connection !== 'object') {
    throw new Error(`${FATAL} ${label}: connection missing from response`);
  }

  if (!Array.isArray(connection.edges)) {
    throw new Error(`${FATAL} ${label}: edges is not an array`);
  }

  const pageInfo = connection.pageInfo;

  if (!pageInfo || typeof pageInfo !== 'object') {
    throw new Error(`${FATAL} ${label}: pageInfo missing`);
  }

  if (typeof pageInfo.hasNextPage !== 'boolean') {
    throw new Error(`${FATAL} ${label}: pageInfo.hasNextPage is not a boolean`);
  }

  const { hasNextPage, endCursor } = pageInfo;

  if (hasNextPage) {
    if (typeof endCursor !== 'string' || endCursor.length === 0) {
      throw new Error(`${FATAL} ${label}: hasNextPage=true without endCursor`);
    }
  } else if (endCursor !== null && typeof endCursor !== 'string') {
    throw new Error(`${FATAL} ${label}: pageInfo.endCursor is malformed`);
  }

  for (const edge of connection.edges) {
    if (!edge || typeof edge !== 'object' || !edge.node || typeof edge.node !== 'object') {
      throw new Error(`${FATAL} ${label}: edge without node`);
    }
  }

  return { edges: connection.edges, hasNextPage, endCursor: endCursor ?? null };
}

/** Records a continuation cursor; a cursor already seen is a stall or cycle. */
function advanceCursor(seen: Set<string>, cursor: string, label: string, shopId: number) {
  if (seen.has(cursor)) {
    console.error('[SHOPIFY_CATALOG_PAGINATION_STUCK]', { shopId, label, cursor });
    throw new Error(`${FATAL} ${label}: cursor repeated (stalled or cyclic)`);
  }
  seen.add(cursor);
}

async function collectRemainingVariants({
  client,
  variantsQuery,
  shopId,
  productId,
  firstPage,
  signal,
}: {
  client: ShopifyGraphqlLike;
  variantsQuery: string;
  shopId: number;
  productId: string;
  firstPage: ConnectionPage;
  signal?: AbortSignal;
}): Promise<any[]> {
  const label = `product ${productId} variants`;
  const variantEdges = [...firstPage.edges];
  const seen = new Set<string>();
  let page = firstPage;

  while (page.hasNextPage) {
    const cursor = page.endCursor as string;
    advanceCursor(seen, cursor, label, shopId);

    // Never start another provider request once cancelled or past the deadline.
    signal?.throwIfAborted();
    const response = await client.request(variantsQuery, {
      variables: { id: productId, cursor },
      ...(signal ? { signal } : {}),
    });

    const product = response?.data?.product;

    if (!product || product.id !== productId) {
      throw new Error(`${FATAL} ${label}: continuation returned no matching product`);
    }

    page = readConnection(product.variants, label);
    variantEdges.push(...page.edges);
  }

  return variantEdges;
}

/**
 * One product by identity (GH-1262 A2.2 B1), with its COMPLETE variants
 * connection, in the same edge shape collectShopifyCatalogProducts returns.
 * Returns null only when Shopify answers `product: null`; a response without a
 * product field, a mismatched id or any malformed connection fails closed.
 *
 * `signal` (A2.2 shutdown cancellation) reaches EVERY request, the first page
 * and each variant continuation, and is checked before each new request. One
 * signal spans the whole collection, so a caller's deadline never restarts per
 * page. An abort surfaces as a thrown error; the caller classifies it from the
 * signal state, never from the error name.
 */
export async function collectShopifyCatalogProduct({
  client,
  productQuery,
  variantsQuery,
  shopId,
  productId,
  signal,
}: {
  client: ShopifyGraphqlLike;
  productQuery: string;
  variantsQuery: string;
  shopId: number;
  productId: string;
  signal?: AbortSignal;
}): Promise<any | null> {
  signal?.throwIfAborted();
  const response = await client.request(productQuery, {
    variables: { id: productId },
    ...(signal ? { signal } : {}),
  });
  const data = response?.data;

  if (!data || typeof data !== 'object' || !('product' in data)) {
    throw new Error(`${FATAL} product ${productId}: product missing from response`);
  }

  const node = data.product;
  if (node === null) return null;

  if (!node || typeof node !== 'object' || node.id !== productId) {
    throw new Error(`${FATAL} product ${productId}: response product does not match`);
  }

  const variantsPage = readConnection(node.variants, `product ${productId} variants`);
  if (!variantsPage.hasNextPage) return { node };

  const variantEdges = await collectRemainingVariants({
    client,
    variantsQuery,
    shopId,
    productId,
    firstPage: variantsPage,
    signal,
  });

  return {
    node: {
      ...node,
      variants: {
        ...node.variants,
        edges: variantEdges,
        pageInfo: { hasNextPage: false, endCursor: null },
      },
    },
  };
}

/**
 * FRESHNESS BASELINE (GH-1262 A2.2 C4a)
 * -------------------------------------
 * A full catalog sync re-reads products whose watermark already holds the
 * same source timestamp. The shop's watermark rows are read BEFORE the first
 * provider request and registered against the returned edges, so the catalog
 * write can prove a row is unchanged since the snapshot began
 * (shopifyProducts.core.ts). Only the catalog-sync query captures one: other
 * collections (the opening-inventory snapshot) are never written by
 * syncProducts and make no extra read. The read runs in its own short tenant
 * transaction, never during provider I/O and never inside a caller's
 * transaction.
 */
const catalogFreshnessBaselines = new WeakMap<object, CatalogFreshnessBaseline>();

async function readCatalogFreshnessBaseline(shopId: number): Promise<CatalogFreshnessBaseline> {
  const result = await withTenant(shopId, (trx) =>
    trx.raw(
      `SELECT external_product_id,
              to_char(source_updated_at AT TIME ZONE 'UTC',
                      'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS source_updated_at,
              reconcile_generation,
              is_deleted
         FROM shopify_product_source_watermarks
        WHERE shop_id = ? AND platform = 'shopify'`,
      [shopId]
    )
  );
  const rows = new Map<string, CatalogFreshnessBaselineRow>();
  for (const row of result.rows ?? []) {
    rows.set(String(row.external_product_id), {
      sourceUpdatedAt: row.source_updated_at ?? null,
      reconcileGeneration: Number(row.reconcile_generation),
      isDeleted: row.is_deleted === true,
    });
  }
  return { shopId, rows };
}

/** The baseline captured for exactly this collection result, if any. */
export function catalogFreshnessBaselineOf(productEdges: unknown): CatalogFreshnessBaseline | undefined {
  return typeof productEdges === 'object' && productEdges !== null
    ? catalogFreshnessBaselines.get(productEdges)
    : undefined;
}

/**
 * Returns every product edge, each with node.variants.edges holding every
 * variant edge and a terminal pageInfo. Same edge shape as a single complete
 * Shopify page, so existing consumers read it unchanged.
 */
export async function collectShopifyCatalogProducts({
  client,
  productsQuery,
  variantsQuery,
  shopId,
}: {
  client: ShopifyGraphqlLike;
  productsQuery: string;
  variantsQuery: string;
  shopId: number;
}): Promise<any[]> {
  const productEdges: any[] = [];
  const seen = new Set<string>();
  let cursor: string | null = null;
  const freshnessBaseline = productsQuery === GET_PRODUCTS_QUERY
    ? await readCatalogFreshnessBaseline(shopId)
    : undefined;

  while (true) {
    const variables = cursor ? { cursor } : {};
    const response = await client.request(productsQuery, { variables });
    const page = readConnection(response?.data?.products, 'products');

    for (const edge of page.edges) {
      const node = edge.node;
      const variantsPage = readConnection(node.variants, `product ${node.id} variants`);

      if (!variantsPage.hasNextPage) {
        productEdges.push(edge);
        continue;
      }

      if (typeof node.id !== 'string' || node.id.length === 0) {
        throw new Error(`${FATAL} products: variant continuation without product id`);
      }

      const variantEdges = await collectRemainingVariants({
        client,
        variantsQuery,
        shopId,
        productId: node.id,
        firstPage: variantsPage,
      });

      productEdges.push({
        ...edge,
        node: {
          ...node,
          variants: {
            ...node.variants,
            edges: variantEdges,
            pageInfo: { hasNextPage: false, endCursor: null },
          },
        },
      });
    }

    console.info('[SHOPIFY_CATALOG_PAGINATION_STATE]', {
      shopId,
      hasNextPage: page.hasNextPage,
      endCursor: page.endCursor,
      edgesCount: page.edges.length,
    });

    if (!page.hasNextPage) {
      if (freshnessBaseline) catalogFreshnessBaselines.set(productEdges, freshnessBaseline);
      return productEdges;
    }

    advanceCursor(seen, page.endCursor as string, 'products', shopId);
    cursor = page.endCursor;
  }
}
