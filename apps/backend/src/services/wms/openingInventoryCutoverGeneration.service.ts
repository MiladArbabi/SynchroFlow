// apps/backend/src/services/wms/openingInventoryCutoverGeneration.service.ts
//
// GH-1179 Slice D — IMMUTABLE OPENING INVENTORY CUTOVER GENERATION
// ----------------------------------------------------------------
// Freezes fresh Shopify on_hand evidence against current Slice-C physical
// truth into immutable absolute-set CAS request evidence.
//
// This service performs NO Shopify mutation. Execution, retry, ambiguity
// recovery, reread and convergence belong to Slice E.

import crypto from 'crypto';
import type { Knex } from 'knex';

import { withTenant } from '@lasyncro/backend-core/db.js';

import {
  getShopOpeningInventoryProgress,
  type ShopOpeningInventoryProgress,
} from './inventoryRecount.service.js';

import {
  assertOpeningInventoryPhysicalReadiness,
  buildOpeningInventoryPhysicalTarget,
  resolveOpeningInventoryParticipatingWarehouse,
} from './openingInventoryPhysicalTarget.service.js';

import {
  buildShopifyItemIdentities,
  collectOpeningInventoryLocationEvidence,
  createOpeningInventoryLocationPageReader,
  identityFingerprint,
  normalizeShopifyGid as normalizeOpeningInventoryShopifyGid,
  selectShopifyIdentityRows,
  type OpeningInventoryLocationPageReader,
  type ShopifyItemIdentity,
} from './shopifyOpeningInventorySnapshot.service.js';

const MAX_SHOPIFY_CHANGES_PER_BATCH = 250;

async function acquireCutoverLock(
  trx: Knex.Transaction,
  shopId: number
): Promise<void> {
  await trx.raw(
    'SELECT pg_advisory_xact_lock(hashtext(?), ?)',
    ['opening_inventory_cutover', shopId]
  );
}

async function requireActiveApprover(
  trx: Knex.Transaction,
  shopId: number,
  actingUserId: number
): Promise<'owner' | 'admin'> {
  const membership = await trx('shop_memberships')
    .where({
      shop_id: shopId,
      user_id: actingUserId,
    })
    .whereNull('revoked_at')
    .select('role')
    .first();

  if (!membership) {
    throw new Error(
      '[OPENING_CUTOVER_FORBIDDEN] Active shop membership required'
    );
  }

  const role = String(
    membership.role
  );

  if (
    role !== 'owner' &&
    role !== 'admin'
  ) {
    throw new Error(
      '[OPENING_CUTOVER_FORBIDDEN] Only owner/admin may approve opening inventory cutover'
    );
  }

  return role;
}

function chunk<T>(
  values: T[],
  size: number
): T[][] {
  const groups: T[][] = [];

  for (
    let index = 0;
    index < values.length;
    index += size
  ) {
    groups.push(
      values.slice(
        index,
        index + size
      )
    );
  }

  return groups;
}

// ─── GH-1179 Slice D immutable generation ───────────────────────────────────

const GENERATIONS =
  'opening_inventory_cutover_generations';

const GENERATION_ENTRIES =
  'opening_inventory_cutover_generation_entries';

const GENERATION_BATCHES =
  'opening_inventory_cutover_generation_batches';

const GENERATION_CANONICALIZATION_VERSION =
  'opening-inventory-generation-v1';

const GENERATION_BATCHING_VERSION =
  'shopify-max-250-v1';

const SUPPORTED_GENERATION_SERVED_API_VERSION =
  '2026-04';

const GENERATION_CAS_MODE =
  'change_from_quantity';

const OPENING_INVENTORY_SET_QUANTITIES_MUTATION = `
# Each quantity carries changeFromQuantity optimistic concurrency evidence.
mutation OpeningInventorySetQuantities(
  $input: InventorySetQuantitiesInput!
  $idempotencyKey: String!
) {
  inventorySetQuantities(input: $input)
    @idempotent(key: $idempotencyKey) {
    inventoryAdjustmentGroup {
      id
    }
    userErrors {
      field
      message
      code
    }
  }
}
`.trim();

export interface CreateOpeningInventoryCutoverGenerationParams {
  shopId: number;
  actingUserId: number;
  acceptPhysicalTruth?: boolean;
}

