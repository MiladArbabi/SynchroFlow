// tests/integration/wms/lsu-identity-gh1255.test.ts
//
// GH-1255 LSU-IDENTITY-01 — ratified 2026-10-14.
//
// New units: 'LSU-' + exactly 10 zero-padded decimal digits, issued from one
// global, noncycling PostgreSQL sequence. A committed retry for the same
// (shop, source anchor, receive_sequence) returns the persisted LSU; a
// rolled-back transaction may consume a value (gaps are valid) and never
// guarantees the same number on reissue. Exhaustion, a global collision and a
// mismatched lineage fail closed.
//
// Legacy units: 'LSU-' + 8 hex stay immutable, exactly resolvable and printable.
// Their literal vectors pin the algorithm in production at 6a55db8f
// (inventoryUnit.service.ts generateLsuId: sha256(shop:anchor:seq)[0:8]).
//
// New identities are asserted through the canonical issuance paths
// (batchConfirmUnits, issueReconciledUnits), never through a generator export.
// The sequence is discovered from the catalog (exactly one public sequence
// whose name contains 'lsu'). Privileged sequence fixtures use the migration
// role on the disposable database only.
//
// Runs only under the disposable-DB harness (npm run test:integration).

import crypto from 'crypto';
import zlib from 'zlib';
import knexLib, { Knex } from 'knex';
import { PDFDocument, PDFFont, PDFName, StandardFonts } from 'pdf-lib';
import bwipjs from 'bwip-js';
import request from 'supertest';

import db, {
  withTenant,
  systemTransaction,
  setTenantContext,
  systemQuery,
  runWithTenantContext,
} from '@lasyncro/backend-core/db.js';
import { createApp } from 'api-src/bootstrap/express';
import { seedFreshInstall } from 'api-src/scripts/seed_fresh_install';
import { processDomainEvent } from 'api-src/events/processDomainEvent';
import { issueTestToken } from '../../unit/helpers/auth';
import { createTenantShop } from '@lasyncro/backend-core/services/pre-tenant.service.js';
import {
  batchConfirmUnits,
  issueReconciledUnits,
} from 'api-src/services/wms/inventoryUnit.service';
import { resolveBarcode } from 'api-src/services/wms/barcodeResolution.service';
import { generateUnitLabelPdf } from 'api-src/services/wms/unitLabelPdf.service';
import * as migration0212 from
  '../../../apps/backend/migrations/20261014120000_0212_inventory_unit_lsu_sequence';

jest.setTimeout(60000);

const NEW_LSU = /^LSU-\d{10}$/;
const LEGACY_LSU = /^LSU-[0-9a-f]{8}$/;
const LSU_MAX = '9999999999';
const LSU_COLUMNS = ['inventory_units', 'pack_scan_log', 'pick_scan_log', 'pick_scan_unit_lineage'];
const GLOBAL_UNIQUE = { code: '23505', constraint: 'inventory_units_lasyncro_unit_id_unique' };

/** The legacy algorithm, frozen as a reference for legacy rows. */
const legacyLsu = (shopId: number, anchorId: string, sequence: number) =>
  `LSU-${crypto.createHash('sha256').update(`${shopId}:${anchorId}:${sequence}`).digest('hex').slice(0, 8)}`;
const numericLsu = (value: bigint | number) => `LSU-${String(value).padStart(10, '0')}`;

const ROLLBACK = new Error('GH1255_ROLLBACK');

// ── Privileged fixture access: migration role, disposable database only ──────

let migrationDb: Knex;
beforeAll(() => {
  expect(process.env.PGDATABASE).toMatch(/^synchroflow_test_[A-Za-z0-9_]+$/);
  expect(process.env.PGMIGRATION_USER).toBeTruthy();
  expect(process.env.PGMIGRATION_USER).not.toBe(process.env.PGUSER);
  migrationDb = knexLib({
    client: 'pg',
    connection: {
      host: process.env.PGHOST, port: Number(process.env.PGPORT ?? 5432),
      user: process.env.PGMIGRATION_USER, password: process.env.PGMIGRATION_PASSWORD,
      database: process.env.PGDATABASE,
    },
    pool: { min: 0, max: 2 },
  });
});
afterAll(async () => {
  if (migrationDb) await migrationDb.destroy();
});

type LsuSequence = { name: string; data_type: string; start_value: string; min_value: string; max_value: string; increment_by: string; cycle: boolean };

/** The one global LSU sequence; the test fails here while it does not exist. */
async function lsuSequence(): Promise<LsuSequence> {
  const rows = await migrationDb('pg_sequences')
    .where({ schemaname: 'public' }).whereILike('sequencename', '%lsu%')
    .select('sequencename as name', 'data_type', 'start_value', 'min_value', 'max_value', 'increment_by', 'cycle');
  expect(rows.map((r: any) => r.name)).toHaveLength(1);
  return rows[0] as LsuSequence;
}

/** The value the next nextval() will return, read without consuming one. */
async function nextSequenceValue(name: string): Promise<bigint> {
  const { rows } = await migrationDb.raw(`SELECT last_value, is_called FROM public.${name}`);
  return rows[0].is_called ? BigInt(rows[0].last_value) + 1n : BigInt(rows[0].last_value);
}

// ── Tenant fixtures ──────────────────────────────────────────────────────────

type Fixture = {
  shopId: number;
  variantId: string;
  otherVariantId: string;
  receiveLineA: string;
  receiveLineB: string;
  recountLineId: string;
};

