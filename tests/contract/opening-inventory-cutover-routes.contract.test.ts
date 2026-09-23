// tests/contract/opening-inventory-cutover-routes.contract.test.ts
//
// 4b-2b GRILL-03G — opening inventory cutover route registration.
// PURE / CONTRACT layer: reads production route source as text (same
// bounded-chunk convention as commercial-inventory-products-access
// .contract.test.ts). No DB, no server.
//
// Contract: both routes sit in the canonical recount family —
//   authenticateToken → requireFt2 → requireCapability('inventory.core')
//   → requireAction('wms:recount:read' | 'wms:recount:commit') → handler
// in exactly that order, with no extra gate and no raw tier gate.

import fs from 'fs';
import path from 'path';

const REPO = path.resolve(__dirname, '../..');
const WMS_ROUTES = 'apps/backend/src/api/wms/wms.routes.ts';
const read = (rel: string): string => fs.readFileSync(path.join(REPO, rel), 'utf8');

function routeChunk(src: string, verb: string, pathLiteral: string): string {
  const esc = pathLiteral.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const m = new RegExp(`router\\.${verb}\\(\\s*\\n?\\s*'${esc}'`).exec(src);
  if (!m) return '';
  const rest = src.slice(m.index);
  const end = rest.search(/\n\s*router\.(get|post|patch|put|delete)\(|\nexport default/);
  return end === -1 ? rest : rest.slice(0, end);
}

/** Registration arguments after the path literal, comments stripped. */
function middlewareChain(chunk: string, pathLiteral: string): string[] {
  const body = chunk
    .replace(/\/\/.*$/gm, '')
    .replace(/\/\*[\s\S]*?\*\//g, '');
  const afterPath = body.slice(body.indexOf(`'${pathLiteral}'`) + pathLiteral.length + 2);
  const closeIdx = afterPath.lastIndexOf(')');
  return afterPath
    .slice(0, closeIdx)
    .split(/,(?![^(]*\))/)
    .map((s) => s.replace(/\s+/g, ''))
    .filter(Boolean);
}

const CASES: Array<[string, string, string, string]> = [
  ['get', '/opening-inventory/progress', 'wms:recount:read', 'httpGetOpeningInventoryProgress'],
  ['post', '/opening-inventory/cutover', 'wms:recount:commit', 'httpApproveOpeningInventoryCutover'],
];

describe('GRILL-03G — opening inventory cutover routes', () => {
  it.each(CASES)('%s %s registers authenticate → FT2 → inventory.core → %s → handler', (verb, p, action, handler) => {
    const chunk = routeChunk(read(WMS_ROUTES), verb, p);
    expect(chunk.length).toBeGreaterThan(0);

    expect(middlewareChain(chunk, p)).toEqual([
      'authenticateToken',
      'requireFt2',
      "requireCapability('inventory.core')",
      `requireAction('${action}')`,
      handler,
    ]);
  });

  it('each route is registered exactly once', () => {
    const src = read(WMS_ROUTES);
    for (const [verb, p] of CASES) {
      const esc = p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const matches = src.match(new RegExp(`router\\.${verb}\\(\\s*\\n?\\s*'${esc}'`, 'g')) ?? [];
      expect(matches).toHaveLength(1);
    }
  });

  it('handlers are imported from the dedicated cutover controller', () => {
    const src = read(WMS_ROUTES);
    expect(
      /import\s*\{[^}]*httpGetOpeningInventoryProgress[^}]*httpApproveOpeningInventoryCutover[^}]*\}\s*from\s*'\.\/openingInventoryCutover\.controller\.js'/.test(src)
      || /import\s*\{[^}]*httpApproveOpeningInventoryCutover[^}]*httpGetOpeningInventoryProgress[^}]*\}\s*from\s*'\.\/openingInventoryCutover\.controller\.js'/.test(src)
    ).toBe(true);
  });
});
