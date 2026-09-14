/**
 * RETURNS-BOUNDARY-01: returned_undelivered is an internal Order Pool
 * release guard (order_constraints.constraint_type='operational',
 * block_type='returned_undelivered'), not a merchant-facing pre-fulfillment
 * blocker. It must not render in Order Flow's Blocked column — but an
 * order that ALSO carries a real customer/inventory blocker must still be
 * shown, for that real blocker (FLOW-MULTIBLOCK-01).
 *
 * Extracts and executes the actual `blockedOrders` filter predicate from
 * OrderFlowPage.tsx (same AST-extract-and-execute pattern as
 * OrderFlowPage.pool-row-inspection-1057.test.ts) so this proves the
 * shipped logic, not a reimplementation of it.
 */
import * as ts from 'typescript';
import { readFileSync } from 'fs';
import { resolve } from 'path';

function extractBlockedOrdersFilterPredicate(): (order: {
  constraint_type: string;
  block_type: string | null;
  other_blocker_types?: string[];
}) => boolean {
  const filename = resolve(__dirname, '../../../../apps/frontend/src/pages/ft2-pages/OrderFlowPage.tsx');
  const source = ts.createSourceFile(
    filename,
    readFileSync(filename, 'utf8'),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX
  );

  const descendants = (root: ts.Node, predicate: (node: ts.Node) => boolean): ts.Node[] => {
    const found: ts.Node[] = [];
    const visit = (node: ts.Node) => {
      if (predicate(node)) found.push(node);
      ts.forEachChild(node, visit);
    };
    visit(root);
    return found;
  };

  // Find `.filter((order) => { ... })` calls whose body references
  // `block_type === 'returned_undelivered'` — the blockedOrders memo.
  const filterCalls = descendants(
    source,
    (node) =>
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      node.expression.name.text === 'filter' &&
      node.getText(source).includes('returned_undelivered')
  ) as ts.CallExpression[];

  expect(filterCalls).toHaveLength(1);

  const callback = filterCalls[0].arguments[0];
  if (!ts.isArrowFunction(callback) && !ts.isFunctionExpression(callback)) {
    throw new Error('Missing blockedOrders filter callback');
  }

  const javascript = ts.transpileModule(`const predicate = ${callback.getText(source)};`, {
    compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.None },
  }).outputText;

  // eslint-disable-next-line no-new-func
  const factory = new Function(`${javascript}\nreturn predicate;`);
  return factory();
}

describe('RETURNS-BOUNDARY-01 — Order Flow does not render returned_undelivered as a Blocked Order', () => {
  const predicate = extractBlockedOrdersFilterPredicate();

  it('drops an order whose only active constraint is returned_undelivered', () => {
    const order = {
      constraint_type: 'operational',
      block_type: 'returned_undelivered',
      other_blocker_types: [],
    };
    expect(predicate(order)).toBe(false);
  });

  it('drops an order whose returned_undelivered guard has other_blocker_types undefined (COALESCE default)', () => {
    const order = {
      constraint_type: 'operational',
      block_type: 'returned_undelivered',
    };
    expect(predicate(order)).toBe(false);
  });

  it('keeps an order that has returned_undelivered AND a real customer blocker', () => {
    const order = {
      constraint_type: 'operational',
      block_type: 'returned_undelivered',
      other_blocker_types: ['customer'],
    };
    expect(predicate(order)).toBe(true);
  });

  it('keeps an order that has returned_undelivered AND a real inventory blocker', () => {
    const order = {
      constraint_type: 'operational',
      block_type: 'returned_undelivered',
      other_blocker_types: ['inventory'],
    };
    expect(predicate(order)).toBe(true);
  });

  it('keeps a genuine customer-blocked order untouched', () => {
    const order = {
      constraint_type: 'customer',
      block_type: 'incomplete_address',
      other_blocker_types: [],
    };
    expect(predicate(order)).toBe(true);
  });

  it('keeps a genuine inventory-blocked order untouched', () => {
    const order = {
      constraint_type: 'inventory',
      block_type: null,
      other_blocker_types: [],
    };
    expect(predicate(order)).toBe(true);
  });

  it('keeps any non-returned_undelivered operational row (defensive — evaluator is inert but not deleted)', () => {
    const order = {
      constraint_type: 'operational',
      block_type: null,
      other_blocker_types: [],
    };
    expect(predicate(order)).toBe(true);
  });
});
