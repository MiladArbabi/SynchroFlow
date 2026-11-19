/**
 * GH-1049 permanent client contracts.
 *
 * Canonical boundary:
 * - Pick clients report physical truth once.
 * - The backend owns Problem Center task creation.
 * - Allocation-backed Pick exceptions carry reservation_allocation_id.
 * - Clients do not mint a second Problem Center incident.
 */
import fs from 'fs';
import path from 'path';
import ts from 'typescript';

function source(relative: string) {
  const filename = path.resolve(__dirname, '../..', relative);
  return ts.createSourceFile(
    filename,
    fs.readFileSync(filename, 'utf8'),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX
  );
}

function nodes(root: ts.Node, predicate: (n: ts.Node) => boolean): ts.Node[] {
  const found: ts.Node[] = [];
  const walk = (n: ts.Node) => {
    if (predicate(n)) found.push(n);
    ts.forEachChild(n, walk);
  };
  walk(root);
  return found;
}

function variable(root: ts.Node, name: string): ts.VariableDeclaration {
  const matches = nodes(
    root,
    n => ts.isVariableDeclaration(n) && n.name.getText() === name
  );
  if (matches.length !== 1) {
    throw new Error(`Expected one declaration of ${name}, got ${matches.length}`);
  }
  return matches[0] as ts.VariableDeclaration;
}

