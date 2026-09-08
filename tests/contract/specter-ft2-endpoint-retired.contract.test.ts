// SEC-SPECTER-FT2-UNAUTH-01
//
// ARCHITECTURE CONTRACT — the unauthenticated Specter FT2 probe must not be
// wired into the mounted router. PERMANENT, authored RED.
// ===========================================================================
// WHY STATIC COVERAGE IS NEEDED ALONGSIDE THE API TEST
//   The API test proves the endpoint answers 404 today. It cannot prove the
//   route registration and the client-controlled tenant selector are gone from
//   source — someone could reintroduce the handler behind a different path, or
//   leave the `x-test-shop-id` pattern in place for a future caller to reuse.
//
// WHAT THIS PROVES (future GREEN)
//   1. specter.routes.ts registers no '/ft2' route
//   2. the mounted router carries no dependency on httpGetSpecterFt2
//   3. no production `x-test-shop-id` tenant-selection path remains for this
//      endpoint
//
// SCOPE — /ft2 ONLY.
//   Broader Specter removal is NOT required here. The authenticated /state and
//   /config routes are explicitly out of scope for this security slice, and a
//   CONTROL below asserts they survive so this contract can never be satisfied
//   by deleting Specter wholesale.
//
// MECHANISM
//   Route registration and handler references are read from the TypeScript AST,
//   not by grep: a path string or a symbol name appearing inside a comment must
//   never satisfy — or violate — this contract.

import fs from 'fs';
import path from 'path';
import ts from 'typescript';

const REPO = path.resolve(__dirname, '../..');

const SPECTER_ROUTES = 'apps/backend/src/api/specter/specter.routes.ts';
const SPECTER_FT2_CONTROLLER = 'apps/backend/src/api/specter/specter.ft2.controller.ts';

const TENANT_HEADER = 'x-test-shop-id';

const readIfPresent = (rel: string): string | null => {
  const abs = path.join(REPO, rel);
  return fs.existsSync(abs) ? fs.readFileSync(abs, 'utf8') : null;
};

/**
 * Parses an Express router module and reports the registered route paths and
 * the handler identifiers referenced in each registration.
 *
 * Only real CallExpressions of the shape router.<method>('<path>', ...handlers)
 * are collected, so commented-out registrations are invisible.
 */
export function analyzeRouterRegistrations(
  fileName: string,
  sourceText: string
): {
  paths: string[];
  handlersByPath: Record<string, string[]>;
  importedNames: string[];
} {
  const src = ts.createSourceFile(fileName, sourceText, ts.ScriptTarget.Latest, true);

  const paths: string[] = [];
  const handlersByPath: Record<string, string[]> = {};
  const importedNames: string[] = [];

  const HTTP_METHODS = new Set(['get', 'post', 'put', 'patch', 'delete', 'all', 'options', 'head']);

  const visit = (node: ts.Node) => {
    if (ts.isImportDeclaration(node) && node.importClause?.namedBindings) {
      const bindings = node.importClause.namedBindings;
      if (ts.isNamedImports(bindings)) {
        for (const el of bindings.elements) importedNames.push(el.name.text);
      }
    }

    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      HTTP_METHODS.has(node.expression.name.text)
    ) {
      const first = node.arguments[0];
      if (first && ts.isStringLiteralLike(first)) {
        const routePath = first.text;
        paths.push(routePath);

        const handlers: string[] = [];
        for (const arg of node.arguments.slice(1)) {
          const collect = (n: ts.Node) => {
            if (ts.isIdentifier(n)) handlers.push(n.text);
            ts.forEachChild(n, collect);
          };
          collect(arg);
        }
        handlersByPath[routePath] = [
          ...(handlersByPath[routePath] ?? []),
          ...handlers,
        ];
      }
    }

    ts.forEachChild(node, visit);
  };
  visit(src);

  return { paths, handlersByPath, importedNames };
}

// --- synthetic sources for scanner self-verification -----------------------

const ROUTER_WITH_FT2 = `
  import { getSpecterState } from './specter.controller.js';
  import { httpGetSpecterFt2 } from './specter.ft2.controller.js';
  const router = Router();
  router.get('/state', authenticateToken, requireTier('growth'), getSpecterState);
  router.get('/ft2', httpGetSpecterFt2);
  export default router;
`;

