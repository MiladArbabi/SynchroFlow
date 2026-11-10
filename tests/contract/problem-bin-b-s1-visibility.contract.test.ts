// SF-PROBLEM-BIN-B-S1 — static visibility / recount-protection contract.
//
// Behaviour is proven in tests/integration/wms/problem-bin-visibility-
// recount-b-s1.test.ts. This DB-free scan pins the LIVE sellable-stock paths
// (order constraint, low-stock planning) to the canonical pickable predicate,
// so Problem Bin / quarantine stock cannot become orderable through a refactor,
// and pins recount protection to creation, review and commit.

import fs from 'fs';
import path from 'path';

const REPO = path.resolve(__dirname, '../..');
const read = (rel: string) => fs.readFileSync(path.join(REPO, rel), 'utf8');
const code = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const RELEASE_CAPACITY = 'apps/backend/src/services/inventory/releaseCapacity.service.ts';
const CONSTRAINT_EVALUATOR = 'apps/backend/src/services/constraints/evaluators/inventoryConstraintEvaluator.ts';
const DEMAND = 'apps/backend/src/services/demand/demandIntelligence.service.ts';
const RECOUNT = 'apps/backend/src/services/wms/inventoryRecount.service.ts';

function body(source: string, signature: string): string {
  const start = source.indexOf(signature);
  expect(start).toBeGreaterThanOrEqual(0);
  const next = source.indexOf('\nexport async function ', start + signature.length);
  const nextLocal = source.indexOf('\nasync function ', start + signature.length);
  const ends = [next, nextLocal].filter((i) => i > 0);
  return source.slice(start, ends.length ? Math.min(...ends) : undefined);
}

describe('SF-PROBLEM-BIN-B-S1 — live sellable stock uses the canonical pickable predicate', () => {
  it('readReleaseCapacity joins only active pickable locations', () => {
    const fn = body(code(read(RELEASE_CAPACITY)), 'export async function readReleaseCapacity(');
    expect(fn).toMatch(/andOnVal\('wl\.active', true\)/);
    expect(fn).toMatch(/andOn\(pickableLocationCondition\(trx\)\)/);
  });

  it('the live order constraint evaluator derives availability from readReleaseCapacity only', () => {
    const fn = body(code(read(CONSTRAINT_EVALUATOR)), 'export async function evaluateInventoryConstraint(');
    expect(fn).toMatch(/readReleaseCapacity\(trx,/);
    expect(fn).not.toMatch(/inventory_truth/);
  });

  it('low-stock planning (both eligibility modes) joins pickable locations', () => {
    const fn = body(code(read(DEMAND)), 'export async function computeVariantPlanning(');
    expect((fn.match(/andOn\(pickableLocationCondition\(trx\)\)/g) ?? []).length).toBeGreaterThanOrEqual(2);
  });
});

describe('SF-PROBLEM-BIN-B-S1 — recount protection is wired at creation, review and commit', () => {
  const src = code(read(RECOUNT));

  it('protected zones are exactly problem and quarantine', () => {
    expect(src).toMatch(/RECOUNT_PROTECTED_ZONE_TYPES = \['problem', 'quarantine'\] as const/);
  });

  it('createRecountTask refuses explicit protected locations and filters broad scopes', () => {
    const fn = body(src, 'export async function createRecountTask(');
    expect(fn).toMatch(/findProtectedRecountLocations\(trx, shopId, explicitCodes\)/);
    expect(fn).toMatch(/whereNotExists/);
    expect(fn).toMatch(/RECOUNT_PROTECTED_ZONE_TYPES/);
  });

  it('reviewLine(accept) and commitRecount refuse protected lines before any write', () => {
    expect(body(src, 'export async function reviewLine(')).toMatch(/findProtectedRecountLocations/);
    const commit = body(src, 'export async function commitRecount(');
    const guard = commit.indexOf('findProtectedRecountLocations');
    const firstWrite = commit.indexOf("trx('inventory_movements')");
    expect(guard).toBeGreaterThan(0);
    expect(guard).toBeLessThan(firstWrite);
  });
});
