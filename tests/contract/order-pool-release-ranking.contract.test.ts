/**
 * D3-B — Order Pool and release share ONE deterministic canonical ranking.
 *
 * GET /wms/order-pool (httpGetOrderPool) and releaseBatch's eligibleOrders
 * query are the two backend ranking authorities. Explicit release inherits
 * eligibleOrders' order (D3-A), so both must end with the same stable key:
 *
 *   is_priority_flagged DESC > SLA rank DESC > order_created_at ASC
 *   > lasyncro_order_id ASC
 *
 * The UUID key is a deterministic final tie-break only — it never changes
 * business priority. Without it, two otherwise-equivalent orders with the
 * same order_created_at have an unspecified relative order, so pool and
 * release can disagree about who wins batch capacity.
 *
 * Source contract rather than a DB test: PostgreSQL's order for equal sort
 * keys is accidental, so a runtime test could pass by luck.
 */
import fs from 'fs';
import path from 'path';

const WMS_CONTROLLER = 'apps/backend/src/api/wms/wms.controller.ts';
const PICK_BATCH_SERVICE = 'apps/backend/src/services/wms/pickBatch.service.ts';

const CANONICAL_RANKING = [
  'ofs.is_priority_flagged DESC',
  '${currentSla.rank} DESC',
  'o.order_created_at ASC',
  'o.lasyncro_order_id ASC',
];

function read(relative: string): string {
  return fs.readFileSync(path.resolve(__dirname, '../..', relative), 'utf8');
}

/** Source of one exported declaration, up to the next top-level export. */
function exportedBody(relative: string, declaration: string): string {
  const src = read(relative);
  const start = src.indexOf(declaration);
  if (start < 0) throw new Error(`${declaration} not found in ${relative}`);
  const next = src.indexOf('\nexport ', start + declaration.length);
  return src.slice(start, next < 0 ? undefined : next);
}

/** The ORDER BY keys of every orderByRaw ranking on is_priority_flagged. */
function rankingClauses(body: string): string[][] {
  return [...body.matchAll(/\.orderByRaw\(\s*`([^`]*)`\s*\)/g)]
    .map((m) => m[1])
    .filter((clause) => clause.includes('is_priority_flagged'))
    .map((clause) => clause.split(',').map((key) => key.replace(/\s+/g, ' ').trim()));
}

describe('D3-B — canonical Order Pool / release ranking ends with a stable tie-break', () => {
  it('A — Order Pool (httpGetOrderPool) ranks priority > SLA > oldest > lasyncro_order_id', () => {
    const clauses = rankingClauses(
      exportedBody(WMS_CONTROLLER, 'export const httpGetOrderPool')
    );
    expect(clauses).toHaveLength(1);
    expect(clauses[0]).toEqual(CANONICAL_RANKING);
  });

  it('B — releaseBatch eligibleOrders ranks priority > SLA > oldest > lasyncro_order_id', () => {
    const clauses = rankingClauses(
      exportedBody(PICK_BATCH_SERVICE, 'export async function releaseBatch')
    );
    expect(clauses).toHaveLength(1);
    expect(clauses[0]).toEqual(CANONICAL_RANKING);
  });
});
