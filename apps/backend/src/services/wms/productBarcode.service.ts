// apps/backend/src/services/wms/productBarcode.service.ts
//
// SHOP-REV-01g — Product barcode identity (LSP-)
// ------------------------------------------------
// Shopify paused App Store review 2026-07-29 (ref 102766) citing 2.1.1:
// "the product barcodes are not generating." The app could resolve and
// scan product barcodes but had no path that created one — the Barcodes
// tab told merchants to "Generate or import to clear" with nothing behind
// it. On a Shopify test store, where variants ship with empty barcode
// fields, that is a dead end.
//
// NAMESPACE BOUNDARY — do not collapse these two columns:
//   variants.barcode          external EAN/UPC/GTIN, written only by
//                             Shopify sync (migration 0027). Platform-owned.
//   variants.lasyncro_barcode LSP- internal identity, minted here (0136).
//                             laSyncro-owned.
// A merchant may have both. Minting into variants.barcode would fabricate
// GTINs we have no GS1 prefix for and would be overwritten by the next sync.
//
// Alphabet excludes I, O, 0, 1 — visually ambiguous under a scanner.
// Mirrors wmsOrderBarcode.service.ts (LSO-), minus its pick-batch claim
// gate: every variant in a catalog is legitimately labelable.

import { Knex } from "knex";

const BARCODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const MAX_MINT_ATTEMPTS = 5;
const BULK_CHUNK = 500;

export function generateProductBarcode(): string {
  let code = 'LSP-';
  for (let i = 0; i < 8; i++) {
    code += BARCODE_ALPHABET[Math.floor(Math.random() * BARCODE_ALPHABET.length)];
  }
  return code;
}

/**
 * Returns the variant's LSP- barcode, minting one if absent.
 * Returns null when the variant does not exist in this shop.
 *
 * Caller must supply a transaction with app.current_tenant already set —
 * variants is FORCE ROW LEVEL SECURITY (migration 0027:80), so an
 * untenanted query silently returns zero rows rather than erroring.
 *
 * Each attempt runs in a nested transaction (SAVEPOINT). In Postgres a
 * unique violation aborts the entire enclosing transaction, so a bare
 * retry loop would fail its second iteration with "current transaction is
 * aborted". The savepoint confines the rollback to the failed attempt.
 *
 * Mint-once: the value is persisted, so a reprint returns the same
 * barcode and labels already applied to stock stay valid.
 */

export async function ensureVariantBarcode(
  trx: Knex.Transaction, shopId: number, lasyncroVariantId: string
): Promise<string | null> {
  const variant = await trx('variants')
    .where({ lasyncro_variant_id: lasyncroVariantId, shop_id: shopId })
    .select('lasyncro_barcode').first();
  if (!variant) return null;
  if (variant.lasyncro_barcode) return variant.lasyncro_barcode;

  for (let attempt = 1; attempt <= MAX_MINT_ATTEMPTS; attempt++) {
    const candidate = generateProductBarcode();
    try {
      const minted = await trx.transaction(async (sp) => {
        const rows = await sp('variants')
          .where({ lasyncro_variant_id: lasyncroVariantId, shop_id: shopId })
          .whereNull('lasyncro_barcode')
          .update({ lasyncro_barcode: candidate })
          .returning('lasyncro_barcode');
        return rows?.[0]?.lasyncro_barcode ?? null;
      });
      if (minted) return minted;
      const current = await trx('variants')
        .where({ lasyncro_variant_id: lasyncroVariantId, shop_id: shopId })
        .select('lasyncro_barcode').first();
      return current?.lasyncro_barcode ?? null;
    } catch (err) {
      if ((err as { code?: string })?.code !== '23505') throw err;
      console.warn('[PRODUCT_BARCODE_COLLISION]', { shopId, lasyncroVariantId, attempt });
    }
  }
  throw new Error('PRODUCT_BARCODE_MINT_EXHAUSTED');
}