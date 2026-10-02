// apps/backend/src/services/wms/shopifyOpeningInventorySnapshot.service.ts
//
// GH-1179 SLICE B — LOCATION-SCOPED SHOPIFY ON_HAND SNAPSHOT AT OPENING START
// ---------------------------------------------------------------------------
// The canonical shop-wide Opening Inventory start. Counting may begin only
// after a complete, immutable snapshot of Shopify on_hand at the participating
// warehouse's mapped Shopify Location has been captured:
//
//   T1  reserve   short tenant transaction under the shop_wms_settings lock:
//                 replay an existing cohort, reclaim an expired collector,
//                 validate scope + identity, insert a 'collecting' header
//                 holding a lease.
//   ──  collect   Location.inventoryLevels pagination OUTSIDE any transaction;
//                 every validated page refreshes the lease in its own short
//                 transaction. Lines stay in memory.
//   T2  finalize  one tenant transaction: re-prove ownership, scope and the
//                 T1 identity fingerprint, insert every line, mark the header
//                 complete, create the opening cohort and started_at. All or
//                 nothing.
//
// The snapshot is provenance evidence only; it never drives delta arithmetic.
// A collector owns its header only while status='collecting', its token
// matches and its lease is unexpired, so a superseded collector can neither
// heartbeat nor finalize.

import crypto from 'crypto';
import type { Knex } from 'knex';

import { withTenant } from '@lasyncro/backend-core/db.js';

import { decrypt } from '../../security/encryption.service.js';
import type { createShopifyGraphQLClient as CreateShopifyGraphQLClient } from '../shopify/shopifyClient.service.js';
import {
  createOpeningInventoryCohort,
  lockOpeningInventoryStart,
  resolveOpeningInventoryStartScope,
  type ShopOpeningInventoryProgress,
} from './inventoryRecount.service.js';

export const OPENING_INVENTORY_SNAPSHOT_LEASE_MS = 5 * 60 * 1000;
export const OPENING_INVENTORY_SNAPSHOT_PAGE_SIZE = 100;

const SNAPSHOTS = 'opening_inventory_shopify_snapshots';
const LINES = 'opening_inventory_shopify_snapshot_lines';
const LINE_INSERT_CHUNK = 500;

export const OPENING_INVENTORY_SNAPSHOT_QUERY = `
  query OpeningInventorySnapshot(
    $locationId: ID!
    $first: Int!
    $after: String
  ) {
    location(id: $locationId) {
      id
      isActive
      inventoryLevels(
        first: $first
        after: $after
        includeInactive: true
      ) {
        pageInfo {
          hasNextPage
          endCursor
        }
        nodes {
          id
          isActive
          item {
            id
            tracked
            variant {
              id
            }
          }
          quantities(names: ["on_hand"]) {
            name
            quantity
          }
        }
      }
    }
  }
`;

export interface OpeningInventoryLocationPageVariables {
  locationId: string;
  first: number;
  after: string | null;
}

/** Returns the raw GraphQL response for one Location.inventoryLevels page. */
export type OpeningInventoryLocationPageReader = (params: {
  shopId: number;
  variables: OpeningInventoryLocationPageVariables;
}) => Promise<unknown>;

export interface StartShopOpeningInventoryParams {
  shopId: number;
  createdBy: number;
  assignedTo?: number | null;
}

export interface StartShopOpeningInventoryDeps {
  readLocationPage?: OpeningInventoryLocationPageReader;
}

type ErrorPrefix =
  | 'OPENING_START_IN_PROGRESS'
  | 'OPENING_START_SHOPIFY_FAILED'
  | 'OPENING_RECOUNT_SHOP_START';

/**
 * Stable classification for snapshot start failures. The leading prefix is
 * the public contract mapped by the start route; failureCode is the only
 * value persisted on a failed header and never carries provider text.
 */
class OpeningInventorySnapshotError extends Error {
  constructor(
    readonly prefix: ErrorPrefix,
    readonly failureCode: string,
    detail: string
  ) {
    super(`[${prefix}] ${failureCode}: ${detail}`);
  }
}

