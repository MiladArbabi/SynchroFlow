// tests/contract/stock-protection-buffer-boundary.contract.test.ts
//
// STOCK-PROTECT-02 — ARCHITECTURE/STATIC contract for the Buffer Diagnosis
// implementation boundary. PERMANENT regression contract, authored RED.
// ============================================================================
// WHAT THIS PROTECTS
//   A recommendation is read-only evidence, never authority. Whatever
//   implements Buffer Diagnosis must never mutate the approved-policy
//   tables, must never read recommendation_snapshot back as current
//   authority, must reuse Demand's existing planning/evidence machinery
//   rather than growing a second velocity/confidence/reorder system, and
//   must not misuse the specific fields the STOCK-PROTECT-02A audit found
//   ambiguous (suppliers.total_pos, avg_delivery_days, defect_rate,
//   partially_received POs).
//
// INDEPENDENTLY RED
//   This scanner reads real production source under apps/backend/src for
//   any file implementing Buffer Diagnosis (by module name or by producing
//   recommended_safety_days). No such file exists yet, so BUFFER-BOUND-01
//   fails on a concrete, currently-true assertion ("at least one such file
//   exists") rather than an import error or a vacuous pass — the same
//   pattern already established by
//   tests/contract/stock-protection-planning-authority.contract.test.ts
//   (SP-POL-12) for STOCK-PROTECT-01. The remaining boundary checks are
//   vacuously true today (no candidate files to violate anything) and
//   become meaningful the moment an implementation appears — mirrored by
//   this suite's own self-guard tests (BUFFER-BOUND-08/09), which prove the
//   scanner itself still detects a violation when one is synthetically
//   introduced.
//
// MECHANISM: plain source-text scan, matching the style already used for
// architecture rules in this repository (see
// tests/contract/commercial-subscription-writer-boundary.contract.test.ts
// and stock-protection-planning-authority.contract.test.ts).

import fs from 'fs';
import path from 'path';

const REPO = path.resolve(__dirname, '../..');
const SCAN_ROOT = 'apps/backend/src';
const SKIP_DIR_SEGMENTS = ['node_modules', 'dist', 'build', 'generated', '__generated__', '.claude'];

/** Marks a file as a Buffer Diagnosis candidate implementation. */
const FEATURE_MARKER = /stock.protection.buffer|buffer.diagnosis|recommended_safety_days|computeBufferDiagnosis/i;

