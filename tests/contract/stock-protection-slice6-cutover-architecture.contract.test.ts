// STOCK-PROTECT-03 / Slice 6 — static cutover architecture contract.
//
// Plain source scans protect the atomic producer cutover:
// - legacy live producers stop emitting replenishment alerts
// - aggregateAlertsForShop stops owning low_stock_reorder
// - the canonical synchronizer is the only Stock Protection alert writer

import fs from 'fs';
import path from 'path';

const REPO = path.resolve(__dirname, '../..');

const DEMAND_SERVICE = 'apps/backend/src/services/demand/demandIntelligence.service.ts';
const INVENTORY_HANDLER = 'apps/backend/src/execution/handlers/resolve_inventory_block.handler.ts';
const ALERT_AGGREGATOR = 'apps/backend/src/services/alerts/alerts.aggregator.ts';
const CANONICAL_SYNCHRONIZER = 'apps/backend/src/services/alerts/stockProtectionAlertSynchronizer.ts';

function readSource(relPath: string): string {
  return fs.readFileSync(path.join(REPO, relPath), 'utf8');
}

function readExpectedSource(relPath: string): string {
  const abs = path.join(REPO, relPath);
  if (!fs.existsSync(abs)) {
    throw new Error(`[EXPECTED RED] ${relPath} does not exist yet; Slice 6 canonical alert synchronization is missing.`);
  }
  return fs.readFileSync(abs, 'utf8');
}

function stripCommentsAndImports(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
    .replace(/^\s*import[\s\S]*?;\s*$/gm, '');
}

describe('STOCK-PROTECT-03 Slice 6 — legacy producer cutover wiring', () => {
  it('computeDemandIntelligence no longer calls emitStockoutAlerts', () => {
    const source = stripCommentsAndImports(readSource(DEMAND_SERVICE));
    const computeBody = source.slice(source.indexOf('export async function computeDemandIntelligence'));

    expect(computeBody).not.toMatch(/\bemitStockoutAlerts\s*\(/);
  });

  it('resolve_inventory_block.handler.ts no longer calls emitStockoutAlerts', () => {
    const source = stripCommentsAndImports(readSource(INVENTORY_HANDLER));

    expect(source).not.toMatch(/\bemitStockoutAlerts\s*\(/);
  });

  it('aggregateAlertsForShop no longer calls aggregateStockReorderAlerts', () => {
    const source = stripCommentsAndImports(readSource(ALERT_AGGREGATOR));
    const aggregateBody = source.slice(source.indexOf('export async function aggregateAlertsForShop'));

    expect(aggregateBody).not.toMatch(/\baggregateStockReorderAlerts\s*\(/);
  });

  it('canonical Stock Protection alert synchronizer exists and exclusively delegates treatment decisions to evaluateStockProtectionForShop', () => {
    const source = stripCommentsAndImports(readExpectedSource(CANONICAL_SYNCHRONIZER));

    expect(source).toMatch(/\bsyncStockProtectionAlertsForShop\b/);
    expect(source).toMatch(/\bevaluateStockProtectionForShop\s*\(/);
    expect(source).toMatch(/alert_type\s*:\s*['"]stock_protection['"]/);
    expect(source).toMatch(/entity_type\s*:\s*['"]variant['"]/);
    expect(source).toMatch(/stock_protection:\$\{/);
    expect(source).not.toMatch(/\bcomputeVariantPlanning\s*\(/);
    expect(source).not.toMatch(/\bderiveStockProtectionTreatment\s*\(/);
    expect(source).not.toMatch(/\baggregateStockReorderAlerts\s*\(/);
    expect(source).not.toMatch(/\bemitStockoutAlerts\s*\(/);
  });
});