export interface CreateOpeningInventoryCutoverGenerationDeps {
  readLocationPage?:
    OpeningInventoryLocationPageReader;
}

interface OpeningInventoryGenerationReservation {
  snapshotId: string;
  warehouseId: string;
  locationGid: string;
  shopDomain: string;
  shopGid: string;
  requestedApiVersion: string;
  approvedRole:
    | 'owner'
    | 'admin';
  approvedAt: Date;
  physicalTruthAcceptedAt:
    | Date
    | null;
  identityFingerprint: string;
  identities:
    Map<string, ShopifyItemIdentity>;
}

interface OpeningInventoryGenerationEntryDraft {
  lasyncroVariantId:
    | string
    | null;

  shopifyInventoryItemGid:
    string;

  shopifyVariantGid:
    | string
    | null;

  targetQuantity:
    | number
    | null;

  observedOnHandQuantity:
    | number
    | null;

  inventoryLevelPresent:
    boolean;

  inventoryLevelActive:
    | boolean
    | null;

  tracked:
    | boolean
    | null;

  disposition:
    | 'write'
    | 'no_op'
    | 'provider_only_zero';

  batchIndex:
    | number
    | null;

  batchPosition:
    | number
    | null;
}

function generationSha256(
  value: string
): string {
  return crypto
    .createHash('sha256')
    .update(value)
    .digest('hex');
}

function canonicalizeGenerationValue(
  value: unknown
): unknown {
  if (Array.isArray(value)) {
    return value.map(
      canonicalizeGenerationValue
    );
  }

  if (
    value !== null &&
    typeof value === 'object'
  ) {
    return Object.fromEntries(
      Object.entries(
        value as Record<
          string,
          unknown
        >
      )
        .sort(
          ([left], [right]) =>
            left < right
              ? -1
              : left > right
                ? 1
                : 0
        )
        .map(
          ([key, nested]) => [
            key,
            canonicalizeGenerationValue(
              nested
            ),
          ]
        )
    );
  }

  return value;
}

function canonicalGenerationJson(
  value: unknown
): string {
  return JSON.stringify(
    canonicalizeGenerationValue(
      value
    )
  );
}

function generationFingerprint(
  value: unknown
): string {
  return generationSha256(
    canonicalGenerationJson(
      value
    )
  );
}

async function readFrozenGeneration(
  trx: Knex.Transaction,
  shopId: number
): Promise<any | undefined> {
  return trx(GENERATIONS)
    .where({
      shop_id: shopId,
      status: 'frozen',
    })
    .orderBy(
      'generation_sequence',
      'desc'
    )
    .first();
}

function assertGenerationProgress(
  progress:
    ShopOpeningInventoryProgress,
  acceptPhysicalTruth:
    boolean
): void {
  if (
    progress.state !==
      'ready_for_cutover' &&
    progress.state !==
      'review_required'
  ) {
    throw new Error(
      `[OPENING_CUTOVER_NOT_READY] Opening reconciliation state is ${progress.state}`
    );
  }

  if (
    progress.state ===
      'review_required' &&
    acceptPhysicalTruth !== true
  ) {
    throw new Error(
      '[OPENING_CUTOVER_ACCEPTANCE_REQUIRED] Merchant must explicitly accept LaSyncro physical count as truth'
    );
  }
}

// Stable Shopify merchant identity. Exact canonical values only: no trimming,
// so a padded or otherwise malformed GID can never be normalized into validity.
function validShopGid(
  value: unknown
): string | null {
  return typeof value === 'string' &&
    /^gid:\/\/shopify\/Shop\/[0-9]+$/.test(
      value
    )
    ? value
    : null;
}