const shopifyFailure = (failureCode: string, detail: string) =>
  new OpeningInventorySnapshotError('OPENING_START_SHOPIFY_FAILED', failureCode, detail);

const scopeFailure = (failureCode: string, detail: string) =>
  new OpeningInventorySnapshotError('OPENING_RECOUNT_SHOP_START', failureCode, detail);

const ownershipLost = () =>
  scopeFailure(
    'COLLECTION_OWNERSHIP_LOST',
    'Opening inventory snapshot collection no longer owns its reservation'
  );

export function normalizeShopifyGid(
  kind: 'Location' | 'InventoryItem',
  value: unknown
): string | null {
  const raw = String(value ?? '').trim();

  if (/^\d+$/.test(raw)) return `gid://shopify/${kind}/${raw}`;

  const match = new RegExp(`^gid://shopify/${kind}/(\\d+)$`).exec(raw);
  return match ? `gid://shopify/${kind}/${match[1]}` : null;
}

function leaseExpiry(trx: Knex.Transaction) {
  return trx.raw(`now() + (? * interval '1 millisecond')`, [
    OPENING_INVENTORY_SNAPSHOT_LEASE_MS,
  ]);
}

function cohortFingerprint(
  bins: Array<{ warehouse_id: string; location_code: string }>
): string {
  const keys = bins
    .map((bin) => `${bin.warehouse_id}\u0000${bin.location_code}`)
    .sort();

  return crypto.createHash('sha256').update(JSON.stringify(keys)).digest('hex');
}

// ─── identity ───────────────────────────────────────────────────────────────

export interface ShopifyItemIdentity {
  lasyncroVariantId: string;
  externalVariantId: string | null;
  relevant: boolean;
}

export interface ShopifyIdentityRow {
  lasyncro_variant_id: string;
  external_variant_id: string | null;
  external_inventory_item_id: string | null;
  variant_status: string | null;
  product_status: string | null;
  product_type: string | null;
}

/**
 * Every tenant-scoped Shopify identity row with the relevance state that
 * decides how a collected level is interpreted. `lockRows` share-locks the
 * identity rows for the rest of the caller's transaction.
 */
export async function selectShopifyIdentityRows(
  trx: Knex.Transaction,
  shopId: number,
  options: { lockRows?: boolean } = {}
): Promise<ShopifyIdentityRow[]> {
  const query = trx('external_product_identity_map as m')
    .leftJoin('variants as v', function () {
      this.on('v.lasyncro_variant_id', '=', 'm.lasyncro_variant_id')
        .andOn('v.shop_id', '=', 'm.shop_id');
    })
    .leftJoin('products as p', function () {
      this.on('p.lasyncro_product_id', '=', 'v.lasyncro_product_id')
        .andOn('p.shop_id', '=', 'v.shop_id');
    })
    .where({ 'm.shop_id': shopId, 'm.platform': 'shopify' })
    .select(
      'm.lasyncro_variant_id',
      'm.external_variant_id',
      'm.external_inventory_item_id',
      'v.status as variant_status',
      'p.status as product_status',
      'p.product_type'
    );

  return options.lockRows ? query.forShare('m') : query;
}

/**
 * Deterministic fingerprint of the identity state used to interpret a
 * snapshot. Covers every mapped row, not only relevant ones: any mapped item
 * binds a collected level to a LaSyncro variant, and the relevance fields
 * catch a variant/product entering or leaving the active physical cohort.
 */
export function identityFingerprint(rows: ShopifyIdentityRow[]): string {
  const keys = rows
    .map((row) =>
      JSON.stringify([
        String(row.lasyncro_variant_id),
        normalizeShopifyGid('InventoryItem', row.external_inventory_item_id),
        row.external_variant_id ? String(row.external_variant_id) : null,
        row.variant_status ?? null,
        row.product_status ?? null,
        row.product_type ?? null,
      ])
    )
    .sort();

  return crypto.createHash('sha256').update(JSON.stringify(keys)).digest('hex');
}

