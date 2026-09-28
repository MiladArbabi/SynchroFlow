// tests/unit/ui/shared/OperationalContextShell.architecture.contract.test.ts
//
// SCREEN-ARCH RED — REQUIRED architecture/static contract.
//
// The shared OperationalContextShell owns composition only (primary
// workspace + secondary rail + rail suppression). It must not read the app
// shell's Ops Console state or know about any operational domain: whether
// the rail is suppressed is decided by the caller and passed in as a prop.
// Plain source-text scan, matching this repo's existing
// *.architecture.contract.test.ts convention.
//
// Deliberately RED while the shared source file does not exist.

import fs from 'fs';
import path from 'path';

const REPO = path.resolve(__dirname, '../../../..');
const SHELL_FILE = 'modules/shared/src/ui/OperationalContextShell.tsx';

function readSource(relPath: string): string {
  const abs = path.join(REPO, relPath);
  if (!fs.existsSync(abs)) {
    throw new Error(`[EXPECTED] ${relPath} must exist — canonical shared OperationalContextShell.`);
  }
  return fs.readFileSync(abs, 'utf8');
}

/** Comments may name forbidden neighbours for documentation; code may not. */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

function importSpecifiers(source: string): string[] {
  const specifiers: string[] = [];
  const pattern = /(?:\bfrom\s+|\bimport\s*\(\s*|\brequire\(\s*|^\s*import\s+)['"]([^'"]+)['"]/gm;
  for (const match of source.matchAll(pattern)) specifiers.push(match[1]);
  return specifiers;
}

describe('shared OperationalContextShell — architecture boundary', () => {
  it('exists as a shared source file', () => {
    expect(fs.existsSync(path.join(REPO, SHELL_FILE))).toBe(true);
  });

  it('does not import or reference ConfigContext / useConfig / Ops Console state', () => {
    const code = stripComments(readSource(SHELL_FILE));

    for (const spec of importSpecifiers(code)) {
      expect(spec).not.toMatch(/ConfigContext|useConfig|OpsConsole/i);
    }
    expect(code).not.toMatch(/\b(ConfigContext|ConfigProvider|useConfig|OpsConsole|isOpsConsoleOpen|SET_OPS_CONSOLE)\b/);
  });

  it('does not import Overview, Orders, or Inventory domain code', () => {
    const code = stripComments(readSource(SHELL_FILE));

    for (const spec of importSpecifiers(code)) {
      expect(spec).not.toMatch(/overview/i);
      expect(spec).not.toMatch(/order-nexus|(^|\/)orders?(\/|$)|OrdersModule/i);
      expect(spec).not.toMatch(/inventory/i);
    }
    expect(code).not.toMatch(/\b(OverviewModuleFT2|OrdersModuleFT2|OperationsPulse|OrderHealth)\b/);
  });

  it('does not import domain/API services or data-fetching', () => {
    const code = stripComments(readSource(SHELL_FILE));

    for (const spec of importSpecifiers(code)) {
      expect(spec).not.toMatch(/(^|\/)services?(\/|$)|(^|\/)api(\/|$)|axios|@tanstack\/react-query|contexts?\//i);
    }
    expect(code).not.toMatch(/\b(fetch|useQuery|useMutation|useNavigate)\s*\(/);
  });
});
