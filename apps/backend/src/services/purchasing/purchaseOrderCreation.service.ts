// apps/backend/src/services/purchasing/purchaseOrderCreation.service.ts
//
// GH-1262 S1 — CANONICAL MANUAL PO CREATION (E1)
// -----------------------------------------------
// Runs inside the caller's tenant transaction, which creates the optional new
// supplier, the draft PO, its lines, the idempotency ledger row and (in the
// controller, outermost-transaction rule) the snapshot job — or nothing at all.
//
//   - supplier_id XOR new_supplier
//   - every line names a tenant-owned variant with a Shopify identity whose
//     product is active / draft / unlisted (archived, deleted, unknown and
//     foreign identities are rejected)
//   - quantity_ordered is a strict positive integer; unit_cost_cents is
//     either absent/null (unknown) or a non-negative integer (0 = known free)
//   - NOT_INSTALLED / UNINSTALLED connections reject; REAUTH_REQUIRED and the
//     other installed states still allow a draft PO (no provider call is made)
//   - no inventory, LSU, Receive or Stow write
//
// IDEMPOTENCY: Idempotency-Key is mandatory. Per (tenant, key) the writer takes
// a transaction-level advisory lock before any read or write, then consults
// purchase_order_idempotency_keys (migration 0221):
//   same fingerprint      → the original PO, no new write
//   different fingerprint → 409
// The fingerprint is a SHA-256 over the validated, canonical request; lines
// are sorted by variant identity, so line order does not change it.

import crypto from 'crypto';
import type { Knex } from 'knex';
import { classifyShopifyConnection } from '../shopify/shopifyConnectionState.service.js';

const PG_INT_MAX = 2147483647;
const MAX_IDEMPOTENCY_KEY_LENGTH = 255;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ELIGIBLE_PRODUCT_STATUSES = ['active', 'draft', 'unlisted'];
// Column limits (migrations 0094/0095/0096): varchar lengths count characters.
const SUPPLIER_TEXT_MAX = 255;
const LINE_DESCRIPTION_MAX = 1024;
const DOCUMENT_URL_MAX = 1024;
const ISO_DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
// Canonical Shopify identities as both catalog ingestion paths persist them
// (shopifyProducts.core.ts; normalizeShopifyRestProduct.ts toGid).
const SHOPIFY_VARIANT_GID_PATTERN = '^gid://shopify/ProductVariant/[1-9][0-9]*$';
const SHOPIFY_PRODUCT_GID_PATTERN = '^gid://shopify/Product/[1-9][0-9]*$';

export class PurchaseOrderCreationError extends Error {
  constructor(public readonly statusCode: number, message: string) {
    super(message);
  }
}

const reject = (statusCode: number, message: string): never => {
  throw new PurchaseOrderCreationError(statusCode, message);
};

type NewSupplier = {
  name: string;
  contact_name: string | null;
  contact_email: string | null;
  contact_phone: string | null;
  notes: string | null;
  moq: number | null;
  lead_time_days: number | null;
};

type Line = {
  lasyncro_variant_id: string;
  description: string;
  quantity_ordered: number;
  unit_cost_cents: number | null;
};

export type PurchaseOrderCreateInput = {
  supplier_id: number | null;
  new_supplier: NewSupplier | null;
  expected_delivery_date: string | null;
  notes: string | null;
  document_url: string | null;
  line_items: Line[];
};

const isPgInteger = (value: unknown, min: number): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value >= min && value <= PG_INT_MAX;

const charLength = (value: string) => Array.from(value).length;

const optionalText = (value: unknown, field: string, max?: number): string | null => {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string') return reject(400, `${field} must be a string`);
  const text = value.trim() || null;
  if (text !== null && max !== undefined && charLength(text) > max) {
    return reject(400, `${field} must be at most ${max} characters`);
  }
  return text;
};

/** Optional header text stored as given; absent/null stays null. */
const optionalRawString = (value: unknown, field: string, max?: number): string | null => {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string') return reject(400, `${field} must be a string`);
  if (max !== undefined && charLength(value) > max) {
    return reject(400, `${field} must be at most ${max} characters`);
  }
  return value;
};

/** A real calendar date in YYYY-MM-DD (PostgreSQL DATE, years 0001-9999). */
const optionalCalendarDate = (value: unknown, field: string): string | null => {
  if (value === undefined || value === null) return null;
  const match = typeof value === 'string' ? ISO_DATE_RE.exec(value) : null;
  if (!match) return reject(400, `${field} must be a date in YYYY-MM-DD format`);
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const leap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
  const daysInMonth = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1];
  if (year < 1 || daysInMonth === undefined || day < 1 || day > daysInMonth) {
    return reject(400, `${field} is not a real calendar date`);
  }
  return match[0];
};

const optionalSupplierInteger = (value: unknown, field: string): number | null => {
  if (value === undefined || value === null || value === '') return null;
  if (!isPgInteger(value, -PG_INT_MAX - 1)) return reject(400, `${field} must be a whole number`);
  return value;
};