/**
 * Tenant-scoped Shopify inventory-item identities keyed by normalized GID.
 * "Relevant" = an active variant of an active physical product: every such
 * variant must carry an inventory item identity, and each one absent from the
 * Location enumeration is recorded as explicit not-present evidence.
 */
export function buildShopifyItemIdentities(
  rows: ShopifyIdentityRow[]
): Map<string, ShopifyItemIdentity> {
  const byItem = new Map<string, ShopifyItemIdentity>();
  const itemByVariant = new Map<string, string>();
  let missingRelevantIdentity = 0;

  for (const row of rows) {
    const lasyncroVariantId = String(row.lasyncro_variant_id);
    const relevant =
      row.variant_status === 'active' &&
      row.product_status === 'active' &&
      row.product_type === 'physical';
    const itemGid = normalizeShopifyGid(
      'InventoryItem',
      row.external_inventory_item_id
    );

    if (!itemGid) {
      if (relevant) missingRelevantIdentity += 1;
      continue;
    }

    const existing = byItem.get(itemGid);
    const variantItem = itemByVariant.get(lasyncroVariantId);

    if (
      (existing && existing.lasyncroVariantId !== lasyncroVariantId) ||
      (variantItem && variantItem !== itemGid)
    ) {
      throw scopeFailure(
        'SHOPIFY_IDENTITY_AMBIGUOUS',
        'A Shopify inventory item or LaSyncro variant has more than one identity mapping'
      );
    }

    itemByVariant.set(lasyncroVariantId, itemGid);
    byItem.set(itemGid, {
      lasyncroVariantId,
      externalVariantId:
        existing?.externalVariantId ??
        (row.external_variant_id ? String(row.external_variant_id) : null),
      relevant: Boolean(existing?.relevant) || relevant,
    });
  }

  if (missingRelevantIdentity > 0) {
    throw scopeFailure(
      'SHOPIFY_IDENTITY_INCOMPLETE',
      `${missingRelevantIdentity} active physical Shopify variant(s) have no inventory item identity`
    );
  }

  return byItem;
}

// ─── T1 reserve ─────────────────────────────────────────────────────────────

interface SnapshotReservation {
  snapshotId: string;
  collectionToken: string;
  warehouseId: string;
  locationGid: string;
  fingerprint: string;
  identities: Map<string, ShopifyItemIdentity>;
  identityFingerprint: string;
}

async function reserveOpeningInventorySnapshot(
  params: StartShopOpeningInventoryParams
): Promise<
  | { kind: 'replay'; progress: ShopOpeningInventoryProgress }
  | { kind: 'reserved'; reservation: SnapshotReservation }
