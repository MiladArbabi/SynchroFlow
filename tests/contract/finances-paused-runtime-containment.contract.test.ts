import fs from 'fs';
import path from 'path';

const ROOT = process.cwd();

function read(rel: string): string {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}

describe('COMMERCIAL-DEAD-SURFACE-01D-4 — paused Finances runtime containment', () => {
  const expressBootstrap = read('apps/backend/src/bootstrap/express.ts');
  const routesIndex = read('apps/backend/src/routes/index.ts');
  const exportsRoutes = read('apps/backend/src/api/exports/exports.routes.ts');
  const catalog = read('packages/commercial-policy/src/catalog.ts');

  it('does not mount Finances or Cash Flow from the Express bootstrap', () => {
    expect(expressBootstrap).not.toMatch(
      /app\.use\(\s*['"]\/api\/v1\/modules\/finances['"]/
    );

    expect(expressBootstrap).not.toMatch(
      /app\.use\(\s*['"]\/api\/v1\/modules\/cashflow['"]/
    );

    expect(expressBootstrap).not.toContain(
      "import financesRoutes from '../api/finances/finances.routes.js';"
    );

    expect(expressBootstrap).not.toContain(
      "import cashflowRoutes from '../api/cashflow/cashflow.routes.js';"
    );
  });

  it('does not mount the duplicate Finances route from routes/index', () => {
    expect(routesIndex).not.toMatch(
      /router\.use\(\s*['"]\/v1\/modules\/finances['"]/
    );

    expect(routesIndex).not.toContain(
      "import financesRoutes from '../api/finances/index.js';"
    );
  });

  it('does not expose the paused Finances CSV export route', () => {
    expect(exportsRoutes).not.toMatch(
      /router\.post\(\s*['"]\/finances['"]/
    );

    expect(exportsRoutes).not.toMatch(/\bexportFinances\b/);
  });

  it('preserves dormant Finances and Cash Flow implementation', () => {
    expect(
      fs.existsSync(
        path.join(ROOT, 'apps/backend/src/api/finances/finances.routes.ts')
      )
    ).toBe(true);

    expect(
      fs.existsSync(
        path.join(ROOT, 'apps/backend/src/api/cashflow/cashflow.routes.ts')
      )
    ).toBe(true);

    expect(
      fs.existsSync(path.join(ROOT, 'modules/finances'))
    ).toBe(true);

    expect(
      fs.existsSync(path.join(ROOT, 'modules/cashflow'))
    ).toBe(true);
  });

  it('preserves Finances commercial classification as paused', () => {
    expect(catalog).toMatch(
      /['"]finances\.core['"]\s*:\s*\{\s*status:\s*['"]paused['"]/
    );

    expect(catalog).toMatch(
      /['"]finances\.cashflow['"]\s*:\s*\{\s*status:\s*['"]paused['"]/
    );
  });
});