export function readIdempotencyKey(header: unknown): string {
  if (typeof header !== 'string' || !header.trim()) {
    return reject(400, 'Idempotency-Key header is required');
  }
  const key = header.trim();
  if (key.length > MAX_IDEMPOTENCY_KEY_LENGTH) {
    return reject(400, `Idempotency-Key must be at most ${MAX_IDEMPOTENCY_KEY_LENGTH} characters`);
  }
  return key;
}

/** Validates the E1 body before any database access. */
export function parsePurchaseOrderCreateInput(body: any): PurchaseOrderCreateInput {
  const { supplier_id, new_supplier, expected_delivery_date, notes, document_url, line_items } = body ?? {};

  const hasSupplierId = supplier_id !== undefined && supplier_id !== null && supplier_id !== '';
  const hasNewSupplier = new_supplier !== undefined && new_supplier !== null;
  if (hasSupplierId === hasNewSupplier) {
    reject(400, 'Provide exactly one of supplier_id or new_supplier');
  }

  let supplierId: number | null = null;
  if (hasSupplierId) {
    supplierId = Number(supplier_id);
    if (!isPgInteger(supplierId, 1)) reject(400, 'supplier_id is invalid');
  }

  let newSupplier: NewSupplier | null = null;
  if (hasNewSupplier) {
    if (typeof new_supplier !== 'object' || Array.isArray(new_supplier)) {
      reject(400, 'new_supplier must be an object');
    }
    const name = new_supplier.name;
    if (typeof name !== 'string' || !name.trim()) reject(400, 'new_supplier.name is required');
    newSupplier = {
      name: optionalText(name, 'new_supplier.name', SUPPLIER_TEXT_MAX) as string,
      contact_name: optionalText(new_supplier.contact_name, 'new_supplier.contact_name', SUPPLIER_TEXT_MAX),
      contact_email: optionalText(new_supplier.contact_email, 'new_supplier.contact_email', SUPPLIER_TEXT_MAX),
      contact_phone: optionalText(new_supplier.contact_phone, 'new_supplier.contact_phone', SUPPLIER_TEXT_MAX),
      notes: optionalText(new_supplier.notes, 'new_supplier.notes'),
      moq: optionalSupplierInteger(new_supplier.moq, 'new_supplier.moq'),
      lead_time_days: optionalSupplierInteger(new_supplier.lead_time_days, 'new_supplier.lead_time_days'),
    };
  }

  if (!Array.isArray(line_items) || line_items.length === 0) {
    reject(400, 'line_items must be a non-empty array');
  }

  const seen = new Set<string>();
  const lines: Line[] = line_items.map((item: any) => {
    if (!item || typeof item !== 'object') return reject(400, 'Each line item must be an object');
    const variantId = item.lasyncro_variant_id;
    if (typeof variantId !== 'string' || !UUID_RE.test(variantId)) {
      return reject(422, 'Each line item requires a Shopify product variant');
    }
    const canonicalId = variantId.toLowerCase();
    if (seen.has(canonicalId)) return reject(422, 'Each variant may appear only once per purchase order');
    seen.add(canonicalId);

    if (typeof item.description !== 'string' || !item.description.trim()) {
      return reject(400, 'Each line item requires a description');
    }
    if (charLength(item.description) > LINE_DESCRIPTION_MAX) {
      return reject(400, `Each line item description must be at most ${LINE_DESCRIPTION_MAX} characters`);
    }
    if (!isPgInteger(item.quantity_ordered, 1)) {
      return reject(400, 'quantity_ordered must be a whole number of at least 1');
    }
    const cost = item.unit_cost_cents;
    if (cost !== undefined && cost !== null && !isPgInteger(cost, 0)) {
      return reject(400, 'unit_cost_cents must be a whole number of cents, 0 or more');
    }
    return {
      lasyncro_variant_id: canonicalId,
      description: item.description,
      quantity_ordered: item.quantity_ordered,
      unit_cost_cents: cost ?? null,
    };
  });

  return {
    supplier_id: supplierId,
    new_supplier: newSupplier,
    expected_delivery_date: optionalCalendarDate(expected_delivery_date, 'expected_delivery_date'),
    notes: optionalRawString(notes, 'notes'),
    document_url: optionalRawString(document_url, 'document_url', DOCUMENT_URL_MAX),
    line_items: lines,
  };
}

/** Canonical JSON: object keys sorted, lines sorted by variant identity. */
function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object' && !(value instanceof Date)) {
    return Object.fromEntries(
      Object.keys(value as Record<string, unknown>).sort().map((k) => [k, canonicalize((value as any)[k])]),
    );
  }
  return value;
}

export function fingerprintPurchaseOrderRequest(input: PurchaseOrderCreateInput): string {
  const lines = [...input.line_items].sort((a, b) =>
    a.lasyncro_variant_id < b.lasyncro_variant_id ? -1 : a.lasyncro_variant_id > b.lasyncro_variant_id ? 1 : 0,
  );
  const payload = JSON.stringify(canonicalize({ ...input, line_items: lines }));
  return crypto.createHash('sha256').update(payload).digest('hex');
}