> {
  const { shopId } = params;

  return withTenant(shopId, async (trx) => {
    const gate = await lockOpeningInventoryStart(trx, shopId);
    if (gate.kind === 'replay') return gate;

    const liveHeaders = await trx(SNAPSHOTS)
      .where({ shop_id: shopId })
      .whereIn('status', ['collecting', 'complete'])
      .forUpdate()
      .select(
        'snapshot_id',
        'status',
        trx.raw('lease_expires_at > now() AS lease_live')
      );

    for (const header of liveHeaders) {
      if (header.status === 'complete') {
        throw scopeFailure(
          'SNAPSHOT_WITHOUT_COHORT',
          'A complete Shopify snapshot exists without an opening cohort'
        );
      }

      if (header.lease_live) {
        throw new OpeningInventorySnapshotError(
          'OPENING_START_IN_PROGRESS',
          'COLLECTION_IN_PROGRESS',
          'Opening inventory snapshot collection is already in progress'
        );
      }

      await trx(SNAPSHOTS)
        .where({
          shop_id: shopId,
          snapshot_id: header.snapshot_id,
          status: 'collecting',
        })
        .update({
          status: 'abandoned',
          failure_code: 'LEASE_EXPIRED',
          updated_at: trx.fn.now(),
        });
    }

    const scope = await resolveOpeningInventoryStartScope(trx, {
      shopId,
      assignedTo: params.assignedTo,
    });

    const locationGid = normalizeShopifyGid('Location', scope.externalLocationId);

    if (!locationGid) {
      throw scopeFailure(
        'SHOPIFY_LOCATION_MAPPING_INVALID',
        'The participating warehouse Shopify Location mapping is not a Location id'
      );
    }

    const identityRows = await selectShopifyIdentityRows(trx, shopId);
    const identities = buildShopifyItemIdentities(identityRows);

    const shopifyApiVersion = String(process.env.SHOPIFY_API_VERSION ?? '').trim();

    if (!shopifyApiVersion) {
      throw shopifyFailure(
        'SHOPIFY_API_VERSION_MISSING',
        'SHOPIFY_API_VERSION is not configured'
      );
    }

    const previous = await trx(SNAPSHOTS)
      .where({ shop_id: shopId })
      .max<{ max: number | string | null }>('attempt_number as max')
      .first();

    const reservation: SnapshotReservation = {
      snapshotId: crypto.randomUUID(),
      collectionToken: crypto.randomUUID(),
      warehouseId: scope.warehouseId,
      locationGid,
      fingerprint: cohortFingerprint(scope.bins),
      identities,
      identityFingerprint: identityFingerprint(identityRows),
    };

    await trx(SNAPSHOTS).insert({
      snapshot_id: reservation.snapshotId,
      shop_id: shopId,
      warehouse_id: reservation.warehouseId,
      shopify_location_id: locationGid,
      attempt_number: Number(previous?.max ?? 0) + 1,
      status: 'collecting',
      collection_token: reservation.collectionToken,
      collection_started_at: trx.fn.now(),
      lease_expires_at: leaseExpiry(trx),
      shopify_api_version: shopifyApiVersion,
    });

    return { kind: 'reserved', reservation };
  });
}

// ─── collect (no transaction spans a provider call) ─────────────────────────

export interface SnapshotLine {
  shopify_inventory_item_id: string;
  shopify_variant_id: string | null;
  lasyncro_variant_id: string | null;
  inventory_level_present: boolean;
  inventory_level_active: boolean | null;
  tracked: boolean | null;
  on_hand_quantity: number | null;
}

interface ProviderLevel {
  itemGid: string;
  variantGid: string | null;
  active: boolean | null;
  tracked: boolean | null;
  onHand: number;
}

function parseLocationPage(
  response: any,
  locationGid: string
): { levels: ProviderLevel[]; hasNextPage: boolean; endCursor: string | null } {
  const errors = response?.errors;
  if (Array.isArray(errors) ? errors.length > 0 : Boolean(errors)) {
    throw shopifyFailure('SHOPIFY_GRAPHQL_ERROR', 'Shopify returned GraphQL errors');
  }

  if (!response?.data || typeof response.data !== 'object') {
    throw shopifyFailure('SHOPIFY_RESPONSE_MALFORMED', 'Shopify response has no data');
  }

  const location = response.data.location;

  if (location === null || location === undefined) {
    throw shopifyFailure('SHOPIFY_LOCATION_NOT_FOUND', 'Mapped Shopify Location was not found');
  }

  if (normalizeShopifyGid('Location', location.id) !== locationGid) {
    throw shopifyFailure('SHOPIFY_LOCATION_MISMATCH', 'Shopify returned a different Location');
  }

  if (location.isActive !== true) {
    throw shopifyFailure('SHOPIFY_LOCATION_INACTIVE', 'Mapped Shopify Location is not active');
  }

  const connection = location.inventoryLevels;
  const pageInfo = connection?.pageInfo;

  if (!pageInfo || typeof pageInfo.hasNextPage !== 'boolean') {
    throw shopifyFailure('SHOPIFY_RESPONSE_MALFORMED', 'inventoryLevels pageInfo is malformed');
  }

  const nodes: any[] | null = Array.isArray(connection.nodes)
    ? connection.nodes
    : Array.isArray(connection.edges)
      ? connection.edges.map((edge: any) => edge?.node)
      : null;

  if (!nodes) {
    throw shopifyFailure('SHOPIFY_RESPONSE_MALFORMED', 'inventoryLevels nodes are missing');
  }

  const levels = nodes.map((node) => {
    const itemGid = normalizeShopifyGid('InventoryItem', node?.item?.id);

    if (!itemGid) {
      throw shopifyFailure('SHOPIFY_RESPONSE_MALFORMED', 'Inventory level has no inventory item id');
    }

    const onHand = Array.isArray(node.quantities)
      ? node.quantities.find((quantity: any) => quantity?.name === 'on_hand')
      : undefined;

    if (!onHand || !Number.isSafeInteger(onHand.quantity)) {
      throw shopifyFailure('SHOPIFY_ON_HAND_MISSING', 'Inventory level has no on_hand quantity');
    }

    return {
      itemGid,
      variantGid:
        typeof node.item.variant?.id === 'string' ? node.item.variant.id : null,
      active: typeof node.isActive === 'boolean' ? node.isActive : null,
      tracked: typeof node.item.tracked === 'boolean' ? node.item.tracked : null,
      onHand: onHand.quantity as number,
    };
  });

  return {
    levels,
    hasNextPage: pageInfo.hasNextPage,
    endCursor:
      typeof pageInfo.endCursor === 'string' && pageInfo.endCursor
        ? pageInfo.endCursor
        : null,
  };
}

