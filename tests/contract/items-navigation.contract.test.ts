// GH-1208 RED-A: public Inventory destinations, not source formatting.
import fs from 'fs';
import path from 'path';
import ts from 'typescript';
import { INVENTORY_MODULE_TABS } from '../../apps/frontend/src/pages/ft2-pages/inventoryModuleTabs';

function property(object: ts.ObjectLiteralExpression, name: string) {
  return object.properties.find(
    (node): node is ts.PropertyAssignment =>
      ts.isPropertyAssignment(node) && node.name.getText() === name,
  )?.initializer;
}

function inventoryNavChildren() {
  const file = path.resolve(__dirname, '../../apps/frontend/src/runtime/navBootstrap.ts');
  const source = ts.createSourceFile(file, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);
  let inventory: ts.ObjectLiteralExpression | undefined;
  function visit(node: ts.Node) {
    if (ts.isCallExpression(node) && node.expression.getText(source) === 'registerNavItem') {
      const object = node.arguments[0];
      if (object && ts.isObjectLiteralExpression(object)) {
        const id = property(object, 'id');
        if (id && ts.isStringLiteral(id) && id.text === 'inventory') inventory = object;
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
  if (!inventory) throw new Error('Existing Inventory nav registration not found');
  const children = property(inventory, 'children');
  if (!children || !ts.isArrayLiteralExpression(children)) {
    throw new Error('Existing Inventory nav children are not an array');
  }
  return children.elements.map((child) => {
    if (!ts.isObjectLiteralExpression(child)) throw new Error('Unsupported nav child');
    const title = property(child, 'title');
    const destination = property(child, 'path');
    if (!title || !ts.isStringLiteral(title) || !destination || !ts.isStringLiteral(destination)) {
      throw new Error('Existing nav child lacks a literal title/path');
    }
    return { label: title.text, path: destination.text };
  });
}

describe('GH-1208 Inventory destination contract', () => {
  it('module tabs retain Intelligence, expose canonical Items and retire legacy target destinations', () => {
    const labels = INVENTORY_MODULE_TABS.map(({ label }) => label);
    const paths = INVENTORY_MODULE_TABS.map(({ path }) => path);
    expect(labels).toContain('Intelligence');
    expect(INVENTORY_MODULE_TABS).toEqual(expect.arrayContaining([
      expect.objectContaining({ label: 'Items', path: '/inventory/items' }),
    ]));
    expect(labels).not.toContain('Catalog');
    expect(labels).not.toContain('Costs');
    expect(labels).not.toContain('Data Quality');
    expect(paths).not.toContain('/inventory/catalog');
    expect(paths).not.toContain('/inventory/costs');
    expect(paths).not.toContain('/inventory/data-quality');
  });

  it('Inventory sidenav retains Intelligence, exposes canonical Items and retires legacy target destinations', () => {
    const children = inventoryNavChildren();
    const labels = children.map(({ label }) => label);
    const paths = children.map(({ path }) => path);
    expect(labels).toContain('Intelligence');
    expect(children).toEqual(expect.arrayContaining([
      expect.objectContaining({ label: 'Items', path: '/inventory/items' }),
    ]));
    expect(labels).not.toContain('Catalog');
    expect(labels).not.toContain('Costs');
    expect(labels).not.toContain('Data Quality');
    expect(paths).not.toContain('/inventory/catalog');
    expect(paths).not.toContain('/inventory/costs');
    expect(paths).not.toContain('/inventory/data-quality');
  });
});