async function loadEligibleVariantIds(trx: Knex.Transaction, shopId: number, ids: string[]): Promise<Set<string>> {
  const rows = await trx('variants as v')
    .join('products as p', function () {
      this.on('p.lasyncro_product_id', 'v.lasyncro_product_id').andOn('p.shop_id', 'v.shop_id');
    })
    .where('v.shop_id', shopId)
    .whereIn('v.lasyncro_variant_id', ids)
    .whereIn('p.status', ELIGIBLE_PRODUCT_STATUSES)
    .whereExists(function () {
      this.select(trx.raw('1'))
        .from('external_product_identity_map as m')
        .whereRaw('m.shop_id = v.shop_id')
        .andWhereRaw('m.lasyncro_variant_id = v.lasyncro_variant_id')
        .andWhere('m.platform', 'shopify')
        // A genuine variant-level identity: null, empty or malformed ids fail.
        .andWhereRaw('m.external_variant_id ~ ?', [SHOPIFY_VARIANT_GID_PATTERN])
        .andWhereRaw('m.external_product_id ~ ?', [SHOPIFY_PRODUCT_GID_PATTERN]);
    })
    .pluck('v.lasyncro_variant_id');
  return new Set(rows.map((id: string) => id.toLowerCase()));
}

export type PurchaseOrderCreateResult = { purchaseOrder: any; replayed: boolean };

/** Caller owns the transaction and has set app.current_tenant = shopId. */
export async function createPurchaseOrderIdempotently(
  trx: Knex.Transaction,
  shopId: number,
  idempotencyKey: string,
  input: PurchaseOrderCreateInput,
): Promise<PurchaseOrderCreateResult> {
  const fingerprint = fingerprintPurchaseOrderRequest(input);

  // Serializes concurrent retries of one key before supplier creation.
  await trx.raw('SELECT pg_advisory_xact_lock(hashtext(?), hashtext(?))', [
    `purchase_order_create:${shopId}`,
    idempotencyKey,
  ]);

  const prior = await trx('purchase_order_idempotency_keys')
    .where({ shop_id: shopId, idempotency_key: idempotencyKey })
    .first('request_fingerprint', 'purchase_order_id');
  if (prior) {
    if (prior.request_fingerprint !== fingerprint) {
      reject(409, 'This Idempotency-Key was already used for a different purchase order request');
    }
    // The key stays consumed after its PO is deleted (FK ON DELETE SET NULL).
    const original = prior.purchase_order_id === null ? null : await trx('purchase_orders')
      .where({ id: prior.purchase_order_id, shop_id: shopId })
      .first();
    if (!original) reject(409, 'The purchase order for this Idempotency-Key no longer exists');
    return { purchaseOrder: original, replayed: true };
  }

  const connection = await classifyShopifyConnection(trx, shopId);
  if (!connection.installed) {
    reject(422, 'Shopify is not installed — reinstall the app before creating a purchase order');
  }

  if (input.supplier_id !== null) {
    const supplier = await trx('suppliers')
      .where({ id: input.supplier_id, shop_id: shopId })
      .first('id');
    if (!supplier) reject(404, 'Supplier not found');
  }

  const variantIds = input.line_items.map((l) => l.lasyncro_variant_id);
  const eligible = await loadEligibleVariantIds(trx, shopId, variantIds);
  if (variantIds.some((id) => !eligible.has(id))) {
    reject(422, 'Every line must be an active, draft or unlisted Shopify variant of this store');
  }

  let supplierId = input.supplier_id;
  if (input.new_supplier) {
    // A rejection aborts the whole transaction: no orphan supplier or ledger.
    try {
      const [created] = await trx('suppliers')
        .insert({ shop_id: shopId, ...input.new_supplier })
        .returning('id');
      supplierId = created.id;
    } catch (err: any) {
      if (err?.code === '23505') reject(409, 'A supplier with this name already exists');
      throw err;
    }
  }

  const [newPo] = await trx('purchase_orders')
    .insert({
      shop_id: shopId,
      supplier_id: supplierId,
      status: 'draft',
      expected_delivery_date: input.expected_delivery_date,
      notes: input.notes,
      document_url: input.document_url,
    })
    .returning('*');

  await trx('purchase_order_line_items').insert(
    input.line_items.map((item) => ({
      po_id: newPo.id,
      shop_id: shopId,
      lasyncro_variant_id: item.lasyncro_variant_id,
      description: item.description,
      quantity_ordered: item.quantity_ordered,
      quantity_received: 0,
      unit_cost_cents: item.unit_cost_cents,
    })),
  );

  await trx('purchase_order_idempotency_keys').insert({
    shop_id: shopId,
    idempotency_key: idempotencyKey,
    request_fingerprint: fingerprint,
    purchase_order_id: newPo.id,
  });

  return { purchaseOrder: newPo, replayed: false };
}