/**
 * Lease heartbeat in its own short transaction. Zero updated rows means the
 * header was reclaimed, finalized or expired: ownership is lost.
 */
async function refreshCollectionLease(
  shopId: number,
  reservation: SnapshotReservation
): Promise<void> {
  const updated = await withTenant(shopId, (trx) =>
    trx(SNAPSHOTS)
      .where({
        shop_id: shopId,
        snapshot_id: reservation.snapshotId,
        collection_token: reservation.collectionToken,
        status: 'collecting',
      })
      .where('lease_expires_at', '>', trx.fn.now())
      .update({
        lease_expires_at: leaseExpiry(trx),
        updated_at: trx.fn.now(),
      })
  );

  if (updated !== 1) throw ownershipLost();
}

export function createOpeningInventoryLocationPageReader(): OpeningInventoryLocationPageReader {
  let client: ReturnType<typeof CreateShopifyGraphQLClient> | null = null;

  return async ({ shopId, variables }) => {
    if (!client) {
      const installation = await withTenant(shopId, (trx) =>
        trx('shopify_app_installations')
          .where({ shop_id: shopId })
          .whereNull('uninstalled_at')
          .select('shop_domain', 'access_token')
          .first()
      );

      if (!installation?.shop_domain || !installation?.access_token) {
        throw shopifyFailure(
          'SHOPIFY_INSTALLATION_MISSING',
          'Active Shopify installation is missing'
        );
      }

      // Loaded lazily, like the cutover executor: the Shopify SDK validates
      // its configuration at import, which must not burden the start route
      // module or callers that inject a reader.
      const { createShopifyGraphQLClient } = await import(
        '../shopify/shopifyClient.service.js'
      );

      client = createShopifyGraphQLClient({
        // Same Opening Inventory ↔ Shopify workflow as the cutover executor.
        accessToken: decrypt(installation.access_token, 'wms.openingInventoryCutover'),
        platformShopName: installation.shop_domain,
        shopId,
      });
    }

    return client.request(OPENING_INVENTORY_SNAPSHOT_QUERY, { variables });
  };
}

function servedShopifyApiVersion(
  response: unknown
): string | null {
  const headers = (response as any)?.headers;

  if (!headers) return null;

  if (typeof headers.get === 'function') {
    const value =
      headers.get('X-Shopify-API-Version') ??
      headers.get('x-shopify-api-version');

    const normalized = String(value ?? '').trim();
    return normalized || null;
  }

  if (typeof headers !== 'object') return null;

  for (const [name, value] of Object.entries(headers)) {
    if (name.toLowerCase() !== 'x-shopify-api-version') {
      continue;
    }

    const raw =
      Array.isArray(value)
        ? value[0]
        : value;

    const normalized =
      String(raw ?? '').trim();

    return normalized || null;
  }

  return null;
}

