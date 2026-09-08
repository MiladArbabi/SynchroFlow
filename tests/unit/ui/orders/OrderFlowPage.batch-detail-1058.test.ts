/**
 * GH-1058
 *
 * Fulfillment batch cards are entity-inspection controls:
 * - card click opens the exact batch detail
 * - Enter / Space provide equivalent keyboard access
 * - pending cancel remains an independent action and must not open detail
 */
import * as ts from 'typescript';
import { readFileSync } from 'fs';
import { resolve } from 'path';

it('GH-1058 — fulfillment batch card opens detail accessibly while cancel stays isolated', () => {
  const filename = resolve(
    __dirname,
    '../../../../apps/frontend/src/pages/ft2-pages/OrderFlowPage.tsx',
  );

  const source = ts.createSourceFile(
    filename,
    readFileSync(filename, 'utf8'),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );

  const descendants = (
    root: ts.Node,
    predicate: (node: ts.Node) => boolean,
  ): ts.Node[] => {
    const found: ts.Node[] = [];

    const visit = (node: ts.Node) => {
      if (predicate(node)) found.push(node);
      ts.forEachChild(node, visit);
    };

    visit(root);
    return found;
  };

  type Opening = ts.JsxOpeningElement | ts.JsxSelfClosingElement;

  const prop = (
    node: Opening,
    name: string,
  ): ts.JsxAttribute | undefined =>
    node.attributes.properties.find(
      (item): item is ts.JsxAttribute =>
        ts.isJsxAttribute(item) &&
        item.name.getText(source) === name,
    );

  const expressionProp = (
    node: Opening,
    name: string,
  ): ts.Expression | undefined => {
    const attribute = prop(node, name);

    return attribute?.initializer &&
      ts.isJsxExpression(attribute.initializer)
      ? attribute.initializer.expression
      : undefined;
  };

  const maps = descendants(
    source,
    (node) =>
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      node.expression.name.text === 'map' &&
      ts.isIdentifier(node.expression.expression) &&
      node.expression.expression.text === 'batches',
  ) as ts.CallExpression[];

  expect(maps).toHaveLength(1);

  const callback = maps[0].arguments[0];

  if (
    !ts.isArrowFunction(callback) &&
    !ts.isFunctionExpression(callback)
  ) {
    throw new Error('Missing batches.map callback');
  }

  const batchParameter = callback.parameters[0].name;

  if (!ts.isIdentifier(batchParameter)) {
    throw new Error('Missing batch callback parameter');
  }

  const openings = descendants(
    callback,
    (node) =>
      ts.isJsxOpeningElement(node) ||
      ts.isJsxSelfClosingElement(node),
  ) as Opening[];

  const cards = openings.filter((node) => {
    const key = expressionProp(node, 'key');

    return (
      key &&
      ts.isPropertyAccessExpression(key) &&
      ts.isIdentifier(key.expression) &&
      key.expression.text === batchParameter.text &&
      key.name.text === 'pick_batch_id'
    );
  });

  expect(cards).toHaveLength(1);

  const card = cards[0];

  // Semantic keyboard-inspection control.
  const role = prop(card, 'role');
  expect(
    role?.initializer &&
      ts.isStringLiteral(role.initializer) &&
      role.initializer.text,
  ).toBe('button');

  const tabIndex = expressionProp(card, 'tabIndex');
  expect(tabIndex?.getText(source)).toBe('0');

  // Pending cancel control must stay independent from opening the card.
  const controls = descendants(
    card.parent,
    (node) =>
      ts.isJsxOpeningElement(node) ||
      ts.isJsxSelfClosingElement(node),
  ) as Opening[];

  const cancelControls = controls.filter((node) => {
    const aria = prop(node, 'aria-label');
    return aria?.getText(source).includes('Cancel batch') ?? false;
  });

  expect(cancelControls).toHaveLength(1);

  const batch = {
    pick_batch_id: 'abcd1234-1058-batch',
    status: 'pending',
  };

  const setSelectedBatchId = jest.fn();
  const setCancelError = jest.fn();
  const setCancelConfirmBatchId = jest.fn();

  const compileHandler = (
    element: Opening,
    eventName: string,
  ) => {
    const handler = expressionProp(element, eventName);

    if (!handler) {
      throw new Error(`Missing ${eventName} handler`);
    }

    const javascript = ts.transpileModule(
      `const handler = ${handler.getText(source)};`,
      {
        compilerOptions: {
          target: ts.ScriptTarget.ES2020,
          module: ts.ModuleKind.None,
        },
      },
    ).outputText;

    return new Function(
      batchParameter.text,
      'setSelectedBatchId',
      'setCancelError',
      'setCancelConfirmBatchId',
      `${javascript}\nreturn handler;`,
    )(
      batch,
      setSelectedBatchId,
      setCancelError,
      setCancelConfirmBatchId,
    );
  };

  const cancelHandler = compileHandler(
    cancelControls[0],
    'onClick',
  );

  const cancelEvent = {
    stopPropagation: jest.fn(),
  };

  cancelHandler(cancelEvent);

  expect(cancelEvent.stopPropagation).toHaveBeenCalledTimes(1);
  expect(setCancelConfirmBatchId).toHaveBeenCalledTimes(1);
  expect(setSelectedBatchId).not.toHaveBeenCalled();

  // Mouse/card activation opens the exact batch.
  const clickHandler = compileHandler(card, 'onClick');

  clickHandler({});

  expect(setSelectedBatchId).toHaveBeenCalledTimes(1);
  expect(setSelectedBatchId).toHaveBeenLastCalledWith(
    batch.pick_batch_id,
  );

  setSelectedBatchId.mockClear();

  // Keyboard activation mirrors click.
  const keyHandler = compileHandler(card, 'onKeyDown');

  const enterEvent = {
    key: 'Enter',
    preventDefault: jest.fn(),
  };

  keyHandler(enterEvent);

  expect(enterEvent.preventDefault).toHaveBeenCalledTimes(1);
  expect(setSelectedBatchId).toHaveBeenCalledWith(
    batch.pick_batch_id,
  );

  setSelectedBatchId.mockClear();

  const spaceEvent = {
    key: ' ',
    preventDefault: jest.fn(),
  };

  keyHandler(spaceEvent);

  expect(spaceEvent.preventDefault).toHaveBeenCalledTimes(1);
  expect(setSelectedBatchId).toHaveBeenCalledWith(
    batch.pick_batch_id,
  );

  setSelectedBatchId.mockClear();

  keyHandler({
    key: 'Escape',
    preventDefault: jest.fn(),
  });

  expect(setSelectedBatchId).not.toHaveBeenCalled();
});

