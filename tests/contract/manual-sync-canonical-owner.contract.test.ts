// tests/contract/manual-sync-canonical-owner.contract.test.ts
//
// SHOP-REVIEW-MANUAL-SYNC-CANONICAL-PATH-07 — source/static contract.
//
// HTTP manual recovery must never execute Shopify sync inline. The legacy
// route is a compatibility alias for the durable T3-B recovery admission path;
// the worker remains the single owner of Shopify sync execution.
//
// Canonical (single) owner of Shopify initial sync:
//   apps/backend/src/services/shopify.service.ts::performInitialSync
//
// This contract fails if a second independently-importable initial-sync
// implementation is reintroduced, if HTTP regains direct execution/status
// authority, or if the legacy route bypasses durable recovery admission.

import fs from 'fs';
import path from 'path';

const MANUAL_SYNC_CONTROLLER =
  'apps/backend/src/api/integrations/manualSync.controller.ts';

// Source + build-artifact forms of the deleted backend-core duplicate. If any
// of these exist they are importable via backend-core's `./services/*.js`
// wildcard package export, so the single-owner invariant is broken.
const FORBIDDEN_DUPLICATE_PATHS = [
  'packages/backend-core/src/services/shopify.service.ts',
  'packages/backend-core/dist/services/shopify.service.js',
  'packages/backend-core/dist/services/shopify.service.d.ts',
  'packages/backend-core/dist/services/shopify.service.js.map',
  'packages/backend-core/dist/services/shopify.service.d.ts.map',
] as const;

const BACKEND_CORE_SHOPIFY_SERVICE_IMPORT =
  /@lasyncro\/backend-core\/services\/shopify\.service/;
const DURABLE_RECOVERY_IMPORT =
  /import\s*\{[^}]*\brespondWithManualRecovery\b[^}]*\}\s*from\s*['"]\.\/integration\.controller\.js['"]/;
const INLINE_SYNC = /\bperform(?:Initial|Smart)Sync\s*\(/;
const ALTERNATE_QUEUE = /\b(?:getQueueChannel|sendToQueue|publish|recordShopifySyncDispatchIntent)\b/;
const DIRECT_STATUS_MUTATION = /\b(?:updateIntegrationStatus|sync_status|sync_progress_current|sync_progress_total)\b/;

function read(file: string) {
  return fs.readFileSync(path.join(process.cwd(), file), 'utf8');
}

describe('CONTRACT SHOP-REVIEW-MANUAL-SYNC-CANONICAL-PATH-07 — single Shopify initial-sync owner', () => {
  it('manualSync.controller.ts does NOT import the backend-core shopify.service stub', () => {
    const source = read(MANUAL_SYNC_CONTROLLER);
    expect(BACKEND_CORE_SHOPIFY_SERVICE_IMPORT.test(source)).toBe(false);
  });

  it('legacy manual route delegates to durable recovery and has no execution, queue, or status authority', () => {
    const source = read(MANUAL_SYNC_CONTROLLER);
    expect(DURABLE_RECOVERY_IMPORT.test(source)).toBe(true);
    expect((source.match(/\brespondWithManualRecovery\s*\(/g) ?? [])).toHaveLength(1);
    expect(INLINE_SYNC.test(source)).toBe(false);
    expect(ALTERNATE_QUEUE.test(source)).toBe(false);
    expect(DIRECT_STATUS_MUTATION.test(source)).toBe(false);
  });

  it.each(FORBIDDEN_DUPLICATE_PATHS)(
    'duplicate initial-sync implementation artifact does not exist: %s',
    (p) => {
      expect(fs.existsSync(path.join(process.cwd(), p))).toBe(false);
    }
  );

  it('no source file imports @lasyncro/backend-core/services/shopify.service', () => {
    // Narrow, deterministic scan of the two directories that could import it.
    const roots = ['apps/backend/src', 'packages/backend-core/src'];
    const offenders: string[] = [];

    const walk = (dir: string) => {
      const abs = path.join(process.cwd(), dir);
      if (!fs.existsSync(abs)) return;
      for (const entry of fs.readdirSync(abs, { withFileTypes: true })) {
        const rel = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          walk(rel);
        } else if (entry.name.endsWith('.ts') || entry.name.endsWith('.tsx')) {
          if (BACKEND_CORE_SHOPIFY_SERVICE_IMPORT.test(read(rel))) {
            offenders.push(rel);
          }
        }
      }
    };

    roots.forEach(walk);
    expect(offenders).toEqual([]);
  });
});
