import type { Knex } from 'knex';

const BARCODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const MAX_MINT_ATTEMPTS = 5;

function generateProductBarcode(): string {
  let code = 'LSP-';
  for (let i = 0; i < 8; i++) {
    code += BARCODE_ALPHABET[Math.floor(Math.random() * BARCODE_ALPHABET.length)];
  }
  return code;
}

function isUniqueViolation(err: unknown): boolean {
  return (err as { code?: string })?.code === '23505';
}

export async function backfillMissingProductBarcodeIdentity(
  knex: Knex
): Promise<number> {
  const rows = await knex('variants')
    .whereNull('lasyncro_barcode')
    .select('shop_id', 'lasyncro_variant_id')
    .orderBy('shop_id', 'asc')
    .orderBy('lasyncro_variant_id', 'asc');

  let repaired = 0;

  for (const row of rows) {
    let repairedThisVariant = false;

    for (let attempt = 1; attempt <= MAX_MINT_ATTEMPTS; attempt++) {
      const candidate = generateProductBarcode();

      try {
        const updated = await knex.transaction(async (sp): Promise<Array<{ lasyncro_barcode: string }>> => {
          return sp('variants')
            .where({
              shop_id: row.shop_id,
              lasyncro_variant_id: row.lasyncro_variant_id,
            })
            .whereNull('lasyncro_barcode')
            .update({ lasyncro_barcode: candidate })
            .returning('lasyncro_barcode');
        });

        if (updated.length === 1) {
          repaired += 1;
          repairedThisVariant = true;
        } else {
          const current = await knex('variants')
            .where({
              shop_id: row.shop_id,
              lasyncro_variant_id: row.lasyncro_variant_id,
            })
            .select('lasyncro_barcode')
            .first();

          if (current?.lasyncro_barcode) repairedThisVariant = true;
        }

        break;
      } catch (err) {
        if (!isUniqueViolation(err)) throw err;
      }
    }

    if (!repairedThisVariant) {
      throw new Error('PRODUCT_BARCODE_BACKFILL_EXHAUSTED');
    }
  }

  return repaired;
}

export async function up(knex: Knex): Promise<void> {
  await backfillMissingProductBarcodeIdentity(knex);
}

export async function down(_knex: Knex): Promise<void> {
  // Data repair only: this migration cannot distinguish identities minted by
  // the backfill from identities minted legitimately by runtime code. Removing
  // either would invalidate persisted, printed, or scannable product identity.
}
