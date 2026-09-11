// tests/contract/stock-protection-planning-authority.contract.test.ts
//
// STOCK-PROTECT-01 — ARCHITECTURE/STATIC contract for planning-availability
// authority. PERMANENT regression contract, authored RED.
// ===========================================================================
// WHAT THIS PROTECTS (contract item 10)
//   "Planning availability: canonical pickable inventory only. Reuse
//   pickableLocationCondition. Exclude receive / returns / pack / ship /
//   kitting / problem / quarantine stock." Any runtime file that computes
//   planning availability for the Stock Protection Policy feature must reuse
//   the ONE canonical predicate in
//   apps/backend/src/services/inventory/pickableLocation.ts, never a second,
//   independently-drifting copy of the pick/warehouse zone_type predicate.
//   This mirrors the existing sourcing rule that Sourcing must keep
//   consuming canonical Demand planning rather than a second reorder-sizing
//   engine.
//
// INDEPENDENTLY RED
//   This scanner reads real production source under apps/backend/src for
//   any file that references the stock-protection-policy feature (by module
//   or table name) AND queries inventory/location state. No such file exists
//   yet — the feature is unimplemented — so PLANNING-AUTH-01 below fails on
//   a concrete, currently-true assertion ("at least one such integration
//   point exists") rather than on a broken import or a vacuous pass. This is
//   the legitimate RED signal for surface E (planning authority integration
//   missing).
//
// MECHANISM
//   Plain source-text scan (grep-equivalent), matching the style already
//   used for architecture rules in this repository. AST is not needed here:
//   this contract only needs to know whether a file mentions the
//   stock-protection feature and, if so, whether it also references the
//   canonical predicate rather than hand-rolling the pick/warehouse
//   zone_type condition.
//
// COVERS: SP-POL-12

import fs from 'fs';
import path from 'path';

const REPO = path.resolve(__dirname, '../..');
const SCAN_ROOT = 'apps/backend/src';
const SKIP_DIR_SEGMENTS = ['node_modules', 'dist', 'build', 'generated', '__generated__', '.claude'];

const CANONICAL_PREDICATE_MODULE = 'apps/backend/src/services/inventory/pickableLocation.ts';
const CANONICAL_PREDICATE_SYMBOL = 'pickableLocationCondition';

/** Matches either the feature's table names or an obvious service/module name. */
const FEATURE_MARKER = /stock_protection_polic|stockprotectionpolic/i;

/** A hand-rolled duplicate of the canonical pick/warehouse predicate. */
const DUPLICATE_PREDICATE_PATTERN =
  /zone_type\s*=\s*'pick'[\s\S]{0,80}type\s*=\s*'bin'|type\s*=\s*'warehouse'/i;

/** Inventory/location tables that indicate availability computation. */
const INVENTORY_TABLE_MARKER = /warehouse_locations|inventory_truth/;

function listSourceFiles(root: string): string[] {
  const abs = path.join(REPO, root);
  if (!fs.existsSync(abs)) return [];
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        if (SKIP_DIR_SEGMENTS.includes(entry.name)) continue;
        walk(path.join(dir, entry.name));
        continue;
      }
      if (!/\.tsx?$/.test(entry.name)) continue;
      if (/\.d\.ts$/.test(entry.name)) continue;
      if (/\.test\.tsx?$/.test(entry.name)) continue;
      out.push(path.relative(REPO, path.join(dir, entry.name)));
    }
  };
  walk(abs);
  return out.sort();
}

function readSource(file: string): string {
  return fs.readFileSync(path.join(REPO, file), 'utf8');
}

describe('STOCK-PROTECT-01 — planning-availability authority (SP-POL-12)', () => {
  const allFiles = listSourceFiles(SCAN_ROOT);
  const featureFiles = allFiles.filter((f) => FEATURE_MARKER.test(readSource(f)));
  const featureFilesQueryingInventory = featureFiles.filter((f) => INVENTORY_TABLE_MARKER.test(readSource(f)));

  describe('PLANNING-AUTH-01: a stock-protection planning-availability integration point exists', () => {
    it('at least one runtime source file implements stock-protection planning availability over inventory/location state', () => {
      expect(featureFilesQueryingInventory.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('PLANNING-AUTH-02: every such integration point reuses the canonical pickable-location predicate', () => {
    it('imports pickableLocationCondition from the canonical module rather than hand-rolling the predicate', () => {
      const violations = featureFilesQueryingInventory
        .filter((f) => f !== CANONICAL_PREDICATE_MODULE)
        .map((f) => {
          const src = readSource(f);
          const importsCanonical =
            src.includes(CANONICAL_PREDICATE_SYMBOL) &&
            (src.includes("pickableLocation'") ||
              src.includes('pickableLocation"') ||
              src.includes('pickableLocation.js'));
          const hasDuplicatePredicate = DUPLICATE_PREDICATE_PATTERN.test(src);
          return { file: f, importsCanonical, hasDuplicatePredicate };
        })
        .filter((r) => !r.importsCanonical || r.hasDuplicatePredicate);

      expect(violations).toEqual([]);
    });
  });

  describe('PLANNING-AUTH-03: the canonical predicate module itself still exists (guards the scanner)', () => {
    it('pickableLocation.ts is present and exports pickableLocationCondition', () => {
      expect(fs.existsSync(path.join(REPO, CANONICAL_PREDICATE_MODULE))).toBe(true);
      const src = readSource(CANONICAL_PREDICATE_MODULE);
      expect(src).toContain(`export function ${CANONICAL_PREDICATE_SYMBOL}`);
    });
  });
});