async function createFixture(label: string): Promise<Fixture> {
  const shopId = await systemTransaction(async (trx) => {
    const id = await createTenantShop(trx, `gh1255-${label}-${crypto.randomUUID().slice(0, 8)}`);
    await setTenantContext(trx, id);
    return id;
  });

  return withTenant(shopId, async (trx) => {
    const productId = crypto.randomUUID();
    const variantId = crypto.randomUUID();
    const otherVariantId = crypto.randomUUID();
    const warehouseId = crypto.randomUUID();
    const rootCode = `WH-${shopId}-ROOT`;

    await trx('products').insert({
      lasyncro_product_id: productId, shop_id: shopId, title: 'GH-1255 product',
      status: 'active', product_type: 'physical',
    });
    await trx('variants').insert([variantId, otherVariantId].map((id, i) => ({
      lasyncro_variant_id: id, lasyncro_product_id: productId, shop_id: shopId,
      sku: `G1255-${i}-${crypto.randomUUID().slice(0, 8)}`, title: `GH-1255 variant ${i}`, unit_cost: '1.00', status: 'active',
    })));
    await trx('warehouses').insert({
      warehouse_id: warehouseId, shop_id: shopId, name: 'GH-1255 warehouse',
      root_location_code: rootCode, is_default: true, active: true,
    });
    await trx('warehouse_locations').insert([
      { shop_id: shopId, warehouse_id: warehouseId, location_code: rootCode, type: 'warehouse', parent_location_code: null, active: true, zone_type: null },
      { shop_id: shopId, warehouse_id: warehouseId, location_code: 'A-1', type: 'bin', parent_location_code: rootCode, active: true, zone_type: 'pick' },
    ]);

    // One linked line per variant per job (receive_job_lines_variant_unique):
    // two jobs give two independent Receive anchors for the same variant.
    const [supplier] = await trx('suppliers').insert({ shop_id: shopId, name: `GH-1255 supplier ${crypto.randomUUID()}` }).returning('id');
    const receiveLine = async () => {
      const [po] = await trx('purchase_orders').insert({ shop_id: shopId, supplier_id: supplier.id }).returning('id');
      const [job] = await trx('receive_jobs').insert({ shop_id: shopId, po_id: po.id }).returning('receive_job_id');
      const [line] = await trx('receive_job_lines')
        .insert({ shop_id: shopId, receive_job_id: job.receive_job_id, lasyncro_variant_id: variantId, quantity_expected: 10 })
        .returning('receive_job_line_id');
      return String(line.receive_job_line_id);
    };
    const receiveLineA = await receiveLine();
    const receiveLineB = await receiveLine();

    const [task] = await trx('inventory_recount_tasks')
      .insert({ shop_id: shopId, warehouse_id: warehouseId, label: `RC-G1255-${crypto.randomUUID().slice(0, 8)}`, scope: 'location', status: 'manual_review', blind: true })
      .returning('recount_task_id');
    const [recountLine] = await trx('inventory_recount_lines')
      .insert({ recount_task_id: task.recount_task_id ?? task, shop_id: shopId, lasyncro_variant_id: variantId, location_code: 'A-1', expected_quantity: 0 })
      .returning('recount_line_id');

    return { shopId, variantId, otherVariantId, receiveLineA, receiveLineB, recountLineId: String(recountLine.recount_line_id ?? recountLine) };
  });
}

// createdBy is declared by BatchConfirmInput but not persisted by issuance.
const issueReceive = (trx: any, f: Fixture, receiveJobLineId: string, quantity: number, variantId = f.variantId) =>
  batchConfirmUnits(trx, { shopId: f.shopId, receiveJobLineId, lasyncroVariantId: variantId, quantity, shopifyBarcode: null, createdBy: 0 });

const issueRecount = (trx: any, f: Fixture, quantity: number) =>
  issueReconciledUnits(trx, {
    shopId: f.shopId, recountLineId: f.recountLineId, lasyncroVariantId: f.variantId,
    quantity, currentLocationCode: 'A-1', canonicalizedAt: new Date('2026-10-14T00:00:00.000Z'),
  } as any);

const idsOf = (rows: Array<{ lasyncro_unit_id: string }>) => rows.map((r) => r.lasyncro_unit_id);

const unitsOf = (f: Fixture, anchor: { receive_job_line_id?: string; recount_line_id?: string }) =>
  withTenant(f.shopId, (trx) =>
    trx('inventory_units').where({ shop_id: f.shopId, ...anchor }).orderBy('receive_sequence')
      .select('id', 'lasyncro_unit_id', 'lasyncro_variant_id', 'receive_sequence', 'status', 'source', 'current_location_code'));

/** Inserts a unit row with an explicit identity (legacy fixture or collision probe). */
const insertUnit = (shopId: number, row: Record<string, unknown>) =>
  withTenant(shopId, (trx) => trx('inventory_units').insert({ shop_id: shopId, status: 'received', ...row }));

const legacyReceiveRow = (f: Fixture, line: string, seq: number) => ({
  lasyncro_unit_id: legacyLsu(f.shopId, line, seq), lasyncro_variant_id: f.variantId,
  receive_job_line_id: line, receive_sequence: seq, source: 'lasyncro_receive',
});

/** Decoded content stream of a document's first page. */
async function pageContent(doc: PDFDocument): Promise<string> {
  const contents: any = doc.getPage(0).node.Contents();
  const streams = contents.asArray ? contents.asArray().map((r: any) => doc.context.lookup(r)) : [contents];
  return streams.map((s: any) => {
    const raw = Buffer.from(s.getContents());
    return (s.dict.get(PDFName.of('Filter')) ? zlib.inflateSync(raw) : raw).toString('latin1');
  }).join('\n');
}

/** Text strings drawn on a PDF page (pdf-lib standard-font hex strings). */
async function drawnTexts(pdf: Uint8Array): Promise<string[]> {
  const doc = await PDFDocument.load(pdf);
  const texts: string[] = [];
  for (const page of doc.getPages()) {
    const contents: any = page.node.Contents();
    const streams = contents.asArray ? contents.asArray().map((r: any) => doc.context.lookup(r)) : [contents];
    for (const s of streams) {
      const raw = Buffer.from(s.getContents());
      const text = (s.dict.get(PDFName.of('Filter')) ? zlib.inflateSync(raw) : raw).toString('latin1');
      for (const m of text.matchAll(/<([0-9A-Fa-f]+)> Tj/g)) texts.push(Buffer.from(m[1], 'hex').toString('latin1'));
    }
  }
  return texts;
}

// ── New identity ─────────────────────────────────────────────────────────────