async function readGenerationInstallation(
  trx: Knex.Transaction,
  shopId: number
): Promise<{
  shopDomain: string;
  shopGid: string;
}> {
  const installation =
    await trx(
      'shopify_app_installations'
    )
      .where({
        shop_id: shopId,
      })
      .whereNull(
        'uninstalled_at'
      )
      .select(
        'shop_domain',
        'shop_gid',
        'access_token'
      )
      .first();

  if (
    !installation?.shop_domain ||
    !installation?.access_token
  ) {
    throw new Error(
      `[OPENING_CUTOVER_PREFLIGHT] Active Shopify installation missing for shop ${shopId}`
    );
  }

  const shopGid =
    validShopGid(
      installation.shop_gid
    );

  if (!shopGid) {
    throw new Error(
      `[OPENING_CUTOVER_PREFLIGHT] Active Shopify installation has no valid stable Shop GID for shop ${shopId}`
    );
  }

  return {
    shopDomain:
      String(
        installation.shop_domain
      ),

    shopGid,
  };
}

async function assertGenerationWarehouseMapping(
  trx: Knex.Transaction,
  shopId: number,
  warehouseId: string,
  expectedLocationGid: string
): Promise<void> {
  const warehouse =
    await trx('warehouses')
      .where({
        shop_id: shopId,
        warehouse_id:
          warehouseId,
      })
      .select(
        'external_location_id'
      )
      .first();

  const mappedLocation =
    normalizeOpeningInventoryShopifyGid(
      'Location',
      warehouse?.external_location_id
    );

  if (
    !mappedLocation ||
    mappedLocation !==
      expectedLocationGid
  ) {
    throw new Error(
      '[OPENING_CUTOVER_LOCATION] Participating warehouse Shopify Location mapping no longer matches the opening snapshot'
    );
  }
}

async function reserveOpeningInventoryCutoverGeneration(
  params:
    CreateOpeningInventoryCutoverGenerationParams
): Promise<
  | {
      kind: 'replay';
      generation: any;
    }
  | {
      kind: 'reserved';
      reservation:
        OpeningInventoryGenerationReservation;
    }
> {
  const {
    shopId,
    actingUserId,
    acceptPhysicalTruth = false,
  } = params;

  return withTenant(
    shopId,
    async (trx) => {
      await acquireCutoverLock(
        trx,
        shopId
      );

      const approvedRole =
        await requireActiveApprover(
          trx,
          shopId,
          actingUserId
        );

      const existing =
        await readFrozenGeneration(
          trx,
          shopId
        );

      if (existing) {
        return {
          kind:
            'replay' as const,
          generation:
            existing,
        };
      }

      const progress =
        await getShopOpeningInventoryProgress(
          trx,
          shopId
        );

      assertGenerationProgress(
        progress,
        acceptPhysicalTruth ===
          true
      );

      const scope =
        await resolveOpeningInventoryParticipatingWarehouse(
          trx,
          shopId
        );

      await assertOpeningInventoryPhysicalReadiness(
        trx,
        shopId,
        scope.warehouseId
      );

      const locationGid =
        normalizeOpeningInventoryShopifyGid(
          'Location',
          scope.shopifyLocationId
        );

      if (!locationGid) {
        throw new Error(
          '[OPENING_CUTOVER_LOCATION] Opening snapshot contains an invalid Shopify Location identity'
        );
      }

      await assertGenerationWarehouseMapping(
        trx,
        shopId,
        scope.warehouseId,
        locationGid
      );

      const installation =
        await readGenerationInstallation(
          trx,
          shopId
        );

      const requestedApiVersion =
        String(
          process.env
            .SHOPIFY_API_VERSION ??
            ''
        ).trim();

      if (
        !requestedApiVersion
      ) {
        throw new Error(
          '[OPENING_CUTOVER_SHOPIFY] SHOPIFY_API_VERSION is not configured'
        );
      }

      const identityRows =
        await selectShopifyIdentityRows(
          trx,
          shopId
        );

      const identities =
        buildShopifyItemIdentities(
          identityRows
        );

      const approvedAt =
        new Date();

      return {
        kind:
          'reserved' as const,

        reservation: {
          snapshotId:
            scope.snapshotId,

          warehouseId:
            scope.warehouseId,

          locationGid,

          shopDomain:
            installation.shopDomain,

          shopGid:
            installation.shopGid,

          requestedApiVersion,

          approvedRole,

          approvedAt,

          physicalTruthAcceptedAt:
            acceptPhysicalTruth ===
            true
              ? approvedAt
              : null,

          identityFingerprint:
            identityFingerprint(
              identityRows
            ),

          identities,
        },
      };
    }
  );
}