const DEMAND_INTEGRATION_MARKER = /demandIntelligence(\.service)?(\.js|\.ts)?['"]/;

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

/** A mutating knex chain rooted at one of the given table names. */
function mutatingChainPattern(tables: string[]): RegExp {
  const tableAlt = tables.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
  return new RegExp(
    `\\(\\s*['"\`](?:${tableAlt})(?:\\s+as\\s+\\w+)?['"\`]\\s*\\)[\\s\\S]{0,200}?\\.(insert|update|upsert|del|delete)\\s*\\(`,
    'm'
  );
}

describe('STOCK-PROTECT-02 — Buffer Diagnosis architecture boundary', () => {
  const allFiles = listSourceFiles(SCAN_ROOT);
  const candidateFiles = allFiles.filter((f) => FEATURE_MARKER.test(readSource(f)));

  describe('BUFFER-BOUND-01: a Buffer Diagnosis implementation point exists', () => {
    it('at least one runtime source file implements Buffer Diagnosis', () => {
      expect(candidateFiles.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('BUFFER-BOUND-02: recommendation code never mutates stock_protection_policies', () => {
    it('no candidate file INSERTs/UPDATEs/DELETEs stock_protection_policies', () => {
      const pattern = mutatingChainPattern(['stock_protection_policies']);
      const violations = candidateFiles.filter((f) => pattern.test(readSource(f)));
      expect(violations).toEqual([]);
    });
  });

  describe('BUFFER-BOUND-03: recommendation code never writes stock_protection_policy_transitions', () => {
    it('no candidate file INSERTs into stock_protection_policy_transitions', () => {
      const pattern = mutatingChainPattern(['stock_protection_policy_transitions']);
      const violations = candidateFiles.filter((f) => pattern.test(readSource(f)));
      expect(violations).toEqual([]);
    });
  });

  describe('BUFFER-BOUND-04: recommendation_snapshot is never read back as current authority', () => {
    it('no candidate file selects/reads recommendation_snapshot from stock_protection_policy_transitions', () => {
      const violations = candidateFiles.filter((f) => /recommendation_snapshot/.test(readSource(f)));
      expect(violations).toEqual([]);
    });
  });

  describe('BUFFER-BOUND-05: Buffer Diagnosis reuses canonical Demand evidence rather than a second engine', () => {
    it('every candidate file that computes velocity/confidence imports from demandIntelligence.service, not a duplicate formula', () => {
      const velocityLike = candidateFiles.filter((f) => /velocity|demand_confidence|demandConfidence/i.test(readSource(f)));
      const missingImport = velocityLike.filter((f) => !DEMAND_INTEGRATION_MARKER.test(readSource(f)));
      expect(missingImport).toEqual([]);
    });
  });

  describe('BUFFER-BOUND-06: suppliers.total_pos is never used as confidence/sample-size authority', () => {
    it('no candidate file references total_pos', () => {
      const violations = candidateFiles.filter((f) => /total_pos/.test(readSource(f)));
      expect(violations).toEqual([]);
    });
  });

  describe('BUFFER-BOUND-07: avg_delivery_days is never treated as supplier lead time', () => {
    it('no candidate file assigns/aliases avg_delivery_days into a lead-time-named binding', () => {
      const suspiciousPattern = /avg_delivery_days[\s\S]{0,60}(lead_?time|leadTime)/i;
      const violations = candidateFiles.filter((f) => suspiciousPattern.test(readSource(f)));
      expect(violations).toEqual([]);
    });
  });

  describe('BUFFER-BOUND-08: defect_rate is excluded from general V1 supplier-risk calculation', () => {
    it('no candidate file references defect_rate at all', () => {
      const violations = candidateFiles.filter((f) => /defect_rate/.test(readSource(f)));
      expect(violations).toEqual([]);
    });
  });

  describe('BUFFER-BOUND-09: partially_received POs are excluded from settled supplier evidence', () => {
    it('no candidate file references the partially_received status literal', () => {
      const violations = candidateFiles.filter((f) => /partially_received/.test(readSource(f)));
      expect(violations).toEqual([]);
    });
  });

  // ── Scanner self-guard ─────────────────────────────────────────────────
  // Without these, every BUFFER-BOUND-0x check above could pass simply
  // because candidateFiles is empty, not because the rule was honoured.
  describe('BUFFER-BOUND-10: the scanner detects a synthetic violation when one is present', () => {
    it('flags a synthetic file that mutates stock_protection_policies', () => {
      const tmpDir = path.join(REPO, SCAN_ROOT, '__tmp_buffer_boundary_selfguard__');
      const tmpFile = path.join(tmpDir, 'synthetic.ts');
      fs.mkdirSync(tmpDir, { recursive: true });
      fs.writeFileSync(
        tmpFile,
        `
        export async function computeBufferDiagnosis(trx: any, shopId: number) {
          await trx('stock_protection_policies')
            .where({ shop_id: shopId })
            .update({ safety_days: 999 });
        }
        `
      );
      try {
        const relFile = path.relative(REPO, tmpFile);
        const found = FEATURE_MARKER.test(readSource(relFile));
        expect(found).toBe(true);
        const pattern = mutatingChainPattern(['stock_protection_policies']);
        expect(pattern.test(readSource(relFile))).toBe(true);
      } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    });
  });

  describe('BUFFER-BOUND-11: the canonical Demand module still exists (guards the reuse check)', () => {
    it('demandIntelligence.service.ts is present and exports computeVariantPlanning', () => {
      const demandFile = 'apps/backend/src/services/demand/demandIntelligence.service.ts';
      expect(fs.existsSync(path.join(REPO, demandFile))).toBe(true);
      expect(readSource(demandFile)).toContain('export async function computeVariantPlanning');
    });
  });
});