describe('GH-1255 — new LSU identity is sequence-issued LSU- + 10 digits', () => {
  it('R1 — Receive and Recount issuance mint LSU- + 10 zero-padded digits', async () => {
    const f = await createFixture('r1');
    await withTenant(f.shopId, (trx) => issueReceive(trx, f, f.receiveLineA, 3));
    await withTenant(f.shopId, (trx) => issueRecount(trx, f, 2));

    const ids = [...idsOf(await unitsOf(f, { receive_job_line_id: f.receiveLineA })), ...idsOf(await unitsOf(f, { recount_line_id: f.recountLineId }))];
    expect(ids).toHaveLength(5);
    for (const id of ids) {
      expect(id).toMatch(NEW_LSU);
      expect(BigInt(id.slice(4))).toBeGreaterThanOrEqual(1n);
    }
  });

  it('R2 — a committed retry returns the persisted LSU for new and legacy units; a rollback never duplicates a committed unit', async () => {
    const f = await createFixture('r2');
    const first = idsOf(await withTenant(f.shopId, (trx) => issueReceive(trx, f, f.receiveLineA, 2)));
    const firstRecount = idsOf(await withTenant(f.shopId, (trx) => issueRecount(trx, f, 2)));

    // Committed retry: same lineage → the same persisted identities, nothing new.
    expect(idsOf(await withTenant(f.shopId, (trx) => issueReceive(trx, f, f.receiveLineA, 2)))).toEqual(first);
    expect(idsOf(await withTenant(f.shopId, (trx) => issueRecount(trx, f, 2)))).toEqual(firstRecount);
    expect(idsOf(await unitsOf(f, { receive_job_line_id: f.receiveLineA }))).toEqual(first);

    // A committed legacy row is returned by retry, never renamed.
    const legacy = legacyReceiveRow(f, f.receiveLineB, 1);
    await insertUnit(f.shopId, legacy);
    expect(idsOf(await withTenant(f.shopId, (trx) => issueReceive(trx, f, f.receiveLineB, 1)))).toEqual([legacy.lasyncro_unit_id]);

    // A rolled-back issuance may consume a value but never duplicates or alters a committed unit.
    const other = await createFixture('r2-rollback');
    let rolledBack: string[] = [];
    await expect(withTenant(other.shopId, async (trx) => {
      rolledBack = idsOf(await issueReceive(trx, other, other.receiveLineA, 2));
      throw ROLLBACK;
    })).rejects.toBe(ROLLBACK);
    expect(await unitsOf(other, { receive_job_line_id: other.receiveLineA })).toEqual([]);
    const committed = idsOf(await withTenant(other.shopId, (trx) => issueReceive(trx, other, other.receiveLineA, 2)));
    expect(committed).toHaveLength(2);
    expect(committed.filter((id) => first.includes(id) || firstRecount.includes(id))).toEqual([]);
    for (const id of [...first, ...firstRecount, ...committed, ...rolledBack]) expect(id).toMatch(NEW_LSU);
  });

  it('R3 — distinct shop, anchor and sequence lineages receive distinct new identities', async () => {
    const a = await createFixture('r3a');
    const b = await createFixture('r3b');
    const ids: string[] = [];
    for (const f of [a, b]) {
      ids.push(...idsOf(await withTenant(f.shopId, (trx) => issueReceive(trx, f, f.receiveLineA, 2))));
      ids.push(...idsOf(await withTenant(f.shopId, (trx) => issueReceive(trx, f, f.receiveLineB, 2))));
      ids.push(...idsOf(await withTenant(f.shopId, (trx) => issueRecount(trx, f, 2))));
    }
    expect(ids).toHaveLength(12);
    expect(new Set(ids).size).toBe(12);
    for (const id of ids) expect(id).toMatch(NEW_LSU);
  });

  it('R6 — a sequence-issued LSU persists exactly as returned, with its lineage', async () => {
    const f = await createFixture('r6');
    const issued = await withTenant(f.shopId, (trx) => issueReceive(trx, f, f.receiveLineA, 2));
    const persisted = await unitsOf(f, { receive_job_line_id: f.receiveLineA });
    expect(persisted.map((u) => ({ id: u.lasyncro_unit_id, seq: u.receive_sequence, variant: u.lasyncro_variant_id, source: u.source })))
      .toEqual(idsOf(issued).map((id, i) => ({ id, seq: i + 1, variant: f.variantId, source: 'lasyncro_receive' })));
    for (const u of persisted) {
      expect(u.lasyncro_unit_id).toMatch(NEW_LSU);
      expect(u.lasyncro_unit_id).toHaveLength(14);
    }
  });
});

// ── Legacy identity (controls) ───────────────────────────────────────────────

describe('GH-1255 — legacy LSU identities stay valid and immutable', () => {
  it('R4 — legacy vectors of the 6a55db8f algorithm are unchanged', () => {
    const anchor = '00000000-0000-4000-8000-0000000012a5';
    expect(legacyLsu(1, anchor, 1)).toBe('LSU-be222045');
    expect(legacyLsu(1, anchor, 2)).toBe('LSU-09d99ec7');
    expect(legacyLsu(2, anchor, 1)).toBe('LSU-22bdc6c4');
  });

  it('R5 — legacy Receive and Recount rows keep their identity through issuance retry and recount replay', async () => {
    const f = await createFixture('r5');
    const legacyReceive = [1, 2].map((seq) => legacyLsu(f.shopId, f.receiveLineA, seq));
    const legacyRecount = [1, 2].map((seq) => legacyLsu(f.shopId, f.recountLineId, seq));
    for (const seq of [1, 2]) await insertUnit(f.shopId, legacyReceiveRow(f, f.receiveLineA, seq));
    for (const [i, id] of legacyRecount.entries()) {
      await insertUnit(f.shopId, {
        lasyncro_unit_id: id, lasyncro_variant_id: f.variantId, recount_line_id: f.recountLineId, receive_sequence: i + 1,
        source: 'opening_inventory_reconcile', status: 'stowed', current_location_code: 'A-1',
        received_at: new Date('2026-10-14T00:00:00.000Z'),
      });
    }
    const before = { receive: await unitsOf(f, { receive_job_line_id: f.receiveLineA }), recount: await unitsOf(f, { recount_line_id: f.recountLineId }) };

    await withTenant(f.shopId, (trx) => issueReceive(trx, f, f.receiveLineA, 2));
    const replay = await withTenant(f.shopId, (trx) => issueRecount(trx, f, 2));

    expect(replay.map((u: any) => u.lasyncro_unit_id)).toEqual(legacyRecount);
    expect(await unitsOf(f, { receive_job_line_id: f.receiveLineA })).toEqual(before.receive);
    expect(await unitsOf(f, { recount_line_id: f.recountLineId })).toEqual(before.recount);
    for (const id of [...legacyReceive, ...legacyRecount]) expect(id).toMatch(LEGACY_LSU);
  });

  it('R7 — the same canonical unit can never gain a second identity on retry', async () => {
    const f = await createFixture('r7');
    await withTenant(f.shopId, (trx) => issueReceive(trx, f, f.receiveLineA, 2));
    const first = await unitsOf(f, { receive_job_line_id: f.receiveLineA });
    await withTenant(f.shopId, (trx) => issueReceive(trx, f, f.receiveLineA, 2));
    expect(await unitsOf(f, { receive_job_line_id: f.receiveLineA })).toEqual(first);

    await expect(insertUnit(f.shopId, {
      lasyncro_unit_id: legacyLsu(f.shopId, crypto.randomUUID(), 1), lasyncro_variant_id: f.variantId,
      receive_job_line_id: f.receiveLineA, receive_sequence: 1, source: 'lasyncro_receive',
    })).rejects.toMatchObject({ code: '23505', constraint: 'inventory_units_receive_unique' });
  });

  it('R10 — a legacy LSU still resolves through the canonical unit-barcode lookup', async () => {
    const f = await createFixture('r10');
    const legacy = legacyReceiveRow(f, f.receiveLineA, 1);
    await insertUnit(f.shopId, legacy);
    const result = await withTenant(f.shopId, (trx) => resolveBarcode(trx, f.shopId, legacy.lasyncro_unit_id));
    expect(result).toMatchObject({ resolution_method: 'unit_barcode', lasyncro_unit_id: legacy.lasyncro_unit_id, lasyncro_variant_id: f.variantId, unit_status: 'received' });
  });

  it('R11b — label geometry: whole 203-dpi dots (>= 2) per module, >= 10X quiet zones, readable height, nothing clipped', async () => {
    const LABEL_W = 141.73, LABEL_H = 70.87, DOT_PT = 72 / 203;
    const metrics = await PDFDocument.create();
    const fonts: Record<string, PDFFont> = {
      Courier: await metrics.embedFont(StandardFonts.Courier),
      'Helvetica-Bold': await metrics.embedFont(StandardFonts.HelveticaBold),
    };
    for (const id of ['LSU-be222045', 'LSU-0000000001', 'LSU-12345678']) {
      const modules = (await bwipjs.toBuffer({ bcid: 'code128', text: id, scale: 1, height: 10, includetext: false, paddingwidth: 0, paddingheight: 0 })).readUInt32BE(16);
      const pdf = await generateUnitLabelPdf([{ lasyncro_unit_id: id, sku: 'G1255-SKU', variant_title: 'GH-1255 variant with a long descriptive title' }] as any);
      const doc = await PDFDocument.load(pdf);
      const content = await pageContent(doc);

      // Barcode placement: translation then scale before the image Do.
      const ops = [...content.slice(0, content.indexOf(' Do')).matchAll(/([\d.-]+) 0 0 ([\d.-]+) ([\d.-]+) ([\d.-]+) cm/g)].map((m) => m.slice(1).map(Number));
      const scale = ops.filter(([a]) => a !== 1).pop()!;
      const origin = ops.filter(([a]) => a === 1).reduce((acc, [, , x, y]) => [acc[0] + x, acc[1] + y], [0, 0]);
      const [barW, barH] = scale;
      const [barX, barY] = origin;
      let imagePx = 0;
      doc.context.enumerateIndirectObjects().forEach(([, o]: any) => {
        if (o.dict?.get(PDFName.of('Subtype'))?.toString() === '/Image') imagePx = Number(o.dict.get(PDFName.of('Width')).toString());
      });

      const dots = imagePx / modules;
      const moduleW = barW / modules;
      expect({ id, wholeDots: Number.isInteger(dots), atLeast2: dots >= 2 }).toEqual({ id, wholeDots: true, atLeast2: true });
      expect(Math.abs(moduleW - dots * DOT_PT)).toBeLessThan(1e-6);
      expect({ id, left: barX >= 10 * moduleW, right: LABEL_W - (barX + barW) >= 10 * moduleW }).toEqual({ id, left: true, right: true });
      expect({ id, heightMm: barH * 25.4 / 72 >= 6.35, inside: barY >= 0 && barY + barH <= LABEL_H }).toEqual({ id, heightMm: true, inside: true });

      // Every drawn text run sits fully inside the page; the full id is among them.
      const runs = [...content.matchAll(/\/(Courier|Helvetica-Bold)-\d+ ([\d.]+) Tf[\s\S]*?1 0 0 1 ([\d.-]+) ([\d.-]+) Tm\s*<([0-9A-Fa-f]+)> Tj/g)]
        .map(([, font, size, x, y, hex]) => ({ font, size: Number(size), x: Number(x), y: Number(y), text: Buffer.from(hex, 'hex').toString('latin1') }));
      expect(runs.map((r) => r.text)).toContain(id);
      for (const r of runs) {
        const width = fonts[r.font].widthOfTextAtSize(r.text, r.size);
        expect({ text: r.text, inside: r.x >= 0 && r.x + width <= LABEL_W && r.y >= 0 && r.y + r.size <= LABEL_H }).toEqual({ text: r.text, inside: true });
      }
    }
  });

  it('R11 — the unit label carries the exact full identity for legacy and new LSUs', async () => {
    const ids = ['LSU-be222045', 'LSU-0000000001'];
    const pdf = await generateUnitLabelPdf(ids.map((id) => ({ lasyncro_unit_id: id, sku: 'G1255-SKU', variant_title: 'GH-1255 variant' })) as any);
    expect((await PDFDocument.load(pdf)).getPageCount()).toBe(2);
    const texts = await drawnTexts(pdf);
    for (const id of ids) expect(texts).toContain(id);
  });
});