function validProductVariantGid(
  value: unknown
): string | null {
  const raw =
    String(value ?? '')
      .trim();

  return /^gid:\/\/shopify\/ProductVariant\/\d+$/.test(
    raw
  )
    ? raw
    : null;
}

function buildItemByVariant(
  identities:
    Map<string, ShopifyItemIdentity>
): Map<
  string,
  {
    itemGid: string;
    identity:
      ShopifyItemIdentity;
  }
> {
  const result =
    new Map<
      string,
      {
        itemGid: string;
        identity:
          ShopifyItemIdentity;
      }
    >();

  for (
    const [itemGid, identity]
    of identities
  ) {
    const existing =
      result.get(
        identity.lasyncroVariantId
      );

    if (
      existing &&
      existing.itemGid !==
        itemGid
    ) {
      throw new Error(
        `[OPENING_CUTOVER_IDENTITY] Variant ${identity.lasyncroVariantId} has multiple Shopify inventory item identities`
      );
    }

    result.set(
      identity.lasyncroVariantId,
      {
        itemGid,
        identity,
      }
    );
  }

  return result;
}

function requestHashForGenerationBatch(
  params: {
    operationName: string;
    graphqlDocument: string;
    requestedApiVersion: string;
    servedApiVersion: string;
    casMode: string;
    canonicalVariables: string;
  }
): string {
  return generationFingerprint({
    operationName:
      params.operationName,

    graphqlDocument:
      params.graphqlDocument,

    requestedApiVersion:
      params.requestedApiVersion,

    servedApiVersion:
      params.servedApiVersion,

    casMode:
      params.casMode,

    canonicalVariables:
      params.canonicalVariables,
  });
}

