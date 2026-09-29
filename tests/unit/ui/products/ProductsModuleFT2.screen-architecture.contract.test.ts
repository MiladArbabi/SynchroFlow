// tests/unit/ui/products/ProductsModuleFT2.screen-architecture.contract.test.ts
//
// SCREEN-ARCH RED — REQUIRED architecture/static contract.
//
// The Products map branch composes its primary workspace and Inventory state
// rail through the shared OperationalContextShell instead of a local fixed
// 280px rail. The shell's internal grid is owned by the shared shell tests
// and is deliberately not asserted here. Plain source-text scan, matching
// this repo's existing *.architecture.contract.test.ts convention.

import fs from 'fs';
import path from 'path';

const REPO = path.resolve(__dirname, '../../../..');
const MODULE_FILE = 'modules/products/src/ui/pages/ProductsModuleFT2.tsx';

/** Comments may name retired patterns for documentation; code may not. */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

function readCode(): string {
  return stripComments(fs.readFileSync(path.join(REPO, MODULE_FILE), 'utf8'));
}

describe('ProductsModuleFT2 — shared screen architecture', () => {
  it('imports OperationalContextShell', () => {
    expect(readCode()).toMatch(
      /\bimport\s+(?:type\s+)?\{[^}]*\bOperationalContextShell\b[^}]*\}\s*from\s*['"][^'"]+['"]/
    );
  });

  it('renders <OperationalContextShell', () => {
    expect(readCode()).toMatch(/<OperationalContextShell\b/);
  });

  it('does not keep the retired fixed 280px rail', () => {
    const code = readCode();

    expect(code).not.toMatch(/\blg\s*:\s*['"]0\s+0\s+280px['"]/);
    expect(code).not.toMatch(/\bwidth\s*:\s*\{[^}]*\blg\s*:\s*['"]?280(?:px)?['"]?/);
  });
});
