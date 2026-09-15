import fs from 'fs';
import path from 'path';

const ROOT = process.cwd();

const FRONTEND_ROOT = path.join(ROOT, 'apps/frontend/src');
const LEGACY_BANNER = path.join(
  FRONTEND_ROOT,
  'components/OrderCapBanner.tsx',
);
const FRONTEND_TIERS = path.join(
  FRONTEND_ROOT,
  'config/tiers.ts',
);
const ORDER_INGEST_HANDLER = path.join(
  ROOT,
  'apps/backend/src/api/shopify/handlers/handleOrderCreated.ts',
);
const CANONICAL_LIMITS = path.join(
  ROOT,
  'packages/commercial-policy/src/limits.ts',
);

function walk(dir: string): string[] {
  const out: string[] = [];

  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === 'dist') continue;
      out.push(...walk(full));
      continue;
    }

    if (entry.isFile() && /\.(ts|tsx)$/.test(entry.name)) {
      out.push(full);
    }
  }

  return out;
}

describe('FINAL-RECON-01C — legacy ingestion-cap retirement', () => {
  it('RED: obsolete OrderCapBanner source is retired', () => {
    expect(fs.existsSync(LEGACY_BANNER)).toBe(false);
  });

  it('RED: frontend owns no monthly ingestion-cap table', () => {
    const tiers = fs.readFileSync(FRONTEND_TIERS, 'utf8');

    expect(tiers).not.toMatch(/\bTIER_MONTHLY_ORDER_CAP\b/);
  });

  it('RED: frontend contains no merchant ingestion-cap contract', () => {
    const offenders: string[] = [];

    for (const file of walk(FRONTEND_ROOT)) {
      const src = fs.readFileSync(file, 'utf8');

      if (
        /\bOrderCapBanner\b/.test(src) ||
        /Monthly order limit reached/i.test(src) ||
        /New orders are paused/i.test(src) ||
        /upgrade now to keep ingesting/i.test(src)
      ) {
        offenders.push(
          path.relative(ROOT, file).replace(/\\/g, '/'),
        );
      }
    }

    expect(offenders).toEqual([]);
  });

  it('GREEN CONTROL: ingestion telemetry remains canonical and non-blocking', () => {
    const limits = fs.readFileSync(CANONICAL_LIMITS, 'utf8');
    const handler = fs.readFileSync(ORDER_INGEST_HANDLER, 'utf8');

    expect(limits).toMatch(
      /monthlyOrderCap is telemetry/i,
    );

    expect(limits).toMatch(
      /NOT an ingestion gate/i,
    );

    expect(handler).toMatch(
      /ORDER_CAP_EXCEEDED_INGEST_CONTINUES/,
    );

    expect(handler).toMatch(
      /\.increment\(['"]ingested_orders['"],\s*1\)/,
    );

    expect(handler).toMatch(
      /Shopify order truth must always be ingested/i,
    );
  });
});
