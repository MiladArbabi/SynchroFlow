import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(
  fileURLToPath(import.meta.url)
);

dotenv.config({
  path: path.resolve(
    __dirname,
    '../../../../.env'
  ),
});

const shopArg = process.argv.find((arg) =>
  arg.startsWith('--shop-id=')
);

const shopId = Number(
  shopArg?.split('=')[1] ?? ''
);

if (
  !Number.isInteger(shopId) ||
  shopId <= 0
) {
  throw new Error(
    'Usage: --shop-id=<positive integer>'
  );
}

const applyMode =
  process.argv.includes('--apply');

const domainEventIdsArg =
  process.argv.find((arg) =>
    arg.startsWith('--domain-event-ids=')
  );

const confirmationArg =
  process.argv.find((arg) =>
    arg.startsWith('--confirm=')
  );

const requestedDomainEventIds =
  domainEventIdsArg
    ? [
        ...new Set(
          domainEventIdsArg
            .split('=')[1]
            .split(',')
            .map((value) =>
              Number(value.trim())
            )
        ),
      ].sort((a, b) => a - b)
    : [];

if (applyMode) {
  /**
   * APPLY SAFETY GATE
   * -----------------
   * Historical canonical repair is an explicit operator action.
   *
   * Never permit:
   * - broad "repair everything"
   * - implicit candidate selection
   * - accidental --apply invocation
   *
   * Operator must provide the exact audited source domain-event IDs
   * and the issue-specific confirmation token.
   */
  if (
    requestedDomainEventIds.length === 0 ||
    requestedDomainEventIds.some(
      (value) =>
        !Number.isInteger(value) ||
        value <= 0
    )
  ) {
    throw new Error(
      '[SHOPIFY_CANONICAL_REPAIR_APPLY_REQUIRES_DOMAIN_EVENT_IDS]'
    );
  }

  if (
    confirmationArg !==
    '--confirm=SHOPIFY-CANON-REST-02'
  ) {
    throw new Error(
      '[SHOPIFY_CANONICAL_REPAIR_APPLY_CONFIRMATION_REQUIRED]'
    );
  }
}

const { withTenant } = await import(
  '@lasyncro/backend-core/db.js'
);

const {
  planShopifyHistoricalCanonicalRepair,
  applyShopifyHistoricalCanonicalRepair,
} = await import(
  '../services/shopify/historicalCanonicalRepair.service.js'
);

if (applyMode) {
  /**
   * APPLY TRANSACTION
   * -----------------
   * applyShopifyHistoricalCanonicalRepair performs the complete
   * canonical/economic repair inside this tenant transaction.
   *
   * The repair domain event is written inside the same transaction
   * and becomes visible only after commit.
   *
   * Do NOT call processDomainEvent() here.
   * The authoritative DB projection worker consumes committed
   * domain events in strict cursor order.
   */
  const result = await withTenant(
    shopId,
    async (trx) =>
      applyShopifyHistoricalCanonicalRepair(
        trx,
        shopId,
        requestedDomainEventIds
      )
  );

  console.log(
    'SHOPIFY_CANONICAL_REPAIR_MODE=apply'
  );

  console.log(
    '\nSHOPIFY_CANONICAL_REPAIR_APPLY_RESULT'
  );

  console.log(
    JSON.stringify(result, null, 2)
  );

  console.log(
    '\nSHOPIFY_CANONICAL_REPAIR_PROJECTION=queued-via-domain-events'
  );

  process.exit(0);
}

const plan = await withTenant(
  shopId,
  async (trx) =>
    planShopifyHistoricalCanonicalRepair(
      trx,
      shopId
    )
);

console.log(
  'SHOPIFY_CANONICAL_REPAIR_MODE=dry-run'
);

console.log(
  '\nSHOPIFY_CANONICAL_REPAIR_SUMMARY'
);

console.log(
  JSON.stringify(
    plan.summary,
    null,
    2
  )
);

console.log(
  '\nSHOPIFY_CANONICAL_REPAIR_CANDIDATES'
);

console.log(
  JSON.stringify(
    plan.candidates,
    null,
    2
  )
);

process.exit(0);
