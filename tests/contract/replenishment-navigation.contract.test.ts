// GH-1208 — ratified Inventory destinations and caller architecture.
import fs from 'fs';
import path from 'path';
import ts from 'typescript';
import { INVENTORY_MODULE_TABS } from '../../apps/frontend/src/pages/ft2-pages/inventoryModuleTabs';
import { ALERT_ROUTE_MAP } from '../../apps/frontend/src/pages/alerts/alertDeepLink';

function source(relative: string) {
  const file = path.resolve(__dirname, '../..', relative);
  return ts.createSourceFile(file, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
}

// Inspect merchant route literals only. Demand API/service/module names remain valid.
function planningDestinations(relative: string) {
  const file = source(relative);
  const destinations: string[] = [];
  function visit(node: ts.Node) {
    if (ts.isStringLiteral(node) && /^\/(demand|inventory\/replenishment)(?:[/?#]|$)/.test(node.text)) {
      destinations.push(node.text);
    }
    ts.forEachChild(node, visit);
  }
  visit(file);
  return destinations;
}

function navItems() {
  const file = source('apps/frontend/src/runtime/navBootstrap.ts');
  const items: Record<string, string>[] = [];
  function visit(node: ts.Node) {
    if (ts.isObjectLiteralExpression(node)) {
      const item: Record<string, string> = {};
      for (const prop of node.properties) {
        if (ts.isPropertyAssignment(prop) && ts.isStringLiteral(prop.initializer)) {
          item[prop.name.getText(file)] = prop.initializer.text;
        }
      }
      if (item.path) items.push(item);
    }
    ts.forEachChild(node, visit);
  }
  visit(file);
  return items;
}

describe('GH-1208 Replenishment navigation', () => {
  it('Inventory tabs are Intelligence / Items / Replenishment at canonical destinations', () => {
    expect(INVENTORY_MODULE_TABS.map(({ label, path }) => ({ label, path }))).toEqual([
      { label: 'Intelligence', path: '/inventory' },
      { label: 'Items', path: '/inventory/items' },
      { label: 'Replenishment', path: '/inventory/replenishment' },
    ]);
  });

  it('Replenishment sidenav destination preserves demand.forecasting', () => {
    expect(navItems()).toContainEqual(expect.objectContaining({
      title: 'Replenishment', path: '/inventory/replenishment', capabilityId: 'demand.forecasting',
    }));
    expect(planningDestinations('apps/frontend/src/runtime/navBootstrap.ts')).toEqual([
      '/inventory/replenishment',
    ]);
  });

  it('the planning tab retains the existing demand.forecasting capability', () => {
    expect(INVENTORY_MODULE_TABS.filter(tab => tab.capabilityId === 'demand.forecasting')).toHaveLength(1);
  });

  it('Inventory planning callers use the canonical route with no legacy Demand destination', () => {
    const destinations = planningDestinations('modules/products/src/ui/pages/ProductsModuleFT2.tsx');
    expect(destinations.length).toBeGreaterThan(0);
    expect(destinations.filter(value => /^\/demand(?:[/?#]|$)/.test(value))).toEqual([]);
    expect(destinations.every(value => value.startsWith('/inventory/replenishment'))).toBe(true);
  });

  it('low-stock alerts retain critical intent at the canonical planning route', () => {
    expect(ALERT_ROUTE_MAP.low_stock_reorder.route).toBe('/inventory/replenishment?filter=critical');
  });

  it('Aha planning handoff uses canonical Replenishment with critical intent', () => {
    expect(planningDestinations('apps/backend/src/api/aha/aha.controller.ts')).toEqual([
      '/inventory/replenishment?filter=critical',
    ]);
  });

  it('Morning Brief stockout-risk and low-stock producers both preserve critical intent at canonical Replenishment', () => {
    expect(planningDestinations('apps/backend/src/services/overview-ft2/overviewMorningBrief.resolver.ts')).toEqual([
      '/inventory/replenishment?filter=critical',
      '/inventory/replenishment?filter=critical',
    ]);
  });

  it('retains /demand/* as an explicit compatibility entry point in the authoritative route host', () => {
    const file = source('apps/frontend/src/lifecycle/LifecycleRouteHost.tsx');
    const routes: string[] = [];
    function visit(node: ts.Node) {
      if (ts.isJsxAttribute(node) && node.name.getText(file) === 'path' &&
          node.initializer && ts.isStringLiteral(node.initializer)) {
        routes.push(node.initializer.text);
      }
      ts.forEachChild(node, visit);
    }
    visit(file);
    expect(routes).toContain('/demand/*');
  });

  it('Sourcing navigation and existing targeted alert routes remain unchanged', () => {
    expect(navItems()).toContainEqual(expect.objectContaining({
      title: 'Sourcing', path: '/suppliers-portal/sourcing', capabilityId: 'purchasing.sourcing',
    }));
    expect(ALERT_ROUTE_MAP.stockout_risk.route).toBe('/suppliers-portal/sourcing');
    expect(ALERT_ROUTE_MAP.reorder_warning.route).toBe('/suppliers-portal/sourcing');
  });
});
