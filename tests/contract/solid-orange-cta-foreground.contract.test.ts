import fs from 'fs';
import path from 'path';
import ts from 'typescript';

const SOURCE_ROOTS = ['apps/frontend/src', 'modules'];
const ACCENT_FILL = 'var(--accent)';
const ACCENT_INK = 'var(--accent-ink)';

function collectTsxFiles(root: string): string[] {
  const files: string[] = [];

  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    if (entry.name === 'dist' || entry.name === 'node_modules') continue;

    const entryPath = path.join(root, entry.name);
    if (entry.isDirectory()) files.push(...collectTsxFiles(entryPath));
    else if (entry.name.endsWith('.tsx')) files.push(entryPath);
  }

  return files;
}

function jsxAttribute(
  node: ts.JsxOpeningLikeElement,
  name: string,
): ts.JsxAttribute | undefined {
  return node.attributes.properties.find(
    (attribute): attribute is ts.JsxAttribute =>
      ts.isJsxAttribute(attribute) && attribute.name.getText() === name,
  );
}

function objectProperty(
  object: ts.ObjectLiteralExpression,
  names: string[],
): ts.PropertyAssignment | undefined {
  return object.properties.find(
    (property): property is ts.PropertyAssignment =>
      ts.isPropertyAssignment(property) &&
      names.includes(property.name.getText().replace(/["']/g, '')),
  );
}

describe('solid-orange CTA foreground contract', () => {
  it('uses --accent-ink on inline interactive --accent fills app-wide', () => {
    const violations: string[] = [];

    for (const file of SOURCE_ROOTS.flatMap(collectTsxFiles)) {
      const sourceText = fs.readFileSync(file, 'utf8');
      const source = ts.createSourceFile(
        file,
        sourceText,
        ts.ScriptTarget.Latest,
        true,
        ts.ScriptKind.TSX,
      );

      const visit = (node: ts.Node): void => {
        if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
          const tag = node.tagName.getText(source);
          const component = jsxAttribute(node, 'component')?.initializer?.getText(source);
          const interactive =
            tag === 'Button' ||
            Boolean(jsxAttribute(node, 'onClick')) ||
            Boolean(jsxAttribute(node, 'href')) ||
            Boolean(jsxAttribute(node, 'to')) ||
            component === '"button"' ||
            component === "'button'" ||
            component === '"a"' ||
            component === "'a'";
          const sx = jsxAttribute(node, 'sx');
          const expression =
            sx?.initializer && ts.isJsxExpression(sx.initializer)
              ? sx.initializer.expression
              : undefined;

          if (interactive && expression && ts.isObjectLiteralExpression(expression)) {
            const fill = objectProperty(expression, ['bgcolor', 'background', 'backgroundColor']);
            const foreground = objectProperty(expression, ['color']);

            if (
              fill?.initializer.getText(source).includes(ACCENT_FILL) &&
              !foreground?.initializer.getText(source).includes(ACCENT_INK)
            ) {
              const { line } = source.getLineAndCharacterOfPosition(node.getStart(source));
              violations.push(`${file}:${line + 1}`);
            }
          }
        }

        ts.forEachChild(node, visit);
      };

      visit(source);
    }

    expect(violations).toEqual([]);
  });
});