// ── Uniqueness, concurrency, resolution ──────────────────────────────────────

describe('GH-1255 — uniqueness, concurrency and exact resolution', () => {
  it('R8 — global uniqueness holds across tenants for legacy and numeric identities', async () => {
    const a = await createFixture('r8a');
    const b = await createFixture('r8b');
    const legacy = legacyReceiveRow(a, a.receiveLineA, 1);
    await insertUnit(a.shopId, legacy);
    await expect(insertUnit(b.shopId, { ...legacyReceiveRow(b, b.receiveLineA, 1), lasyncro_unit_id: legacy.lasyncro_unit_id }))
      .rejects.toMatchObject(GLOBAL_UNIQUE);

    const [issued] = idsOf(await withTenant(a.shopId, (trx) => issueReceive(trx, a, a.receiveLineB, 1)));
    expect(issued).toMatch(NEW_LSU);
    await expect(insertUnit(b.shopId, { ...legacyReceiveRow(b, b.receiveLineB, 1), lasyncro_unit_id: issued }))
      .rejects.toMatchObject(GLOBAL_UNIQUE);
  });

  it('R8 — concurrent issuance: one lineage resolves to one persisted set; distinct lineages never share an identity', async () => {
    const f = await createFixture('r8-concurrent');
    const g = await createFixture('r8-concurrent-other');

    const sameLineage = await Promise.all(
      Array.from({ length: 4 }, () => withTenant(f.shopId, (trx) => issueReceive(trx, f, f.receiveLineA, 3)))
    );
    const persisted = idsOf(await unitsOf(f, { receive_job_line_id: f.receiveLineA }));
    expect(persisted).toHaveLength(3);
    for (const result of sameLineage) expect(idsOf(result)).toEqual(persisted);

    const distinct = await Promise.all([
      withTenant(f.shopId, (trx) => issueReceive(trx, f, f.receiveLineB, 3)),
      withTenant(g.shopId, (trx) => issueReceive(trx, g, g.receiveLineA, 3)),
      withTenant(g.shopId, (trx) => issueReceive(trx, g, g.receiveLineB, 3)),
      withTenant(f.shopId, (trx) => issueRecount(trx, f, 3)),
    ]);
    const all = [...persisted, ...distinct.flatMap(idsOf)];
    expect(all).toHaveLength(15);
    expect(new Set(all).size).toBe(15);
    for (const id of all) expect(id).toMatch(NEW_LSU);
  });

  it('R8 — a global identity collision at the next sequence value fails issuance closed instead of being swallowed', async () => {
    const owner = await createFixture('r8c-owner');
    const victim = await createFixture('r8c-victim');
    const seq = await lsuSequence();
    const next = await nextSequenceValue(seq.name);

    // Another tenant's unrelated unit already holds the identity the sequence will issue next.
    await insertUnit(owner.shopId, { ...legacyReceiveRow(owner, owner.receiveLineA, 9), lasyncro_unit_id: numericLsu(next) });

    await expect(withTenant(victim.shopId, (trx) => issueReceive(trx, victim, victim.receiveLineA, 1)))
      .rejects.toMatchObject(GLOBAL_UNIQUE);
    expect(await unitsOf(victim, { receive_job_line_id: victim.receiveLineA })).toEqual([]);
  });

  it('R9 — new numeric and legacy identities resolve exactly, never by prefix, and only inside their tenant', async () => {
    const f = await createFixture('r9');
    const other = await createFixture('r9-other');
    const [issued] = idsOf(await withTenant(f.shopId, (trx) => issueReceive(trx, f, f.receiveLineA, 1)));
    expect(issued).toMatch(NEW_LSU);

    // Disjoint by length even when legacy hex is all digits.
    const legacyDigits = 'LSU-12345678';
    const numericDigits = 'LSU-0012345678';
    await insertUnit(f.shopId, { ...legacyReceiveRow(f, f.receiveLineB, 1), lasyncro_unit_id: legacyDigits, status: 'stowed', current_location_code: 'A-1' });
    await insertUnit(other.shopId, { ...legacyReceiveRow(other, other.receiveLineA, 1), lasyncro_unit_id: numericDigits });

    expect(await withTenant(f.shopId, (trx) => resolveBarcode(trx, f.shopId, issued)))
      .toMatchObject({ resolution_method: 'unit_barcode', lasyncro_unit_id: issued, lasyncro_variant_id: f.variantId });
    expect(await withTenant(f.shopId, (trx) => resolveBarcode(trx, f.shopId, legacyDigits)))
      .toMatchObject({ resolution_method: 'unit_barcode', lasyncro_unit_id: legacyDigits, unit_status: 'stowed' });
    expect(await withTenant(other.shopId, (trx) => resolveBarcode(trx, other.shopId, numericDigits)))
      .toMatchObject({ resolution_method: 'unit_barcode', lasyncro_unit_id: numericDigits });
    // An identifier is not authorization: another tenant cannot resolve it.
    expect(await withTenant(f.shopId, (trx) => resolveBarcode(trx, f.shopId, numericDigits))).toBeNull();
    expect(await withTenant(other.shopId, (trx) => resolveBarcode(trx, other.shopId, issued))).toBeNull();
  });
});

