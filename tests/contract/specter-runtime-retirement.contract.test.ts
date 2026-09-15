import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();

function absolute(rel: string): string {
  return path.join(ROOT, rel);
}

function exists(rel: string): boolean {
  return fs.existsSync(absolute(rel));
}

function read(rel: string): string {
  return fs.readFileSync(absolute(rel), 'utf8');
}

function sourceFiles(relDir: string): string[] {
  const root = absolute(relDir);

  if (!fs.existsSync(root)) return [];

  const out: string[] = [];

  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (
        entry.name === 'node_modules' ||
        entry.name === 'dist' ||
        entry.name === '.git'
      ) {
        continue;
      }

      const full = path.join(dir, entry.name);

      if (entry.isDirectory()) {
        walk(full);
        continue;
      }

      if (/\.(ts|tsx|js|jsx)$/.test(entry.name)) {
        out.push(full);
      }
    }
  };

  walk(root);
  return out.sort();
}

function matchingFiles(
  relDir: string,
  pattern: RegExp
): string[] {
  return sourceFiles(relDir)
    .filter((file) => pattern.test(fs.readFileSync(file, 'utf8')))
    .map((file) => path.relative(ROOT, file));
}

describe('COMMERCIAL-DEAD-SURFACE-01D-2 — Specter runtime retirement', () => {
  test('dedicated Specter runtime implementation is absent', () => {
    const retiredPaths = [
      'modules/specter',
      'apps/backend/src/api/specter',
      'apps/backend/src/bootstrap/specter-store.ts',
      'apps/backend/src/workers/specter-ingestion.worker.ts',
      'apps/backend/src/onboarding/providers/specter.provider.ts',
      'apps/frontend/src/api/specter.ts',
      'apps/frontend/src/contexts/SpecterConfigContext.tsx',
      'apps/frontend/src/components/specter',
      'apps/frontend/src/pages/customers/useSpecterFt1Adapter.ts',
      'apps/frontend/src/wiring/specterAhaAdapter.ts',
      'apps/frontend/src/wiring/specterChecklistAdapter.ts',
    ];

    expect(
      retiredPaths.filter((rel) => exists(rel))
    ).toEqual([]);
  });

  test('backend has no live Specter route, bootstrap, worker, queue, onboarding, or telemetry wiring', () => {
    const forbidden = [
      /specterRouter/i,
      /\/api\/v1\/specter/i,
      /specter_events/i,
      /startSpecterIngestionWorker/i,
      /stopSpecterIngestionWorker/i,
      /initSpecterStore/i,
      /closeSpecterStore/i,
      /specterOnboardingSignalProvider/i,
      /specter\.sessionsKnown/i,
      /specter\.sessionCount/i,
      /specter\.signalConfidence/i,
      /specter\.sdkInstalled/i,
      /@lasyncro\/specter/i,
    ];

    const offenders = new Set<string>();

    for (const pattern of forbidden) {
      for (const file of matchingFiles('apps/backend/src', pattern)) {
        offenders.add(file);
      }
    }

    expect([...offenders].sort()).toEqual([]);
  });

  test('Shopify sync orchestration no longer writes Specter telemetry', () => {
    const text = read(
      'apps/backend/src/services/shopify-sync-orchestrator.service.ts'
    );

    expect(text).not.toMatch(/@lasyncro\/specter/i);
    expect(text).not.toMatch(/\bappendEvent\b/);
    expect(text).not.toMatch(/\brecordShopSession\b/);
  });

  test('billing runtime no longer materializes Specter usage', () => {
    const text = read(
      'apps/backend/src/api/billing/handlers/handleInvoicePaid.ts'
    );

    expect(text).not.toMatch(/\bspecter_sessions\b/);
  });

  test('frontend source has no live Specter product wiring', () => {
    const offenders = matchingFiles(
      'apps/frontend/src',
      /\bspecter\b|Specter|@lasyncro\/specter|\/api\/v1\/specter/i
    );

    expect(offenders).toEqual([]);
  });

  test('package and build graph no longer contains the Specter workspace', () => {
    expect(read('package.json')).not.toMatch(
      /modules\/specter/
    );

    expect(read('apps/frontend/package.json')).not.toMatch(
      /@lasyncro\/specter/
    );

    const lock = read('package-lock.json');

    expect(lock).not.toMatch(/"modules\/specter"/);
    expect(lock).not.toMatch(/"@lasyncro\/specter"/);
  });

  test('commercial policy no longer exposes Specter as a plan/runtime dimension', () => {
    expect(
      read('packages/commercial-policy/src/limits.ts')
    ).not.toMatch(/\bspecterSessionCap\b/);

    expect(
      read('packages/commercial-policy/src/legacy.ts')
    ).not.toMatch(/\bspecterSessionCap\b/);

    const modules = read(
      'packages/commercial-policy/src/modules.ts'
    );

    expect(modules).not.toMatch(/^\s*specter\s*:/m);
    expect(modules).not.toMatch(/\bspecter_sdk_free\b/);
    expect(modules).not.toMatch(/['"]specter['"]/);
  });

  test('shared live contracts no longer expose Specter product presence or free-tier behavior', () => {
    expect(
      read('modules/shared/src/modules/module-presence.ts')
    ).not.toMatch(/\bspecter\b/i);

    expect(
      read('modules/shared/src/contracts/free-tier.ts')
    ).not.toMatch(/\bspecter\b/i);
  });

  test('historical persisted Specter grants remain explicitly fail-closed', () => {
    const tombstones = read(
      'packages/commercial-policy/src/persisted-grants.ts'
    );

    expect(tombstones).toContain("'specter'");
    expect(tombstones).toContain("'specter_sdk_free'");
  });

  test('historical schema migrations remain intact during code-first retirement', () => {
    expect(
      read(
        'apps/backend/migrations/20260214101114_0030_restore_lifecycle_and_activation_infrastructure.ts'
      )
    ).toContain('specter_shop_configs');

    expect(
      read(
        'apps/backend/migrations/20260415131701_0091_create_shop_usage_metrics.ts'
      )
    ).toContain('specter_sessions');
  });
});
