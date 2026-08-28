// tests/contract/manual-sync-canonical-owner.contract.test.ts
//
// SHOP-REVIEW-MANUAL-SYNC-CANONICAL-PATH-07 — source/static contract.
//
// The manual recovery controller previously imported `performInitialSync` from
// @lasyncro/backend-core/services/shopify.service.js — a stub that wrote
// integrations.sync_status='COMPLETED' directly, bypassing the canonical status
// progression and the integration/sync_completed emission, causing
// "Illegal sync_status transition: FAILED -> COMPLETED".
//
// Canonical (single) owner of Shopify initial sync:
//   apps/backend/src/services/shopify.service.ts::performInitialSync
//
// This contract fails if a second independently-importable initial-sync
// implementation is reintroduced, or if the manual controller is rewired back
// to the backend-core stub.

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
const CANONICAL_IMPORT =
  /import\s*\{[^}]*\bperformInitialSync\b[^}]*\}\s*from\s*['"]\.\.\/\.\.\/services\/shopify\.service\.js['"]/;

function read(file: string) {
  return fs.readFileSync(path.join(process.cwd(), file), 'utf8');
}

describe('CONTRACT SHOP-REVIEW-MANUAL-SYNC-CANONICAL-PATH-07 — single Shopify initial-sync owner', () => {
  it('manualSync.controller.ts does NOT import the backend-core shopify.service stub', () => {
    const source = read(MANUAL_SYNC_CONTROLLER);
    expect(BACKEND_CORE_SHOPIFY_SERVICE_IMPORT.test(source)).toBe(false);
  });

  it('manualSync.controller.ts imports performInitialSync from the canonical app-local service', () => {
    const source = read(MANUAL_SYNC_CONTROLLER);
    expect(CANONICAL_IMPORT.test(source)).toBe(true);
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