// ── Lineage refusal ──────────────────────────────────────────────────────────

describe('GH-1255 — issuance refuses a lineage it does not own', () => {
  it('R13 — a variant that is not the source line\'s variant is refused, first time and on retry, with no unit written', async () => {
    const f = await createFixture('r13-variant');
    await expect(withTenant(f.shopId, (trx) => issueReceive(trx, f, f.receiveLineA, 1, f.otherVariantId))).rejects.toThrow();
    expect(await unitsOf(f, { receive_job_line_id: f.receiveLineA })).toEqual([]);

    const committed = await withTenant(f.shopId, (trx) => issueReceive(trx, f, f.receiveLineB, 2));
    await expect(withTenant(f.shopId, (trx) => issueReceive(trx, f, f.receiveLineB, 2, f.otherVariantId))).rejects.toThrow();
    expect(idsOf(await unitsOf(f, { receive_job_line_id: f.receiveLineB }))).toEqual(idsOf(committed));
  });

  it('R13 — a source line owned by another shop is refused, with no unit written for either shop', async () => {
    const owner = await createFixture('r13-owner');
    const intruder = await createFixture('r13-intruder');
    await expect(withTenant(intruder.shopId, (trx) =>
      batchConfirmUnits(trx, { shopId: intruder.shopId, receiveJobLineId: owner.receiveLineA, lasyncroVariantId: intruder.variantId, quantity: 1, shopifyBarcode: null, createdBy: 0 })
    )).rejects.toThrow();
    // Counted inside each tenant (RLS is forced): a leaked row would carry either shop id.
    for (const shopId of [owner.shopId, intruder.shopId]) {
      const leaked = await withTenant(shopId, (trx) => trx('inventory_units').where({ shop_id: shopId, receive_job_line_id: owner.receiveLineA }).count<{ count: string }>('* as count').first());
      expect({ shopId, units: Number(leaked?.count ?? 0) }).toEqual({ shopId, units: 0 });
    }
  });
});

// ── Schema and sequence authority ────────────────────────────────────────────

describe('GH-1255 — schema compatibility and sequence authority', () => {
  it('R12 — LSU columns stay varchar(20)-compatible; uniqueness, lineage FK and forced RLS are preserved', async () => {
    const widths = await migrationDb('information_schema.columns')
      .where({ table_schema: 'public', column_name: 'lasyncro_unit_id' }).whereIn('table_name', LSU_COLUMNS)
      .orderBy('table_name').select('table_name', 'data_type', 'character_maximum_length');
    expect(widths.map((w: any) => ({ table: w.table_name, type: w.data_type, fits14: Number(w.character_maximum_length) >= 14 })))
      .toEqual([...LSU_COLUMNS].sort().map((table) => ({ table, type: 'character varying', fits14: true })));

    const constraints = await migrationDb.raw(`
      SELECT conname, pg_get_constraintdef(oid) AS def FROM pg_constraint
       WHERE conname IN ('inventory_units_lasyncro_unit_id_unique', 'inventory_units_shop_unit_unique',
                         'inventory_units_receive_unique', 'inventory_units_recount_unique')
          OR (conrelid = 'pick_scan_unit_lineage'::regclass AND contype = 'f' AND confrelid = 'inventory_units'::regclass)
       ORDER BY conname`);
    expect(Object.fromEntries(constraints.rows.map((r: any) => [r.conname.startsWith('inventory_units') ? r.conname : 'pick_scan_unit_lineage_fk', r.def]))).toEqual({
      inventory_units_lasyncro_unit_id_unique: 'UNIQUE (lasyncro_unit_id)',
      inventory_units_receive_unique: 'UNIQUE (shop_id, receive_job_line_id, receive_sequence)',
      inventory_units_recount_unique: 'UNIQUE (shop_id, recount_line_id, receive_sequence)',
      inventory_units_shop_unit_unique: 'UNIQUE (shop_id, lasyncro_unit_id)',
      pick_scan_unit_lineage_fk: 'FOREIGN KEY (shop_id, lasyncro_unit_id) REFERENCES inventory_units(shop_id, lasyncro_unit_id) ON DELETE RESTRICT',
    });
    const rls = await migrationDb('pg_class').where({ relname: 'inventory_units' }).first('relrowsecurity', 'relforcerowsecurity');
    expect(rls).toEqual({ relrowsecurity: true, relforcerowsecurity: true });
  });

  it('R12 — one global noncycling LSU sequence bounded to 10 digits; sf_app holds USAGE only (may issue, never read or rewind)', async () => {
    const seq = await lsuSequence();
    expect({ start: String(seq.start_value), min: String(seq.min_value), max: String(seq.max_value), increment: String(seq.increment_by), cycle: seq.cycle })
      .toEqual({ start: '1', min: '1', max: LSU_MAX, increment: '1', cycle: false });
    const { rows } = await migrationDb.raw(
      `SELECT has_sequence_privilege(?, ?, 'USAGE') AS usage, has_sequence_privilege(?, ?, 'SELECT') AS select,
              has_sequence_privilege(?, ?, 'UPDATE') AS update`,
      [process.env.PGUSER, `public.${seq.name}`, process.env.PGUSER, `public.${seq.name}`, process.env.PGUSER, `public.${seq.name}`]
    );
    expect(rows[0]).toEqual({ usage: true, select: false, update: false });
  });

  it('R12 — migration 0212 cannot be rolled back once sequence-issued identities exist', async () => {
    const f = await createFixture('r12-down');
    const [issued] = idsOf(await withTenant(f.shopId, (trx) => issueReceive(trx, f, f.receiveLineA, 1)));
    expect(issued).toMatch(NEW_LSU);

    const sentinel = new Error('GH1255_MIGRATION_ROLLBACK');
    let downResult: unknown;
    await expect(migrationDb.transaction(async (trx) => {
      downResult = await trx.transaction((sp) => migration0212.down(sp)).then(() => 'dropped', (e: Error) => e.message);
      throw sentinel;
    })).rejects.toBe(sentinel);
    expect(downResult).toMatch(/INVENTORY_UNIT_LSU_SEQUENCE_ROLLBACK_BLOCKED/);
    expect((await lsuSequence()).name).toBe('inventory_unit_lsu_seq');
  });

  it('R12 — sequence exhaustion fails issuance closed with no unit written', async () => {
    const f = await createFixture('r12-exhaust');
    const seq = await lsuSequence();
    const restoreTo = await nextSequenceValue(seq.name);
    // setval is non-transactional: restore in finally so later tests are unaffected.
    await migrationDb.raw(`SELECT setval('public.${seq.name}', ${LSU_MAX}, true)`);
    try {
      let refusal: any;
      await withTenant(f.shopId, (trx) => issueReceive(trx, f, f.receiveLineA, 1)).catch((e) => { refusal = e; });
      expect(refusal).toBeDefined();
      expect(refusal.code === '2200H' || /exhaust/i.test(String(refusal.message))).toBe(true);
      expect(await unitsOf(f, { receive_job_line_id: f.receiveLineA })).toEqual([]);
    } finally {
      await migrationDb.raw(`SELECT setval('public.${seq.name}', ${restoreTo.toString()}, false)`);
    }
  });
});

