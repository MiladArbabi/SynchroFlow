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
}: {
  client: ShopifyGraphqlLike;
  variantsQuery: string;
  shopId: number;
  productId: string;
  firstPage: ConnectionPage;
}): Promise<any[]> {
  const label = `product ${productId} variants`;
  const variantEdges = [...firstPage.edges];
  const seen = new Set<string>();
  let page = firstPage;

  while (page.hasNextPage) {
    const cursor = page.endCursor as string;
    advanceCursor(seen, cursor, label, shopId);

    const response = await client.request(variantsQuery, {
      variables: { id: productId, cursor },
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
      return productEdges;
    }

    advanceCursor(seen, page.endCursor as string, 'products', shopId);
    cursor = page.endCursor;
  }
}