function propertyNames(node: ts.ObjectLiteralExpression): string[] {
  return node.properties
    .filter(ts.isPropertyAssignment)
    .map(p => p.name.getText().replace(/['"]/g, ''));
}

/**
 * CI-CORRECTION-003 (F2) — resolve a call argument to its object literal.
 * Identifiers are resolved by scope, never by name across the file: walk the
 * call's enclosing blocks outward; the first block that declares the name
 * decides. It must be a single `const` declaration appearing before the call,
 * the name must never be reassigned in that block, and its initializer (after
 * an optional `as`/`satisfies`) must be an object literal. Otherwise throw.
 */
function resolvePayload(call: ts.CallExpression, arg: ts.Expression | undefined): ts.Node {
  if (!arg) throw new Error('onReportException has no payload argument');
  if (ts.isObjectLiteralExpression(arg)) return arg;
  if (!ts.isIdentifier(arg)) throw new Error(`Unresolvable payload: ${arg.getText()}`);
  const name = arg.text;
  for (let scope: ts.Node | undefined = call.parent; scope; scope = scope.parent) {
    if (!ts.isBlock(scope) && !ts.isSourceFile(scope)) continue;
    const decls: ts.VariableDeclaration[] = [];
    for (const statement of scope.statements) {
      if (!ts.isVariableStatement(statement)) continue;
      for (const d of statement.declarationList.declarations) {
        if (ts.isIdentifier(d.name) && d.name.text === name) decls.push(d);
      }
    }
    if (decls.length === 0) continue;
    if (decls.length !== 1) throw new Error(`Ambiguous payload ${name}: ${decls.length} declarations in one block`);
    const decl = decls[0];
    const list = decl.parent as ts.VariableDeclarationList;
    if (!(list.flags & ts.NodeFlags.Const)) throw new Error(`Payload ${name} is not const`);
    if (decl.getStart() >= call.getStart()) throw new Error(`Payload ${name} is declared after the call`);
    const reassigned = nodes(scope, n =>
      ts.isBinaryExpression(n) && n.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
      ts.isIdentifier(n.left) && n.left.text === name);
    if (reassigned.length > 0) throw new Error(`Payload ${name} is reassigned`);
    let init: ts.Expression | undefined = decl.initializer;
    while (init && (ts.isAsExpression(init) || ts.isSatisfiesExpression(init) || ts.isParenthesizedExpression(init))) init = init.expression;
    if (!init || !ts.isObjectLiteralExpression(init)) throw new Error(`Payload ${name} is not an object literal`);
    return init;
  }
  throw new Error(`Payload ${name} has no declaration in an enclosing block`);
}

const web = source('modules/wms/src/ui/pages/PickSessionPage.tsx');
const mobile = source('apps/mobile/src/screens/PickBriefScreen.tsx');

it('web Pick exposes exactly the five operator exception types', () => {
  const labels = variable(web, 'EXCEPTION_LABELS').initializer!;
  expect(ts.isObjectLiteralExpression(labels)).toBe(true);

  const keys = (labels as ts.ObjectLiteralExpression).properties
    .map(p => p.name!.getText().replace(/['"]/g, ''))
    .sort();

  expect(keys).toEqual([
    'item_missing',
    'short_pick',
    'product_defect',
    'packaging_defect',
    'wrong_item',
  ].sort());
});

it('web Pick exception report forwards allocation identity and physical quantity context', () => {
  const reports = (nodes(web, ts.isCallExpression) as ts.CallExpression[])
    .filter(c => c.expression.getText() === 'onReportException');

  expect(reports).toHaveLength(1);

  // CI-CORRECTION-003 (F2) — the payload is either an inline object literal or
  // an identifier resolved through its enclosing blocks to exactly one `const`
  // declaration (declared before the call, never reassigned) whose initializer is
  // an object literal. Anything else fails closed.
  const payload = resolvePayload(reports[0], reports[0].arguments[0]);
  expect(ts.isObjectLiteralExpression(payload)).toBe(true);

  const names = propertyNames(payload as ts.ObjectLiteralExpression);

  expect(names).toEqual(expect.arrayContaining([
    'lasyncro_line_item_id',
    'lasyncro_variant_id',
    'reservation_allocation_id',
    'exception_type',
    'stage',
    'quantity_required',
    'quantity_found',
  ]));
});

it('web Pick exception submission does not create a standalone Problem Center task', () => {
  const calls = nodes(web, ts.isCallExpression) as ts.CallExpression[];

  expect(
    calls.filter(c => c.expression.getText() === 'onCreateProblemTask')
  ).toHaveLength(0);
});

it('mobile Pick sends one exception report with allocation identity and physical quantity context', () => {
  const handler = variable(mobile, 'handleExceptionReport');

  const posts = (nodes(handler, ts.isCallExpression) as ts.CallExpression[])
    .filter(c =>
      ts.isPropertyAccessExpression(c.expression) &&
      c.expression.name.text === 'post' &&
      c.expression.expression.getText() === 'apiClient'
    );

  const exceptionPosts = posts.filter(c =>
    c.arguments[0]?.getText().includes('/exception')
  );

  expect(exceptionPosts).toHaveLength(1);

  const payload = exceptionPosts[0].arguments[1];
  expect(ts.isObjectLiteralExpression(payload)).toBe(true);

  const names = propertyNames(payload as ts.ObjectLiteralExpression);

  expect(names).toEqual(expect.arrayContaining([
    'lasyncro_line_item_id',
    'lasyncro_variant_id',
    'reservation_allocation_id',
    'exception_type',
    'stage',
    'quantity_required',
    'quantity_found',
  ]));
});

it('mobile Pick exception submission does not create a standalone Problem Center task', () => {
  const handler = variable(mobile, 'handleExceptionReport');

  const posts = (nodes(handler, ts.isCallExpression) as ts.CallExpression[])
    .filter(c =>
      ts.isPropertyAccessExpression(c.expression) &&
      c.expression.name.text === 'post' &&
      c.expression.expression.getText() === 'apiClient'
    );

  expect(
    posts.filter(c =>
      c.arguments[0]?.getText().includes('/problem-center')
    )
  ).toHaveLength(0);
});

it('WMS query builders never directly UPDATE immutable pick reservation allocations', () => {
  const serviceDir = path.resolve(
    __dirname,
    '../../apps/backend/src/services/wms'
  );

  const files = fs.readdirSync(serviceDir)
    .filter(f => f.endsWith('.ts'))
    .map(f => `apps/backend/src/services/wms/${f}`);

  files.push('apps/backend/src/api/wms/wms.controller.ts');

  const violations: string[] = [];

  for (const file of files) {
    const ast = source(file);

    for (const node of nodes(ast, ts.isCallExpression) as ts.CallExpression[]) {
      if (
        !ts.isPropertyAccessExpression(node.expression) ||
        node.expression.name.text !== 'update'
      ) {
        continue;
      }

      let receiver: ts.Expression = node.expression.expression;

      while (
        ts.isCallExpression(receiver) &&
        ts.isPropertyAccessExpression(receiver.expression)
      ) {
        receiver = receiver.expression.expression;
      }

      if (
        ts.isCallExpression(receiver) &&
        receiver.arguments.some(
          a =>
            ts.isStringLiteral(a) &&
            a.text.split(/\s+/)[0] === 'pick_reservation_allocations'
        )
      ) {
        violations.push(
          `${file}:${ast.getLineAndCharacterOfPosition(node.getStart()).line + 1}`
        );
      }
    }
  }

  expect(violations).toEqual([]);
});