export interface OpeningInventoryLocationEvidence {
  lines: SnapshotLine[];
  pageCount: number;
  servedApiVersion: string | null;
  readStartedAt: Date;
  readCompletedAt: Date;
}

/**
 * Reusable read-only Shopify Location.inventoryLevels collector.
 *
 * It owns no database transaction and performs no persistence. Opening start
 * supplies `onPage` only for its lease heartbeat; Slice D uses the same
 * parser/pagination semantics without creating or mutating historical
 * snapshots.
 */
export async function collectOpeningInventoryLocationEvidence(params: {
  shopId: number;
  locationGid: string;
  identities: Map<string, ShopifyItemIdentity>;
  readLocationPage: OpeningInventoryLocationPageReader;
  requireServedApiVersion?: boolean;
  onPage?: () => Promise<void>;
}): Promise<OpeningInventoryLocationEvidence> {
  const {
    shopId,
    locationGid,
    identities,
    readLocationPage,
    requireServedApiVersion = false,
    onPage,
  } = params;

  const lines =
    new Map<string, SnapshotLine>();

  const seenCursors =
    new Set<string>();

  let cursor: string | null = null;
  let pageCount = 0;
  let servedApiVersion: string | null = null;

  const readStartedAt = new Date();

  for (;;) {
    let response: unknown;

    try {
      response = await readLocationPage({
        shopId,
        variables: {
          locationId: locationGid,
          first:
            OPENING_INVENTORY_SNAPSHOT_PAGE_SIZE,
          after: cursor,
        },
      });
    } catch (error) {
      if (
        error instanceof
        OpeningInventorySnapshotError
      ) {
        throw error;
      }

      throw shopifyFailure(
        'SHOPIFY_REQUEST_FAILED',
        'Shopify inventory request failed'
      );
    }

    pageCount += 1;

    const pageServedVersion =
      servedShopifyApiVersion(response);

    if (
      requireServedApiVersion &&
      !pageServedVersion
    ) {
      throw shopifyFailure(
        'SHOPIFY_SERVED_API_VERSION_MISSING',
        'Shopify response did not identify the served Admin API version'
      );
    }

    if (pageServedVersion) {
      if (
        servedApiVersion &&
        servedApiVersion !==
          pageServedVersion
      ) {
        throw shopifyFailure(
          'SHOPIFY_SERVED_API_VERSION_CHANGED',
          'Shopify served different Admin API versions during one inventory read'
        );
      }

      servedApiVersion =
        pageServedVersion;
    }

    const page =
      parseLocationPage(
        response,
        locationGid
      );

    if (page.hasNextPage) {
      if (!page.endCursor) {
        throw shopifyFailure(
          'SHOPIFY_CURSOR_INVALID',
          'hasNextPage without endCursor'
        );
      }

      if (
        page.endCursor === cursor ||
        seenCursors.has(page.endCursor)
      ) {
        throw shopifyFailure(
          'SHOPIFY_CURSOR_STALLED',
          'Pagination cursor did not advance'
        );
      }
    }

    for (const level of page.levels) {
      if (lines.has(level.itemGid)) {
        throw shopifyFailure(
          'SHOPIFY_DUPLICATE_ITEM',
          'An inventory item appeared more than once at the Location'
        );
      }

      const identity =
        identities.get(level.itemGid);

      if (
        !identity &&
        level.onHand !== 0
      ) {
        throw scopeFailure(
          'UNMAPPED_SHOPIFY_INVENTORY',
          'The Shopify Location holds on_hand for an item with no LaSyncro identity'
        );
      }

      lines.set(
        level.itemGid,
        {
          shopify_inventory_item_id:
            level.itemGid,

          shopify_variant_id:
            level.variantGid ??
            identity?.externalVariantId ??
            null,

          lasyncro_variant_id:
            identity?.lasyncroVariantId ??
            null,

          inventory_level_present:
            true,

          inventory_level_active:
            level.active,

          tracked:
            level.tracked,

          on_hand_quantity:
            level.onHand,
        }
      );
    }

    if (onPage) {
      await onPage();
    }

    if (!page.hasNextPage) {
      break;
    }

    seenCursors.add(
      page.endCursor as string
    );

    cursor =
      page.endCursor;
  }

  // A known relevant item absent from this Location remains explicit absence,
  // never synthesized as zero.
  for (
    const [itemGid, identity]
    of identities
  ) {
    if (
      !identity.relevant ||
      lines.has(itemGid)
    ) {
      continue;
    }

    lines.set(
      itemGid,
      {
        shopify_inventory_item_id:
          itemGid,

        shopify_variant_id:
          identity.externalVariantId,

        lasyncro_variant_id:
          identity.lasyncroVariantId,

        inventory_level_present:
          false,

        inventory_level_active:
          null,

        tracked:
          null,

        on_hand_quantity:
          null,
      }
    );
  }

  return {
    lines:
      [...lines.values()],

    pageCount,

    servedApiVersion,

    readStartedAt,

    readCompletedAt:
      new Date(),
  };
}