const ROUTER_WITHOUT_FT2 = `
  import { getSpecterState } from './specter.controller.js';
  const router = Router();
  router.get('/state', authenticateToken, requireTier('growth'), getSpecterState);
  // router.get('/ft2', httpGetSpecterFt2);  <- retired, must not count
  // httpGetSpecterFt2 is gone; this mention is a comment only.
  export default router;
`;

describe('SEC-SPECTER-FT2-UNAUTH-01 — the Specter FT2 probe must not be wired', () => {
  // ── Scanner self-verification: green BEFORE and AFTER the fix ────────────
  describe('SCANNER: route/handler analysis is real, and comments never count', () => {
    it('detects a live /ft2 registration and its handler', () => {
      const r = analyzeRouterRegistrations('synthetic-with-ft2.ts', ROUTER_WITH_FT2);

      expect(r.paths).toContain('/ft2');
      expect(r.handlersByPath['/ft2']).toContain('httpGetSpecterFt2');
      expect(r.importedNames).toContain('httpGetSpecterFt2');
    });

    it('does NOT count a commented-out /ft2 registration or a commented symbol', () => {
      const r = analyzeRouterRegistrations('synthetic-without-ft2.ts', ROUTER_WITHOUT_FT2);

      expect(r.paths).not.toContain('/ft2');
      expect(r.importedNames).not.toContain('httpGetSpecterFt2');
      // …while still seeing the surviving authenticated route.
      expect(r.paths).toContain('/state');
    });
  });

  // ── CONTROL — must pass before and after the fix ─────────────────────────
  it('CONTROL: the authenticated Specter routes stay in scope and are untouched', () => {
    const source = readIfPresent(SPECTER_ROUTES);
    expect(source).not.toBeNull();

    const r = analyzeRouterRegistrations(SPECTER_ROUTES, source!);

    // Broader Specter removal is NOT required by this security slice. If these
    // disappeared, the /ft2 assertions below would pass for the wrong reason.
    expect(r.paths).toEqual(expect.arrayContaining(['/state', '/config']));
  });

  // ── ARCH-SEC-01 ─────────────────────────────────────────────────────────
  it('ARCH-SEC-01: specter.routes.ts registers no /ft2 route', () => {
    const source = readIfPresent(SPECTER_ROUTES);
    expect(source).not.toBeNull();

    const r = analyzeRouterRegistrations(SPECTER_ROUTES, source!);

    expect({ file: SPECTER_ROUTES, registeredPaths: r.paths }).toMatchObject({
      registeredPaths: expect.not.arrayContaining(['/ft2']),
    });
  });

  // ── ARCH-SEC-02 ─────────────────────────────────────────────────────────
  it('ARCH-SEC-02: the mounted router carries no dependency on httpGetSpecterFt2', () => {
    const source = readIfPresent(SPECTER_ROUTES);
    expect(source).not.toBeNull();

    const r = analyzeRouterRegistrations(SPECTER_ROUTES, source!);

    const referencedAnywhere = Object.values(r.handlersByPath)
      .flat()
      .includes('httpGetSpecterFt2');

    expect({
      importsHandler: r.importedNames.includes('httpGetSpecterFt2'),
      referencesHandler: referencedAnywhere,
    }).toEqual({ importsHandler: false, referencesHandler: false });
  });

  // ── ARCH-SEC-03 ─────────────────────────────────────────────────────────
  it('ARCH-SEC-03: no production x-test-shop-id tenant-selection path remains for this endpoint', () => {
    const controller = readIfPresent(SPECTER_FT2_CONTROLLER);

    // Retiring the endpoint may delete the controller outright — that
    // satisfies the contract. If it survives, it must no longer resolve the
    // tenant from a client-supplied test header.
    if (controller === null) {
      expect(controller).toBeNull();
      return;
    }

    expect({
      file: SPECTER_FT2_CONTROLLER,
      usesClientTenantHeader: controller.includes(TENANT_HEADER),
    }).toMatchObject({ usesClientTenantHeader: false });
  });
});
