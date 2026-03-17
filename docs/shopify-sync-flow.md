# Shopify Sync Flow

## Flow
Shopify API → shopify.service → domain_events → projections → snapshots

## Guarantees
- Pagination must fully exhaust pages
- No silent failures (fatal on pagination issues)
- Idempotency enforced at DB level

## Observability
Key logs:
- SHOPIFY_SYNC_STARTED
- SHOPIFY_PRODUCT_SYNC_COMPLETED
- SHOPIFY_PAGINATION_STATE
- SHOPIFY_ORDER_SYNC_TOTAL
- SHOPIFY_SYNC_COMPLETED

## Failure Modes
- Pagination stuck → throws fatal error
- GraphQL error → sync FAILED
- Partial ingestion → caught by verification logs