// ── Receive replay, quantity and concurrency closure ─────────────────────────

/** Polls until the predicate holds or the deadline passes. */
async function pollUntil(predicate: () => Promise<boolean> | boolean, timeoutMs = 10000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) return true;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  return false;
}

const backendPid = async (trx: Knex.Transaction) =>
  Number((await trx.raw('SELECT pg_backend_pid() AS pid')).rows[0].pid);

/**
 * Two issuers for one lineage with observed overlap: the first issues and holds
 * its transaction open; the second starts and must be seen blocked by the
 * first's backend (pg_blocking_pids) before the first is allowed to commit.
 */
async function overlappedIssuance(shopId: number, issue: (trx: Knex.Transaction) => Promise<any[]>) {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  let firstPid = 0;
  let secondPid = 0;
  let firstIssued = false;
  let blockedBy: number[] = [];

  const first = withTenant(shopId, async (trx) => {
    firstPid = await backendPid(trx);
    const rows = await issue(trx);
    firstIssued = true;
    await gate;
    return rows;
  });
  let second: Promise<any[]> | undefined;
  let overlapped = false;
  try {
    if (await pollUntil(() => firstIssued)) {
      second = withTenant(shopId, async (trx) => {
        secondPid = await backendPid(trx);
        return issue(trx);
      });
      overlapped = await pollUntil(async () => {
        if (!secondPid) return false;
        const { rows } = await migrationDb.raw('SELECT pg_blocking_pids(?) AS pids', [secondPid]);
        blockedBy = (rows[0].pids ?? []).map(Number);
        return blockedBy.includes(firstPid);
      });
    }
  } finally {
    release();
  }
  const settled = await Promise.allSettled([first, second ?? Promise.reject(new Error('second issuer never started'))]);
  return { overlapped, firstPid, secondPid, blockedBy, settled };
}