it('GH-1058 — selected batch uses EntityDetailModal and member-order navigation replaces it with Order Detail', () => {
  const filename = resolve(
    __dirname,
    '../../../../apps/frontend/src/pages/ft2-pages/OrderFlowPage.tsx',
  );
  const text = readFileSync(filename, 'utf8');

  expect(text).toContain(
    "import { BatchDetailModalBody } from './BatchDetailModalBody';",
  );

  expect(text).toContain(
    'const [selectedBatchId, setSelectedBatchId] = useState<string | null>(null);',
  );

  expect(text).toMatch(
    /const selectedBatch = .*batches\.find\(\(batch\) => batch\.pick_batch_id === selectedBatchId\)/s,
  );

  expect(text).toMatch(
    /<EntityDetailModal[\s\S]*?entityId=\{selectedBatchId\}[\s\S]*?title=\{`Batch \$\{selectedBatchId\?\.slice\(0, 8\)\.toUpperCase\(\) \?\? ''\}`\}[\s\S]*?<BatchDetailModalBody[\s\S]*?batch=\{selectedBatch\}[\s\S]*?onNavigateToOrder=\{\(orderId\) => \{[\s\S]*?setSelectedBatchId\(null\);[\s\S]*?setSelectedOrderId\(orderId\);[\s\S]*?\}\}[\s\S]*?<\/EntityDetailModal>/s,
  );

  // Existing Order Detail remains a separate shell, never a child of batch detail.
  expect(
    (text.match(/<EntityDetailModal/g) ?? []).length,
  ).toBeGreaterThanOrEqual(2);

  expect(text).toContain(
    'entityId={selectedOrderId}',
  );
});