async function collectLocationSnapshot(
  shopId: number,
  reservation: SnapshotReservation,
  readLocationPage:
    OpeningInventoryLocationPageReader
): Promise<{
  lines: SnapshotLine[];
  pageCount: number;
}> {
  const collected =
    await collectOpeningInventoryLocationEvidence({
      shopId,

      locationGid:
        reservation.locationGid,

      identities:
        reservation.identities,

      readLocationPage,

      onPage: () =>
        refreshCollectionLease(
          shopId,
          reservation
        ),
    });

  return {
    lines:
      collected.lines,

    pageCount:
      collected.pageCount,
  };
}

// ─── T2 finalize ────────────────────────────────────────────────────────────

async function finalizeOpeningInventorySnapshot(
  params: StartShopOpeningInventoryParams,
  reservation: SnapshotReservation,
  collected: { lines: SnapshotLine[]; pageCount: number }
): Promise<ShopOpeningInventoryProgress> {
  const { shopId } = params;

  return withTenant(shopId, async (trx) => {
    const gate = await lockOpeningInventoryStart(trx, shopId);

    if (gate.kind === 'replay') {
      throw scopeFailure(
        'COHORT_ALREADY_STARTED',
        'An opening cohort already exists for this shop'
      );
    }

    const header = await trx(SNAPSHOTS)
      .where({ shop_id: shopId, snapshot_id: reservation.snapshotId })
      .forUpdate()
      .select(
        'status',
        'collection_token',
        trx.raw('lease_expires_at > now() AS lease_live')
      )
      .first();

    if (
      !header ||
      header.status !== 'collecting' ||
      header.collection_token !== reservation.collectionToken ||
      !header.lease_live
    ) {
      throw ownershipLost();
    }

    const scope = await resolveOpeningInventoryStartScope(trx, {
      shopId,
      assignedTo: params.assignedTo,
    });

    if (
      scope.warehouseId !== reservation.warehouseId ||
      normalizeShopifyGid('Location', scope.externalLocationId) !== reservation.locationGid ||
      cohortFingerprint(scope.bins) !== reservation.fingerprint
    ) {
      throw scopeFailure(
        'SCOPE_CHANGED',
        'Opening inventory scope changed while the Shopify snapshot was collected'
      );
    }

    // Lines are interpreted through the T1 identity snapshot; never persist
    // them if that identity state changed while Shopify was being read.
    const identityRows = await selectShopifyIdentityRows(trx, shopId, { lockRows: true });

    if (identityFingerprint(identityRows) !== reservation.identityFingerprint) {
      throw scopeFailure(
        'IDENTITY_CHANGED_DURING_COLLECTION',
        'Shopify identity mappings changed while the Shopify snapshot was collected'
      );
    }

    for (let index = 0; index < collected.lines.length; index += LINE_INSERT_CHUNK) {
      await trx(LINES).insert(
        collected.lines
          .slice(index, index + LINE_INSERT_CHUNK)
          .map((line) => ({
            ...line,
            snapshot_id: reservation.snapshotId,
            shop_id: shopId,
          }))
      );
    }

    await trx(SNAPSHOTS)
      .where({
        shop_id: shopId,
        snapshot_id: reservation.snapshotId,
        collection_token: reservation.collectionToken,
        status: 'collecting',
      })
      .update({
        status: 'complete',
        completed_at: trx.fn.now(),
        line_count: collected.lines.length,
        page_count: collected.pageCount,
        updated_at: trx.fn.now(),
      });

    return createOpeningInventoryCohort(trx, {
      shopId,
      createdBy: params.createdBy,
      assignedTo: params.assignedTo,
      bins: scope.bins,
    });
  });
}

