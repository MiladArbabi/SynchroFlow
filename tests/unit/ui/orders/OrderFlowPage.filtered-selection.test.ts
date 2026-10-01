/**
 * Order Flow D4 — Order Pool selection belongs to the current FILTERED working set.
 *
 * Executes the real OrderFlowPage source expressions (toggleSelectAll, the header
 * Checkbox checked/indeterminate props, the release payload's priority_order_ids)
 * against synthetic pool states. Component-level consts referenced by those
 * expressions are resolved lazily from source (useMemo factories are invoked,
 * useCallback functions returned) unless the test supplies the state directly.
 */
import * as ts from 'typescript';
import { readFileSync } from 'fs';
import { resolve } from 'path';

type Order = { lasyncro_order_id: string };

const filename = resolve(__dirname, '../../../../apps/frontend/src/pages/ft2-pages/OrderFlowPage.tsx');
const source = ts.createSourceFile(filename, readFileSync(filename, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);

const descendants = (root: ts.Node, predicate: (node: ts.Node) => boolean): ts.Node[] => {
  const found: ts.Node[] = [];
  const visit = (node: ts.Node) => {
    if (predicate(node)) found.push(node);
    ts.forEachChild(node, visit);
  };
  visit(root);
  return found;
};

const component = source.statements.find((node): node is ts.FunctionDeclaration =>
  ts.isFunctionDeclaration(node) && node.name?.text === 'OrderFlowPage');
if (!component?.body) throw new Error('Missing OrderFlowPage component');
const componentBody = component.body;

const declarations = new Map<string, ts.Expression>();
for (const statement of componentBody.statements) {
  if (!ts.isVariableStatement(statement)) continue;
  for (const declaration of statement.declarationList.declarations) {
    if (ts.isIdentifier(declaration.name) && declaration.initializer) {
      declarations.set(declaration.name.text, declaration.initializer);
    }
  }
}

const calleeName = (node: ts.Node): string | undefined =>
  ts.isCallExpression(node) && ts.isIdentifier(node.expression) ? node.expression.text : undefined;

const selectionEffects = componentBody.statements
  .filter(ts.isExpressionStatement)
  .map((statement) => statement.expression)
  .filter((expression): expression is ts.CallExpression =>
    calleeName(expression) === 'useEffect' && expression.getText(source).includes('setSelected'));

type Opening = ts.JsxOpeningElement | ts.JsxSelfClosingElement;
const prop = (node: Opening, name: string): ts.Expression | undefined => {
  const attribute = node.attributes.properties.find((item) => ts.isJsxAttribute(item) && item.name.getText(source) === name);
  return attribute && ts.isJsxAttribute(attribute) && attribute.initializer && ts.isJsxExpression(attribute.initializer)
    ? attribute.initializer.expression : undefined;
};

const headerCheckboxes = descendants(componentBody, (node) =>
  (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) &&
  ts.isIdentifier(node.tagName) && node.tagName.text === 'Checkbox' &&
  prop(node, 'onChange')?.getText(source) === 'toggleSelectAll') as Opening[];

const handleRelease = declarations.get('handleRelease');
const priorityOrderIds = handleRelease
  ? descendants(handleRelease, (node) => ts.isPropertyAssignment(node) && node.name.getText(source) === 'priority_order_ids') as ts.PropertyAssignment[]
  : [];
const releaseExclusive = handleRelease
  ? descendants(handleRelease, (node) => ts.isPropertyAssignment(node) && node.name.getText(source) === 'exclusive') as ts.PropertyAssignment[]
  : [];

type Base = {
  poolOrders: Order[];
  filteredPool: Order[];
  sortedPool?: Order[];
  visiblePool?: Order[];
  selected: Set<string>;
};

/** Mirrors useState for `selected`: setSelected applies updaters to the held value. */
const harness = (base: Base) => {
  let selected = base.selected;
  const setSelected = (update: Set<string> | ((prev: Set<string>) => Set<string>)) => {
    selected = typeof update === 'function' ? update(selected) : update;
  };

  const scope = () => {
    const cache = new Map<string, unknown>(Object.entries({
      poolOrders: base.poolOrders,
      filteredPool: base.filteredPool,
      sortedPool: base.sortedPool ?? base.filteredPool,
      visiblePool: base.visiblePool ?? base.sortedPool ?? base.filteredPool,
      selected,
      setSelected,
    }));
    const evaluate = (node: ts.Expression): unknown => {
      const javascript = ts.transpileModule(`const __value = (${node.getText(source)});`, {
        compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.None },
      }).outputText;
      // Sloppy-mode `with` resolves component-level identifiers through the proxy below.
      return new Function('__scope', `with (__scope) { ${javascript}\nreturn __value; }`)(proxy);
    };
    const resolveDeclaration = (name: string): unknown => {
      const initializer = declarations.get(name)!;
      const hook = calleeName(initializer);
      if (hook === 'useMemo') return (evaluate((initializer as ts.CallExpression).arguments[0]) as () => unknown)();
      if (hook === 'useCallback') return evaluate((initializer as ts.CallExpression).arguments[0]);
      if (hook?.startsWith('use')) throw new Error(`Unsupported hook initializer for ${name}: ${hook}`);
      return evaluate(initializer);
    };
    const proxy: object = new Proxy({}, {
      has: (_target, key) => typeof key === 'string' && (cache.has(key) || declarations.has(key)),
      get: (_target, key) => {
        if (typeof key !== 'string') return undefined;
        if (!cache.has(key)) cache.set(key, resolveDeclaration(key));
        return cache.get(key);
      },
    });
    return { evaluate, get: (name: string) => (proxy as Record<string, unknown>)[name] };
  };

  return {
    get selected() { return selected; },
    scope,
    /** Commit: run the effects that write selection, as React would after a render with this state. */
    runSelectionEffects() {
      const current = scope();
      for (const effect of selectionEffects) (current.evaluate(effect.arguments[0]) as () => unknown)();
    },
  };
};