describe('GH-1255 — Receive replay identity, quantity and concurrency closure', () => {
  it('R14 — Receive replay refuses a legacy-shaped identity that is not its own lineage derivation, with no write', async () => {
    const f = await createFixture('r14');
    const seq = await lsuSequence();
    // Line A sequence 1 carries line B's derivation; line B sequence 1 carries its own sequence-2 derivation.
    await insertUnit(f.shopId, { ...legacyReceiveRow(f, f.receiveLineA, 1), lasyncro_unit_id: legacyLsu(f.shopId, f.receiveLineB, 1) });
    await insertUnit(f.shopId, { ...legacyReceiveRow(f, f.receiveLineB, 1), lasyncro_unit_id: legacyLsu(f.shopId, f.receiveLineB, 2) });
    const before = [await unitsOf(f, { receive_job_line_id: f.receiveLineA }), await unitsOf(f, { receive_job_line_id: f.receiveLineB })];
    const nextBefore = await nextSequenceValue(seq.name);

    for (const line of [f.receiveLineA, f.receiveLineB]) {
      await expect(withTenant(f.shopId, (trx) => issueReceive(trx, f, line, 1)))
        .rejects.toThrow(/INVENTORY_UNIT_RECEIVE_ISSUANCE_INVARIANT/);
    }

    expect([await unitsOf(f, { receive_job_line_id: f.receiveLineA }), await unitsOf(f, { receive_job_line_id: f.receiveLineB })]).toEqual(before);
    expect(await nextSequenceValue(seq.name)).toBe(nextBefore);
  });

  it('R15 — compatibility: a historical reviewer-seed Receive identity (LSU-<6HEX>-<n>) is returned unchanged on replay', async () => {
    const f = await createFixture('r15');
    const seq = await lsuSequence();
    // Shape written by apps/backend/src/scripts/seed_reviewer_activity.ts since b49ff983 (applied to prod shop 1).
    const run = crypto.randomBytes(3).toString('hex').toUpperCase();
    const seeded = [1, 2].map((n) => `LSU-${run}-${n}`);
    for (const [i, id] of seeded.entries()) {
      await insertUnit(f.shopId, { ...legacyReceiveRow(f, f.receiveLineA, i + 1), lasyncro_unit_id: id });
    }
    const before = await unitsOf(f, { receive_job_line_id: f.receiveLineA });
    const nextBefore = await nextSequenceValue(seq.name);

    expect(idsOf(await withTenant(f.shopId, (trx) => issueReceive(trx, f, f.receiveLineA, 2)))).toEqual(seeded);
    expect(await unitsOf(f, { receive_job_line_id: f.receiveLineA })).toEqual(before);
    expect(await nextSequenceValue(seq.name)).toBe(nextBefore);
  });

  it('R16 — a committed Receive retry returns exactly the same identities and writes or consumes nothing', async () => {
    const f = await createFixture('r16');
    const seq = await lsuSequence();
    const issued = idsOf(await withTenant(f.shopId, (trx) => issueReceive(trx, f, f.receiveLineA, 3)));
    const before = await unitsOf(f, { receive_job_line_id: f.receiveLineA });
    const nextBefore = await nextSequenceValue(seq.name);

    for (let attempt = 0; attempt < 2; attempt += 1) {
      expect(idsOf(await withTenant(f.shopId, (trx) => issueReceive(trx, f, f.receiveLineA, 3)))).toEqual(issued);
    }

    expect(idsOf(before)).toEqual(issued);
    expect(await unitsOf(f, { receive_job_line_id: f.receiveLineA })).toEqual(before);
    expect(await nextSequenceValue(seq.name)).toBe(nextBefore);
  });

  it('R17 — a Receive retry with a changed quantity is refused, larger or smaller, with no write', async () => {
    const f = await createFixture('r17');
    const seq = await lsuSequence();
    await withTenant(f.shopId, (trx) => issueReceive(trx, f, f.receiveLineA, 2));
    const before = await unitsOf(f, { receive_job_line_id: f.receiveLineA });
    const nextBefore = await nextSequenceValue(seq.name);

    for (const quantity of [3, 1]) {
      await expect(withTenant(f.shopId, (trx) => issueReceive(trx, f, f.receiveLineA, quantity)))
        .rejects.toThrow(/INVENTORY_UNIT_RECEIVE_ISSUANCE_MISMATCH/);
    }

    expect(await unitsOf(f, { receive_job_line_id: f.receiveLineA })).toEqual(before);
    expect(await nextSequenceValue(seq.name)).toBe(nextBefore);
  });

  it('R18 — a Receive retry over a foreign source provenance or a broken sequence is refused, with no write', async () => {
    const f = await createFixture('r18');
    const seq = await lsuSequence();
    await insertUnit(f.shopId, { ...legacyReceiveRow(f, f.receiveLineA, 1), source: 'manual_entry' });
    for (const n of [1, 3]) await insertUnit(f.shopId, legacyReceiveRow(f, f.receiveLineB, n));
    const before = [await unitsOf(f, { receive_job_line_id: f.receiveLineA }), await unitsOf(f, { receive_job_line_id: f.receiveLineB })];
    const nextBefore = await nextSequenceValue(seq.name);

    await expect(withTenant(f.shopId, (trx) => issueReceive(trx, f, f.receiveLineA, 1)))
      .rejects.toThrow(/INVENTORY_UNIT_RECEIVE_ISSUANCE_INVARIANT/);
    await expect(withTenant(f.shopId, (trx) => issueReceive(trx, f, f.receiveLineB, 2)))
      .rejects.toThrow(/INVENTORY_UNIT_RECEIVE_ISSUANCE_INVARIANT/);

    expect([await unitsOf(f, { receive_job_line_id: f.receiveLineA }), await unitsOf(f, { receive_job_line_id: f.receiveLineB })]).toEqual(before);
    expect(await nextSequenceValue(seq.name)).toBe(nextBefore);
  });

  it('R19 — overlapping same-line Receive issuers (blocking observed) resolve to one persisted identity set', async () => {
    const f = await createFixture('r19');
    const run = await overlappedIssuance(f.shopId, (trx) => issueReceive(trx, f, f.receiveLineA, 3));

    expect({ overlapped: run.overlapped, blockedByFirst: run.blockedBy.includes(run.firstPid), distinctBackends: run.firstPid !== run.secondPid })
      .toEqual({ overlapped: true, blockedByFirst: true, distinctBackends: true });
    expect(run.settled.map((s) => s.status)).toEqual(['fulfilled', 'fulfilled']);
    const [first, second] = run.settled.map((s) => idsOf((s as PromiseFulfilledResult<any[]>).value));
    const persisted = idsOf(await unitsOf(f, { receive_job_line_id: f.receiveLineA }));
    expect(persisted).toHaveLength(3);
    expect(first).toEqual(persisted);
    expect(second).toEqual(persisted);
    for (const id of persisted) expect(id).toMatch(NEW_LSU);
  });

  it('R20 — overlapping same-line Recount issuers (blocking observed) resolve to one persisted identity set', async () => {
    const f = await createFixture('r20');
    const run = await overlappedIssuance(f.shopId, (trx) => issueRecount(trx, f, 3));

    expect({ overlapped: run.overlapped, blockedByFirst: run.blockedBy.includes(run.firstPid), distinctBackends: run.firstPid !== run.secondPid })
      .toEqual({ overlapped: true, blockedByFirst: true, distinctBackends: true });
    expect(run.settled.map((s) => s.status)).toEqual(['fulfilled', 'fulfilled']);
    const [first, second] = run.settled.map((s) => idsOf((s as PromiseFulfilledResult<any[]>).value));
    const persisted = idsOf(await unitsOf(f, { recount_line_id: f.recountLineId }));
    expect(persisted).toHaveLength(3);
    expect(first).toEqual(persisted);
    expect(second).toEqual(persisted);
    for (const id of persisted) expect(id).toMatch(NEW_LSU);
  });
});

// ── HTTP conflict contract ───────────────────────────────────────────────────