export async function createOpeningInventoryCutoverGeneration(
  params:
    CreateOpeningInventoryCutoverGenerationParams,

  deps:
    CreateOpeningInventoryCutoverGenerationDeps =
      {}
): Promise<any> {
  const {
    shopId,
    actingUserId,
    acceptPhysicalTruth = false,
  } = params;

  const reserved =
    await reserveOpeningInventoryCutoverGeneration(
      params
    );

  if (
    reserved.kind ===
    'replay'
  ) {
    return reserved.generation;
  }

  const {
    reservation,
  } = reserved;

  const readLocationPage =
    deps.readLocationPage ??
    createOpeningInventoryLocationPageReader();

  const collected =
    await collectOpeningInventoryLocationEvidence({
      shopId,

      locationGid:
        reservation.locationGid,

      identities:
        reservation.identities,

      readLocationPage,

      requireServedApiVersion:
        true,
    });

  if (
    collected.servedApiVersion !==
    SUPPORTED_GENERATION_SERVED_API_VERSION
  ) {
    throw new Error(
      `[OPENING_CUTOVER_SHOPIFY] Unsupported served Shopify Admin API version ${String(
        collected.servedApiVersion ??
          'missing'
      )}`
    );
  }

  return withTenant(
    shopId,
    async (trx) => {
      await acquireCutoverLock(
        trx,
        shopId
      );

      const approvedRole =
        await requireActiveApprover(
          trx,
          shopId,
          actingUserId
        );

      const existing =
        await readFrozenGeneration(
          trx,
          shopId
        );

      if (existing) {
        return existing;
      }

      if (
        approvedRole !==
        reservation.approvedRole
      ) {
        throw new Error(
          '[OPENING_CUTOVER_FORBIDDEN] Approver role changed while Shopify inventory was being read'
        );
      }

      const progress =
        await getShopOpeningInventoryProgress(
          trx,
          shopId
        );

      assertGenerationProgress(
        progress,
        acceptPhysicalTruth ===
          true
      );

      const scope =
        await resolveOpeningInventoryParticipatingWarehouse(
          trx,
          shopId
        );

      const locationGid =
        normalizeOpeningInventoryShopifyGid(
          'Location',
          scope.shopifyLocationId
        );

      if (
        scope.snapshotId !==
          reservation.snapshotId ||
        scope.warehouseId !==
          reservation.warehouseId ||
        locationGid !==
          reservation.locationGid
      ) {
        throw new Error(
          '[OPENING_CUTOVER_PREFLIGHT] Opening inventory scope changed while Shopify inventory was being read'
        );
      }

      await assertGenerationWarehouseMapping(
        trx,
        shopId,
        scope.warehouseId,
        reservation.locationGid
      );

      const installation =
        await readGenerationInstallation(
          trx,
          shopId
        );

      // Domain equality alone cannot prove the same merchant: the stable
      // Shop GID must also be unchanged since T1.
      if (
        installation.shopDomain !==
          reservation.shopDomain ||
        installation.shopGid !==
          reservation.shopGid
      ) {
        throw new Error(
          '[OPENING_CUTOVER_PREFLIGHT] Shopify installation identity changed while inventory was being read'
        );
      }

      const requestedApiVersion =
        String(
          process.env
            .SHOPIFY_API_VERSION ??
            ''
        ).trim();

      if (
        requestedApiVersion !==
        reservation.requestedApiVersion
      ) {
        throw new Error(
          '[OPENING_CUTOVER_SHOPIFY] Requested Shopify Admin API version changed while inventory was being read'
        );
      }

      const identityRows =
        await selectShopifyIdentityRows(
          trx,
          shopId,
          {
            lockRows: true,
          }
        );

      const currentIdentityFingerprint =
        identityFingerprint(
          identityRows
        );

      if (
        currentIdentityFingerprint !==
        reservation.identityFingerprint
      ) {
        throw new Error(
          '[OPENING_CUTOVER_IDENTITY] Shopify identity mappings changed while inventory was being read'
        );
      }

      const currentIdentities =
        buildShopifyItemIdentities(
          identityRows
        );

      await assertOpeningInventoryPhysicalReadiness(
        trx,
        shopId,
        scope.warehouseId
      );

      const target =
        await buildOpeningInventoryPhysicalTarget(
          trx,
          shopId,
          scope.warehouseId
        );

      for (
        const row of target
      ) {
        if (
          !Number.isSafeInteger(
            row.targetQuantity
          ) ||
          row.targetQuantity < 0
        ) {
          throw new Error(
            `[OPENING_CUTOVER_PREFLIGHT] Invalid physical target for variant ${row.lasyncroVariantId}`
          );
        }
      }

      const itemByVariant =
        buildItemByVariant(
          currentIdentities
        );

      const providerByItem =
        new Map(
          collected.lines.map(
            (line) => [
              line.shopify_inventory_item_id,
              line,
            ]
          )
        );

      const targetVariantIds =
        new Set(
          target.map(
            (row) =>
              row.lasyncroVariantId
          )
        );

      const targetItemIds =
        new Set<string>();

      const entries:
        OpeningInventoryGenerationEntryDraft[] =
          [];

      for (
        const targetRow of target
      ) {
        const mapped =
          itemByVariant.get(
            targetRow.lasyncroVariantId
          );

        if (
          !mapped ||
          !mapped.identity.relevant
        ) {
          throw new Error(
            `[OPENING_CUTOVER_IDENTITY] Missing active Shopify inventory item identity for target variant ${targetRow.lasyncroVariantId}`
          );
        }

        const line =
          providerByItem.get(
            mapped.itemGid
          );

        if (
          !line ||
          line.inventory_level_present !==
            true
        ) {
          throw new Error(
            `[OPENING_CUTOVER_SHOPIFY] Target inventory item ${mapped.itemGid} is not present at the mapped Shopify Location`
          );
        }

        // Provider-supplied ProductVariant evidence must agree with the
        // authoritative mapping before the generation is frozen. A null
        // provider variant is absence, not a conflicting identity.
        if (
          line.shopify_variant_id !==
            null &&
          String(
            line.shopify_variant_id
          ).trim() !==
            String(
              mapped.identity
                .externalVariantId ??
                ''
            ).trim()
        ) {
          throw new Error(
            `[OPENING_CUTOVER_IDENTITY] Shopify inventory item ${mapped.itemGid} reports a ProductVariant that differs from the mapped identity for target variant ${targetRow.lasyncroVariantId}`
          );
        }

        if (
          line.inventory_level_active !==
            true
        ) {
          throw new Error(
            `[OPENING_CUTOVER_SHOPIFY] Target inventory item ${mapped.itemGid} has an inactive Shopify inventory level`
          );
        }

        if (
          line.tracked !== true
        ) {
          throw new Error(
            `[OPENING_CUTOVER_SHOPIFY] Target inventory item ${mapped.itemGid} is not tracked by Shopify`
          );
        }

        if (
          !Number.isSafeInteger(
            line.on_hand_quantity
          )
        ) {
          throw new Error(
            `[OPENING_CUTOVER_SHOPIFY] Target inventory item ${mapped.itemGid} has no usable current on_hand quantity`
          );
        }

        targetItemIds.add(
          mapped.itemGid
        );

        const observed =
          Number(
            line.on_hand_quantity
          );

        entries.push({
          lasyncroVariantId:
            targetRow.lasyncroVariantId,

          shopifyInventoryItemGid:
            mapped.itemGid,

          shopifyVariantGid:
            validProductVariantGid(
              line.shopify_variant_id
            ),

          targetQuantity:
            targetRow.targetQuantity,

          observedOnHandQuantity:
            observed,

          inventoryLevelPresent:
            true,

          inventoryLevelActive:
            true,

          tracked:
            true,

          disposition:
            targetRow.targetQuantity ===
            observed
              ? 'no_op'
              : 'write',

          batchIndex:
            null,

          batchPosition:
            null,
        });
      }

      for (
        const line of
        collected.lines
      ) {
        if (
          targetItemIds.has(
            line.shopify_inventory_item_id
          )
        ) {
          continue;
        }

        if (
          line.inventory_level_present !==
            true
        ) {
          continue;
        }

        if (
          !Number.isSafeInteger(
            line.on_hand_quantity
          )
        ) {
          throw new Error(
            `[OPENING_CUTOVER_SHOPIFY] Provider-only inventory item ${line.shopify_inventory_item_id} has unusable on_hand evidence`
          );
        }

        if (
          line.on_hand_quantity !== 0
        ) {
          throw new Error(
            `[OPENING_CUTOVER_PREFLIGHT] Shopify Location holds nonzero on_hand for inventory item ${line.shopify_inventory_item_id} outside the physical target universe`
          );
        }

        if (
          line.lasyncro_variant_id &&
          targetVariantIds.has(
            line.lasyncro_variant_id
          )
        ) {
          throw new Error(
            `[OPENING_CUTOVER_IDENTITY] Target variant ${line.lasyncro_variant_id} resolved to inconsistent Shopify inventory evidence`
          );
        }

        entries.push({
          lasyncroVariantId:
            line.lasyncro_variant_id
              ? String(
                  line.lasyncro_variant_id
                )
              : null,

          shopifyInventoryItemGid:
            line.shopify_inventory_item_id,

          shopifyVariantGid:
            validProductVariantGid(
              line.shopify_variant_id
            ),

          targetQuantity:
            null,

          observedOnHandQuantity:
            0,

          inventoryLevelPresent:
            true,

          inventoryLevelActive:
            line.inventory_level_active,

          tracked:
            line.tracked,

          disposition:
            'provider_only_zero',

          batchIndex:
            null,

          batchPosition:
            null,
        });
      }

      entries.sort(
        (left, right) =>
          left.shopifyInventoryItemGid <
          right.shopifyInventoryItemGid
            ? -1
            : left.shopifyInventoryItemGid >
                right.shopifyInventoryItemGid
              ? 1
              : 0
      );

      const writes =
        entries.filter(
          (entry) =>
            entry.disposition ===
            'write'
        );

      const generationId =
        crypto.randomUUID();

      const writeGroups =
        chunk(
          writes,
          MAX_SHOPIFY_CHANGES_PER_BATCH
        );

      const batchRows: Array<{
        generation_id: string;
        shop_id: number;
        batch_index: number;
        requested_api_version: string;
        served_api_version: string;
        cas_mode: string;
        operation_name: string;
        graphql_document: string;
        canonical_variables: string;
        reference_document_uri: string;
        idempotency_key: string;
        request_sha256: string;
        entry_count: number;
      }> = [];

      for (
        let groupIndex = 0;
        groupIndex <
        writeGroups.length;
        groupIndex += 1
      ) {
        const batchIndex =
          groupIndex + 1;

        const group =
          writeGroups[
            groupIndex
          ];

        for (
          let position = 0;
          position <
          group.length;
          position += 1
        ) {
          group[position]
            .batchIndex =
            batchIndex;

          group[position]
            .batchPosition =
            position + 1;
        }

        const idempotencyKey =
          crypto.randomUUID();

        const referenceDocumentUri =
          `gid://lasyncro/OpeningInventoryCutover/` +
          `shop-${shopId}-` +
          `generation-${generationId}-` +
          `batch-${batchIndex}`;

        const variables = {
          idempotencyKey,

          input: {
            name:
              'on_hand',

            reason:
              'correction',

            referenceDocumentUri,

            quantities:
              group.map(
                (entry) => ({
                  inventoryItemId:
                    entry.shopifyInventoryItemGid,

                  locationId:
                    reservation.locationGid,

                  quantity:
                    entry.targetQuantity,

                  changeFromQuantity:
                    entry.observedOnHandQuantity,
                })
              ),
          },
        };

        const canonicalVariables =
          canonicalGenerationJson(
            variables
          );

        const operationName =
          'OpeningInventorySetQuantities';

        batchRows.push({
          generation_id:
            generationId,

          shop_id:
            shopId,

          batch_index:
            batchIndex,

          requested_api_version:
            reservation.requestedApiVersion,

          served_api_version:
            collected.servedApiVersion as string,

          cas_mode:
            GENERATION_CAS_MODE,

          operation_name:
            operationName,

          graphql_document:
            OPENING_INVENTORY_SET_QUANTITIES_MUTATION,

          canonical_variables:
            canonicalVariables,

          reference_document_uri:
            referenceDocumentUri,

          idempotency_key:
            idempotencyKey,

          request_sha256:
            requestHashForGenerationBatch({
              operationName,

              graphqlDocument:
                OPENING_INVENTORY_SET_QUANTITIES_MUTATION,

              requestedApiVersion:
                reservation.requestedApiVersion,

              servedApiVersion:
                collected.servedApiVersion as string,

              casMode:
                GENERATION_CAS_MODE,

              canonicalVariables,
            }),

          entry_count:
            group.length,
        });
      }

      const targetFingerprint =
        generationFingerprint(
          target.map(
            (row) => ({
              lasyncroVariantId:
                row.lasyncroVariantId,

              targetQuantity:
                row.targetQuantity,
            })
          )
        );

      const providerReadFingerprint =
        generationFingerprint(
          [...collected.lines]
            .sort(
              (left, right) =>
                left.shopify_inventory_item_id <
                right.shopify_inventory_item_id
                  ? -1
                  : left.shopify_inventory_item_id >
                      right.shopify_inventory_item_id
                    ? 1
                    : 0
            )
            .map(
              (line) => ({
                shopifyInventoryItemGid:
                  line.shopify_inventory_item_id,

                shopifyVariantGid:
                  validProductVariantGid(
                    line.shopify_variant_id
                  ),

                lasyncroVariantId:
                  line.lasyncro_variant_id,

                inventoryLevelPresent:
                  line.inventory_level_present,

                inventoryLevelActive:
                  line.inventory_level_active,

                tracked:
                  line.tracked,

                onHandQuantity:
                  line.on_hand_quantity,
              })
            )
        );

      const semanticFingerprint =
        generationFingerprint({
          snapshotId:
            reservation.snapshotId,

          warehouseId:
            reservation.warehouseId,

          locationGid:
            reservation.locationGid,

          shopDomain:
            reservation.shopDomain,

          shopGid:
            reservation.shopGid,

          requestedApiVersion:
            reservation.requestedApiVersion,

          servedApiVersion:
            collected.servedApiVersion,

          casMode:
            GENERATION_CAS_MODE,

          quantityName:
            'on_hand',

          reason:
            'correction',

          identityFingerprint:
            reservation.identityFingerprint,

          targetFingerprint,

          providerReadFingerprint,

          entries:
            entries.map(
              (entry) => ({
                lasyncroVariantId:
                  entry.lasyncroVariantId,

                shopifyInventoryItemGid:
                  entry.shopifyInventoryItemGid,

                targetQuantity:
                  entry.targetQuantity,

                observedOnHandQuantity:
                  entry.observedOnHandQuantity,

                disposition:
                  entry.disposition,

                batchIndex:
                  entry.batchIndex,

                batchPosition:
                  entry.batchPosition,
              })
            ),
        });

      const previous =
        await trx(GENERATIONS)
          .where({
            shop_id:
              shopId,
          })
          .max<{
            max:
              | number
              | string
              | null;
          }>(
            'generation_sequence as max'
          )
          .first();

      const generationSequence =
        Number(
          previous?.max ?? 0
        ) + 1;

      await trx(
        GENERATIONS
      ).insert({
        generation_id:
          generationId,

        shop_id:
          shopId,

        generation_sequence:
          generationSequence,

        opening_snapshot_id:
          reservation.snapshotId,

        warehouse_id:
          reservation.warehouseId,

        shopify_location_gid:
          reservation.locationGid,

        shopify_shop_domain:
          reservation.shopDomain,

        shopify_shop_gid:
          reservation.shopGid,

        requested_api_version:
          reservation.requestedApiVersion,

        served_api_version:
          collected.servedApiVersion,

        cas_mode:
          GENERATION_CAS_MODE,

        quantity_name:
          'on_hand',

        reason:
          'correction',

        approved_by_actor_type:
          'user',

        approved_by_actor_id:
          String(
            actingUserId
          ),

        approved_by_role:
          approvedRole,

        approved_at:
          reservation.approvedAt,

        physical_truth_accepted_at:
          reservation.physicalTruthAcceptedAt,

        identity_fingerprint:
          reservation.identityFingerprint,

        target_fingerprint:
          targetFingerprint,

        provider_read_fingerprint:
          providerReadFingerprint,

        generation_fingerprint:
          semanticFingerprint,

        canonicalization_version:
          GENERATION_CANONICALIZATION_VERSION,

        batching_version:
          GENERATION_BATCHING_VERSION,

        batch_size:
          MAX_SHOPIFY_CHANGES_PER_BATCH,

        provider_read_started_at:
          collected.readStartedAt,

        provider_read_completed_at:
          collected.readCompletedAt,

        provider_page_count:
          collected.pageCount,

        target_item_count:
          target.length,

        provider_only_item_count:
          entries.filter(
            (entry) =>
              entry.disposition ===
              'provider_only_zero'
          ).length,

        write_count:
          writes.length,

        batch_count:
          batchRows.length,

        status:
          'assembling',

        frozen_at:
          null,
      });

      if (
        entries.length > 0
      ) {
        await trx(
          GENERATION_ENTRIES
        ).insert(
          entries.map(
            (
              entry,
              index
            ) => ({
              generation_id:
                generationId,

              shop_id:
                shopId,

              ordinal:
                index + 1,

              lasyncro_variant_id:
                entry.lasyncroVariantId,

              shopify_inventory_item_gid:
                entry.shopifyInventoryItemGid,

              shopify_variant_gid:
                entry.shopifyVariantGid,

              target_quantity:
                entry.targetQuantity,

              observed_on_hand_quantity:
                entry.observedOnHandQuantity,

              inventory_level_present:
                entry.inventoryLevelPresent,

              inventory_level_active:
                entry.inventoryLevelActive,

              tracked:
                entry.tracked,

              disposition:
                entry.disposition,

              batch_index:
                entry.batchIndex,

              batch_position:
                entry.batchPosition,
            })
          )
        );
      }

      if (
        batchRows.length > 0
      ) {
        await trx(
          GENERATION_BATCHES
        ).insert(
          batchRows
        );
      }

      await trx(
        GENERATIONS
      )
        .where({
          shop_id:
            shopId,

          generation_id:
            generationId,

          status:
            'assembling',
        })
        .update({
          status:
            'frozen',

          frozen_at:
            trx.fn.now(),
        });

      const created =
        await trx(
          GENERATIONS
        )
          .where({
            shop_id:
              shopId,

            generation_id:
              generationId,
          })
          .first();

      if (!created) {
        throw new Error(
          '[OPENING_CUTOVER_INTERNAL] Frozen opening inventory generation disappeared before transaction commit'
        );
      }

      return created;
    },
    // T2 reads all local reconciliation state from one snapshot: truth
    // committed after T2 begins must not leak into its later target read.
    {
      isolationLevel:
        'repeatable read',
    }
  );
}
