/** GH-1057: pool-row inspection is separate from selection and priority. */
import * as ts from 'typescript';
import { readFileSync } from 'fs';
import { resolve } from 'path';

it('GH-1057 — pool row opens Order Detail while checkbox and priority clicks remain isolated', () => {
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
  const maps = descendants(source, (node) => ts.isCallExpression(node) &&
    ts.isPropertyAccessExpression(node.expression) && node.expression.name.text === 'map' &&
    ts.isIdentifier(node.expression.expression) && node.expression.expression.text === 'visiblePool') as ts.CallExpression[];
  expect(maps).toHaveLength(1);
  const callback = maps[0].arguments[0];
  if (!ts.isArrowFunction(callback) && !ts.isFunctionExpression(callback)) throw new Error('Missing pool map callback');
  const orderParameter = callback.parameters[0].name;
  if (!ts.isIdentifier(orderParameter)) throw new Error('Missing pool order parameter');
  type Opening = ts.JsxOpeningElement | ts.JsxSelfClosingElement;
  const openings = descendants(callback, (node) => ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) as Opening[];
  const prop = (node: Opening, name: string): ts.Expression | undefined => {
    const attribute = node.attributes.properties.find((item) => ts.isJsxAttribute(item) && item.name.getText(source) === name);
    return attribute && ts.isJsxAttribute(attribute) && attribute.initializer && ts.isJsxExpression(attribute.initializer)
      ? attribute.initializer.expression : undefined;
  };
  const rows = openings.filter((node) => {
    const key = prop(node, 'key');
    return key && ts.isPropertyAccessExpression(key) && ts.isIdentifier(key.expression) &&
      key.expression.text === orderParameter.text && key.name.text === 'lasyncro_order_id';
  });
  expect(rows).toHaveLength(1);
  const row = rows[0];
  const controls = descendants(row.parent, (node) => ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) as Opening[];
  const checkboxes = controls.filter((node) => ts.isIdentifier(node.tagName) && node.tagName.text === 'Checkbox');
  expect(checkboxes).toHaveLength(1);
  const priorityControls = controls.filter((node) => {
    const handler = prop(node, 'onClick');
    return handler && descendants(handler, (child) => ts.isCallExpression(child) &&
      ts.isPropertyAccessExpression(child.expression) && ts.isIdentifier(child.expression.expression) &&
      child.expression.expression.text === 'setPriority' && child.expression.name.text === 'mutate').length > 0;
  });
  expect(priorityControls).toHaveLength(1);

  const order = { lasyncro_order_id: 'pool-order-1057', is_priority_flagged: false };
  const setSelectedOrderId = jest.fn();
  const toggleSelect = jest.fn();
  const setPriority = { mutate: jest.fn() };
  const execute = (element: Opening, eventName: string) => {
    const handler = prop(element, eventName);
    if (!handler) throw new Error(`Missing ${eventName} handler`);
    const javascript = ts.transpileModule(`const handler = ${handler.getText(source)};`, {
      compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.None },
    }).outputText;
    const run = new Function(orderParameter.text, 'setSelectedOrderId', 'toggleSelect', 'setPriority',
      `${javascript}\nreturn handler;`)(order, setSelectedOrderId, toggleSelect, setPriority);
    const event = { stopPropagation: jest.fn() };
    run(event);
    return event;
  };

  // Prove independent controls first so the expected row RED cannot hide them.
  const checkboxClick = execute(checkboxes[0], 'onClick');
  expect(checkboxClick.stopPropagation).toHaveBeenCalledTimes(1);
  const checkboxChange = execute(checkboxes[0], 'onChange');
  expect(checkboxChange.stopPropagation).toHaveBeenCalledTimes(1);
  expect(toggleSelect).toHaveBeenCalledTimes(1);
  expect(toggleSelect).toHaveBeenCalledWith(order.lasyncro_order_id);
  expect(setSelectedOrderId).not.toHaveBeenCalled();
  expect(setPriority.mutate).not.toHaveBeenCalled();
  toggleSelect.mockClear();

  const priorityClick = execute(priorityControls[0], 'onClick');
  expect(priorityClick.stopPropagation).toHaveBeenCalledTimes(1);
  expect(setPriority.mutate).toHaveBeenCalledTimes(1);
  expect(setPriority.mutate).toHaveBeenCalledWith({ orderId: order.lasyncro_order_id, flagged: true });
  expect(setSelectedOrderId).not.toHaveBeenCalled();
  expect(toggleSelect).not.toHaveBeenCalled();
  setPriority.mutate.mockClear();

  execute(row, 'onClick');
  expect({
    orderDetailCalls: setSelectedOrderId.mock.calls,
    selectionCalls: toggleSelect.mock.calls,
    priorityCalls: setPriority.mutate.mock.calls,
  }).toEqual({
    orderDetailCalls: [[order.lasyncro_order_id]],
    selectionCalls: [],
    priorityCalls: [],
  });
});
