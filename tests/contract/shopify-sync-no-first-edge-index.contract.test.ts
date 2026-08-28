// tests/contract/shopify-sync-no-first-edge-index.contract.test.ts
//
// SHOP-REVIEW-ZERO-PRODUCT-SYNC-06 — T6 (source/static).
//
// Root cause A was an unconditional first-edge/first-node probe
// (`response.data.products.edges[0].node.variants.edges[0].node.id`) that
// crashed a valid zero-product Shopify response. Guard the affected
// initial-sync files against reintroduction of any `.edges[0]` /
// `edges[<numeric index>].node` access.
//
// TARGETED — this contract intentionally covers ONLY the four files below,
// not the repository at large.

import fs from 'fs';
import path from 'path';

const TARGET_FILES = [
  'apps/backend/src/services/inventory/seedShopifyOpeningBalances.ts',
  'apps/backend/src/services/shopify.service.ts',
  'apps/backend/src/services/shopify/shopifyPagination.service.ts',
  'apps/backend/src/services/shopify/shopifyProductSync.service.ts',
] as const;

// `.edges[0]` (any whitespace)
const FIRST_EDGE_INDEX = /\.edges\s*\[\s*0\s*\]/;
// `edges[<numeric index>].node`
const EDGE_INDEX_NODE = /edges\s*\[\s*\d+\s*\]\s*\.\s*node/;

function scan(file: string) {
  const source = fs.readFileSync(path.join(process.cwd(), file), 'utf8');
  const offending = source
    .split('\n')
    .map((text, i) => ({ line: i + 1, text }))
    .filter(
      ({ text }) => FIRST_EDGE_INDEX.test(text) || EDGE_INDEX_NODE.test(text)
    );
  return { file, offending };
}

describe('CONTRACT SHOP-REVIEW-ZERO-PRODUCT-SYNC-06 — no unsafe first-edge indexing in the initial-sync path', () => {
  it.each(TARGET_FILES)('%s contains no `.edges[0]` / `edges[<n>].node` access', (file) => {
    const { offending } = scan(file);
    expect(offending).toEqual([]);
  });
});
