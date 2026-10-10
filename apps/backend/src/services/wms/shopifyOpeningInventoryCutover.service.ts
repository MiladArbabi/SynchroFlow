import { resolveShopifyAdminCredentialForConsumer } from '../shopify/shopifyAdminCredentialConsumer.service.js';
import { createShopifyGraphQLClient } from '../shopify/shopifyClient.service.js';

import type {
  OpeningInventoryBatchExecutionResult,
  OpeningInventoryShopifyInput,
} from './openingInventoryCutover.service.js';

const INVENTORY_ADJUST_MUTATION = `
  mutation inventoryAdjustQuantities(
    $input: InventoryAdjustQuantitiesInput!
    $idempotencyKey: String!
  ) {
    inventoryAdjustQuantities(input: $input)
      @idempotent(key: $idempotencyKey) {
      inventoryAdjustmentGroup {
        id
        reason
        changes {
          name
          delta
          quantityAfterChange
        }
      }
      userErrors {
        field
        message
      }
    }
  }
`;

function validatePersistedInput(
  input: OpeningInventoryShopifyInput
): void {
  if (
    input.reason !== 'correction' ||
    input.name !== 'available'
  ) {
    throw new Error(
      '[OPENING_CUTOVER_SHOPIFY] Invalid persisted inventory adjustment semantics'
    );
  }

  if (
    !Array.isArray(input.changes) ||
    input.changes.length < 1 ||
    input.changes.length > 250
  ) {
    throw new Error(
      '[OPENING_CUTOVER_SHOPIFY] Persisted changes must contain 1..250 entries'
    );
  }

  for (const change of input.changes) {
    if (
      !change.inventoryItemId ||
      !change.locationId ||
      !Number.isFinite(
        Number(change.delta)
      ) ||
      Number(change.delta) === 0 ||
      change.changeFromQuantity !== null
    ) {
      throw new Error(
        '[OPENING_CUTOVER_SHOPIFY] Invalid persisted Shopify change'
      );
    }
  }
}

export async function executeOpeningInventoryCutoverBatch(
  params: {
    shopId: number;
    idempotencyKey: string;
    shopifyInput: OpeningInventoryShopifyInput;
  }
): Promise<OpeningInventoryBatchExecutionResult> {
  const {
    shopId,
    idempotencyKey,
    shopifyInput,
  } = params;

  if (!idempotencyKey.trim()) {
    throw new Error(
      '[OPENING_CUTOVER_SHOPIFY] idempotencyKey is required'
    );
  }

  validatePersistedInput(
    shopifyInput
  );

  const credential = await resolveShopifyAdminCredentialForConsumer({ shopId, now: new Date() });
  if (credential.kind !== 'READY') {
    throw new Error(`[OPENING_CUTOVER_SHOPIFY] SHOPIFY_CREDENTIAL_${credential.kind}`);
  }

  const client =
    createShopifyGraphQLClient({
      accessToken: credential.accessToken,
      platformShopName:
        credential.shopDomain,
      shopId,
    });

  const response: any =
    await client.request(
      INVENTORY_ADJUST_MUTATION,
      {
        variables: {
          idempotencyKey,
          input: shopifyInput,
        },
      }
    );

  const payload =
    response?.data
      ?.inventoryAdjustQuantities;

  const userErrors =
    payload?.userErrors;

  if (
    Array.isArray(userErrors) &&
    userErrors.length > 0
  ) {
    throw new Error(
      `[OPENING_CUTOVER_SHOPIFY] userErrors: ${JSON.stringify(
        userErrors
      )}`
    );
  }

  const adjustmentGroupId =
    payload
      ?.inventoryAdjustmentGroup
      ?.id;

  if (!adjustmentGroupId) {
    throw new Error(
      '[OPENING_CUTOVER_SHOPIFY] Shopify response missing inventoryAdjustmentGroup.id'
    );
  }

  return {
    adjustmentGroupId:
      String(
        adjustmentGroupId
      ),
  };
}