/**
 * Best-effort terminal failure for the attempt this caller still owns. A
 * reclaimed or finalized header matches zero rows and is left untouched; a
 * persistence failure is logged and never replaces the original error.
 */
async function markSnapshotFailed(
  shopId: number,
  reservation: SnapshotReservation,
  failureCode: string
): Promise<void> {
  try {
    await withTenant(shopId, (trx) =>
      trx(SNAPSHOTS)
        .where({
          shop_id: shopId,
          snapshot_id: reservation.snapshotId,
          collection_token: reservation.collectionToken,
          status: 'collecting',
        })
        .update({
          status: 'failed',
          failure_code: failureCode,
          updated_at: trx.fn.now(),
        })
    );
  } catch (error) {
    console.error('[OPENING_INVENTORY_SNAPSHOT_FAILURE_NOT_PERSISTED]', {
      shopId,
      snapshotId: reservation.snapshotId,
      failureCode,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

function failureCodeOf(error: unknown, fallback: string): string {
  return error instanceof OpeningInventorySnapshotError ? error.failureCode : fallback;
}

/**
 * Canonical shop-wide Opening Inventory start. Owns its transactions: the
 * Shopify read never runs inside one. `deps.readLocationPage` replaces only
 * the provider transport; reservation, validation and finalize are real.
 */
export async function startShopOpeningInventory(
  params: StartShopOpeningInventoryParams,
  deps: StartShopOpeningInventoryDeps = {}
): Promise<ShopOpeningInventoryProgress> {
  const { shopId } = params;

  const reserved = await reserveOpeningInventorySnapshot(params);
  if (reserved.kind === 'replay') return reserved.progress;

  const { reservation } = reserved;
  const readLocationPage =
    deps.readLocationPage ?? createOpeningInventoryLocationPageReader();

  let collected: { lines: SnapshotLine[]; pageCount: number };

  try {
    collected = await collectLocationSnapshot(shopId, reservation, readLocationPage);
  } catch (error) {
    await markSnapshotFailed(
      shopId,
      reservation,
      failureCodeOf(error, 'SHOPIFY_COLLECTION_FAILED')
    );
    console.error('[OPENING_INVENTORY_SNAPSHOT_FAILED]', {
      shopId,
      snapshotId: reservation.snapshotId,
      failureCode: failureCodeOf(error, 'SHOPIFY_COLLECTION_FAILED'),
    });
    throw error instanceof OpeningInventorySnapshotError
      ? error
      : shopifyFailure('SHOPIFY_COLLECTION_FAILED', 'Shopify snapshot collection failed');
  }

  try {
    const progress = await finalizeOpeningInventorySnapshot(params, reservation, collected);

    console.info('[OPENING_INVENTORY_SNAPSHOT_COMPLETE]', {
      shopId,
      snapshotId: reservation.snapshotId,
      lineCount: collected.lines.length,
      pageCount: collected.pageCount,
    });

    return progress;
  } catch (error) {
    await markSnapshotFailed(
      shopId,
      reservation,
      failureCodeOf(error, 'FINALIZE_FAILED')
    );
    throw error;
  }
}