const A: Order = { lasyncro_order_id: 'order-A' };
const B: Order = { lasyncro_order_id: 'order-B' };
const C: Order = { lasyncro_order_id: 'order-C' };
const ids = (value: Iterable<string> | undefined) => [...(value ?? [])].sort();

const headerState = (base: Base) => {
  expect(headerCheckboxes).toHaveLength(1);
  const current = harness(base).scope();
  return {
    checked: current.evaluate(prop(headerCheckboxes[0], 'checked')!),
    indeterminate: current.evaluate(prop(headerCheckboxes[0], 'indeterminate')!),
  };
};

describe('Order Flow D4 — pool selection scope is the filtered working set', () => {
  it('CASE A — header Select All selects filteredPool, not orders hidden by search/filter', () => {
    const state = harness({ poolOrders: [A, B, C], filteredPool: [A, C], selected: new Set() });
    (state.scope().get('toggleSelectAll') as () => void)();
    expect(ids(state.selected)).toEqual(['order-A', 'order-C']);
  });

  it('CASE B — every filtered order selected → checked, not indeterminate; hidden B ignored', () => {
    expect(headerState({ poolOrders: [A, B, C], filteredPool: [A, C], selected: new Set(['order-A', 'order-C']) }))
      .toEqual({ checked: true, indeterminate: false });
  });

  it('CASE C — some filtered orders selected → indeterminate, not checked', () => {
    expect(headerState({ poolOrders: [A, B, C], filteredPool: [A, C], selected: new Set(['order-A']) }))
      .toEqual({ checked: false, indeterminate: true });
  });

  it('CASE D — a selection hidden by filter narrowing is no longer releasable', () => {
    expect(priorityOrderIds).toHaveLength(1);
    // Before filter: A and B selected. Filter then narrows filteredPool to [A].
    const state = harness({ poolOrders: [A, B, C], filteredPool: [A], selected: new Set(['order-A', 'order-B']) });
    // Pre-effect: the stale Set still holds B, yet the release payload must already exclude it.
    const releasableBeforeEffect = state.scope().evaluate(priorityOrderIds[0].initializer) as string[] | undefined;
    expect(ids(releasableBeforeEffect)).toEqual(['order-A']);
    // Post-effect: reconciliation prunes B from the selected state itself.
    state.runSelectionEffects();
    expect(ids(state.selected)).toEqual(['order-A']);
    const releasable = state.scope().evaluate(priorityOrderIds[0].initializer) as string[] | undefined;
    expect(ids(releasable)).toEqual(['order-A']);
  });

  it('CASE E — pagination is not selection scope: Select All covers every filtered page', () => {
    const state = harness({
      poolOrders: [A, B, C],
      filteredPool: [A, B, C],
      sortedPool: [A, B, C],
      visiblePool: [A],
      selected: new Set(),
    });
    (state.scope().get('toggleSelectAll') as () => void)();
    expect(ids(state.selected)).toEqual(['order-A', 'order-B', 'order-C']);
  });

  /** Wave preview + the Release request handleRelease would send, from one render's state. */
  const releaseAll = (base: Base) => {
    expect(priorityOrderIds).toHaveLength(1);
    expect(releaseExclusive).toHaveLength(1);
    const current = harness(base).scope();
    return {
      waveOrders: current.get('waveOrders'),
      waveSourceIds: ids((current.get('waveSource') as Order[]).map((order) => order.lasyncro_order_id)),
      priority_order_ids: current.evaluate(priorityOrderIds[0].initializer) as string[] | undefined,
      exclusive: current.evaluate(releaseExclusive[0].initializer),
    };
  };

  it('CASE F — filtered "Release all" releases only the filtered working set; hidden B unreachable', () => {
    const release = releaseAll({ poolOrders: [A, B, C], filteredPool: [A, C], selected: new Set() });
    expect(release.waveOrders).toBe(2);
    expect(release.waveSourceIds).toEqual(['order-A', 'order-C']);
    expect(release.priority_order_ids).toBeDefined();
    expect(ids(release.priority_order_ids)).toEqual(['order-A', 'order-C']);
    expect(release.exclusive).toBe(true);
  });

  it('CASE F guard — unfiltered "Release all" keeps backend Release All semantics', () => {
    const release = releaseAll({ poolOrders: [A, B, C], filteredPool: [A, B, C], selected: new Set() });
    expect(release.waveOrders).toBe(3);
    expect(release.waveSourceIds).toEqual(['order-A', 'order-B', 'order-C']);
    expect(release.priority_order_ids).toBeUndefined();
    expect(release.exclusive).toBeUndefined();
  });
});