describe('GH-1255 — a known issuance conflict is an HTTP 409, never a 500', () => {
  const app = createApp();

  beforeAll(() => {
    process.env.SHOPIFY_API_SECRET = process.env.SHOPIFY_API_SECRET || 'test_shopify_secret';
    process.env.SHOPIFY_API_KEY = process.env.SHOPIFY_API_KEY || 'test_shopify_key';
    process.env.API_URL = process.env.API_URL || 'https://api.test';
    process.env.JWT_SECRET = process.env.JWT_SECRET || 'test_jwt_secret';
  });

  async function pumpEvents(shopId: number, afterId = 0): Promise<number> {
    const rows = await withTenant(shopId, (trx) =>
      trx('domain_events').where({ shop_id: shopId }).andWhere('id', '>', afterId).orderBy('id', 'asc').select('id'));
    for (const row of rows) await runWithTenantContext(shopId, () => processDomainEvent(row.id));
    return rows.length > 0 ? Number(rows[rows.length - 1].id) : afterId;
  }

  /** FT2 shop with a Receive-capable operator, provisioned through the real install path. */
  async function provisionShop() {
    const shopDomain = `g1255-http-${crypto.randomBytes(4).toString('hex')}.myshopify.com`;
    const params = { shop: shopDomain, timestamp: String(Math.floor(Date.now() / 1000)) };
    const message = Object.keys(params).sort().map((k) => `${k}=${params[k as keyof typeof params]}`).join('&');
    const hmac = crypto.createHmac('sha256', process.env.SHOPIFY_API_SECRET!).update(message).digest('hex');
    const install = await request(app).get('/api/v1/integrations/shopify/install').query({ ...params, hmac }).redirects(0);
    expect(install.status).toBe(302);
    const lookup = await systemQuery(db.raw('SELECT public.resolve_auth_user_by_email(?) AS value', [`shopify-install+${shopDomain}@lasyncro.internal`]));
    const { shop_id: shopId, id: userId } = lookup.rows[0].value;
    await seedFreshInstall(shopId);
    await withTenant(shopId, (trx) => trx('integrations').insert({ shop_id: shopId, platform: 'shopify', platform_shop_name: shopDomain, sync_status: 'COMPLETED', updated_at: new Date() }));
    let cursor = 0;
    for (let i = 0; i < 3; i += 1) cursor = await pumpEvents(shopId, cursor);
    const token = issueTestToken({ userId, shopId, tier: 'scale' });
    const ft2 = await request(app).post('/api/v1/lifecycle/ft2/confirm').set('Authorization', `Bearer ${token}`).send({});
    expect(ft2.status).toBe(200);
    await pumpEvents(shopId);
    return { shopId: Number(shopId), userId: Number(userId), token };
  }

  it('R21 — inspecting 40 on a seeded line holding 4 persisted LSUs is a 409 conflict with zero mutation', async () => {
    const shop = await provisionShop();
    const auth = { Authorization: `Bearer ${shop.token}` };
    const run = crypto.randomBytes(3).toString('hex').toUpperCase();
    const seeded = [1, 2, 3, 4].map((n) => `LSU-${run}-${n}`);

    // Historical reviewer-seed shape (seed_reviewer_activity.ts): legacy v1 job in
    // progress with prefilled counters, a fictional prior PO receipt and 4 units.
    const f = await withTenant(shop.shopId, async (trx) => {
      const productId = crypto.randomUUID();
      const variantId = crypto.randomUUID();
      await trx('products').insert({ lasyncro_product_id: productId, shop_id: shop.shopId, title: 'GH-1255 HTTP product', status: 'active', product_type: 'physical' });
      await trx('variants').insert({ lasyncro_variant_id: variantId, lasyncro_product_id: productId, shop_id: shop.shopId, sku: `G1255-H-${run}`, title: 'GH-1255 HTTP variant', unit_cost: '1.00', status: 'active' });
      const [supplier] = await trx('suppliers').insert({ shop_id: shop.shopId, name: `GH-1255 seed supplier ${run}` }).returning('id');
      const [po] = await trx('purchase_orders').insert({ shop_id: shop.shopId, supplier_id: supplier.id, status: 'partially_received' }).returning('id');
      const [poLine] = await trx('purchase_order_line_items').insert({ po_id: po.id, shop_id: shop.shopId, lasyncro_variant_id: variantId, description: 'seed line', quantity_ordered: 40, quantity_received: 24, unit_cost_cents: 850 }).returning('id');
      const [job] = await trx('receive_jobs').insert({
        shop_id: shop.shopId, po_id: po.id, status: 'in_progress', assigned_operator_id: shop.userId,
        total_variants: 1, total_units: 40, units_inspected: 20, units_accepted: 20, units_rejected: 0,
      }).returning('receive_job_id');
      const [line] = await trx('receive_job_lines').insert({
        shop_id: shop.shopId, receive_job_id: job.receive_job_id, po_line_item_id: poLine.id, lasyncro_variant_id: variantId,
        quantity_expected: 40, quantity_accepted: 20, quantity_rejected: 0, inspection_complete: false,
      }).returning('receive_job_line_id');
      for (const [i, id] of seeded.entries()) {
        await trx('inventory_units').insert({
          lasyncro_unit_id: id, shop_id: shop.shopId, lasyncro_variant_id: variantId, receive_job_line_id: line.receive_job_line_id,
          receive_sequence: i + 1, source: 'lasyncro_receive', status: 'received', current_location_code: `WH-${shop.shopId}-ROOT`,
        });
      }
      return { variantId, poId: po.id as string, poLineId: poLine.id as string, jobId: job.receive_job_id as string, lineId: line.receive_job_line_id as string };
    });

    const snapshot = () => withTenant(shop.shopId, async (trx) => ({
      job: await trx('receive_jobs').where({ shop_id: shop.shopId, receive_job_id: f.jobId }).first('status', 'units_inspected', 'units_accepted', 'units_rejected'),
      line: await trx('receive_job_lines').where({ shop_id: shop.shopId, receive_job_line_id: f.lineId }).first('quantity_accepted', 'quantity_rejected', 'inspection_complete', 'inspection_device_event_id', 'quantity_count_confirmed'),
      po: await trx('purchase_orders').where({ shop_id: shop.shopId, id: f.poId }).first('status'),
      poLine: await trx('purchase_order_line_items').where({ shop_id: shop.shopId, id: f.poLineId }).first('quantity_received'),
      units: await trx('inventory_units').where({ shop_id: shop.shopId, lasyncro_variant_id: f.variantId }).orderBy('receive_sequence').select('lasyncro_unit_id', 'receive_sequence', 'status', 'current_location_code'),
      movements: await trx('inventory_movements').where({ shop_id: shop.shopId, lasyncro_variant_id: f.variantId }).select('movement_type', 'quantity_delta'),
      truth: await trx('inventory_truth').where({ shop_id: shop.shopId, lasyncro_variant_id: f.variantId }).select('location_code', 'on_hand_quantity'),
      stowTasks: await trx('stow_tasks').where({ shop_id: shop.shopId, lasyncro_variant_id: f.variantId }).select('quantity', 'status'),
    }));

    const claim = await request(app).post(`/api/v1/suppliers/receive-jobs/${f.jobId}/claim`).set(auth).send({});
    expect(claim.status).toBe(200);
    const confirm = await request(app).post(`/api/v1/suppliers/receive-jobs/${f.jobId}/lines/${f.lineId}/confirm-count`).set(auth)
      .send({ quantity_confirmed: 40, device_event_id: crypto.randomUUID() });
    expect(confirm.status).toBe(200);

    const before = await snapshot();
    expect(before.units.map((u: any) => u.lasyncro_unit_id)).toEqual(seeded);
    const nextBefore = await nextSequenceValue((await lsuSequence()).name);

    const inspect = await request(app).post(`/api/v1/suppliers/receive-jobs/${f.jobId}/inspect`).set(auth)
      .send({ receive_job_line_id: f.lineId, quantity_accepted: 40, quantity_rejected: 0, device_event_id: crypto.randomUUID() });

    expect({ status: inspect.status, code: inspect.body.code }).toEqual({ status: 409, code: 'INVENTORY_UNIT_RECEIVE_ISSUANCE_MISMATCH' });
    expect(await snapshot()).toEqual(before);
    expect(await nextSequenceValue((await lsuSequence()).name)).toBe(nextBefore);
  });
});
