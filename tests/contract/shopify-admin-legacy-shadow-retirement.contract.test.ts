/** CERT-4K: intentional RED until physical legacy ACCESS shadows can be retired.
 * Source-only analysis: never import application modules or execute DB/provider code.
 * Unlike CERT-4J, unreachable compatibility, retired islands and seeds are in scope.
 */
import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

const root = path.resolve(__dirname, '../..');
const canonical = 'shopify_admin_credentials';
const legacy: Record<string, string> = {
  shopify_app_installations: 'access_token', integrations: 'access_token_encrypted',
};
const tokenFields = ['access_token', 'access_token_encrypted', 'refresh_token_encrypted'];
const core = 'packages/backend-core/src/services/shopify-app.service.ts';
const billing = 'apps/backend/src/api/shopify/shopify.billing.controller.ts';
const islands = ['apps/backend/src/services/wms/openingInventoryCutover.service.ts',
  'apps/backend/src/services/wms/shopifyOpeningInventoryCutover.service.ts'];
const dev = 'apps/backend/src/api/shopify/dev.routes.ts';
const seed = 'apps/backend/src/scripts/seed_first_entry.ts';
const repository = 'apps/backend/src/services/shopify/shopifyAdminCredential.repository.ts';
const lifecycle = 'apps/backend/src/services/shopify/shopifyAdminCredentialLifecycle.service.ts';
const consumer = 'apps/backend/src/services/shopify/shopifyAdminCredentialConsumer.service.ts';
function files(directory: string): string[] {
  return fs.readdirSync(path.join(root, directory), { withFileTypes: true }).flatMap(entry => {
    const file = `${directory}/${entry.name}`;
    return entry.isDirectory() ? files(file)
      : /\.[cm]?tsx?$/.test(entry.name) && !entry.name.endsWith('.d.ts') ? [file] : [];
  }).sort();
}
// Same production roots as CERT-4J, plus executable seeds for schema readiness.
const production = [...files('apps/backend/src'), ...files('packages/backend-core/src'),
  ...files('apps/backend/seeds')].filter(file => !/\.(test|spec)\.[cm]?tsx?$/.test(file));
const program = ts.createProgram(production.map(file => path.join(root, file)), {
  noResolve: true, noLib: true, noEmit: true, target: ts.ScriptTarget.Latest,
});
const checker = program.getTypeChecker();
const source = (file: string) => program.getSourceFile(path.join(root, file))!;
function nodes(node: ts.Node): ts.Node[] {
  const result = [node];
  node.forEachChild(child => { result.push(...nodes(child)); });
  return result;
}
const literal = (node?: ts.Node): string | undefined => node
  && (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) ? node.text : undefined;
function name(node?: ts.Node): string | undefined {
  if (!node) return undefined;
  if (ts.isIdentifier(node)) return node.text;
  if (ts.isPropertyAccessExpression(node)) return node.name.text;
  if (ts.isElementAccessExpression(node)) return literal(node.argumentExpression);
  return literal(node);
}
const declarations = production.flatMap(file => nodes(source(file))).filter(node =>
  ts.isFunctionDeclaration(node) || ts.isMethodDeclaration(node));
function declared(node: ts.Node): readonly ts.Declaration[] {
  return checker.getSymbolAtLocation(node)?.declarations ?? [];
}
function unwrap(node: ts.Node): ts.Node {
  if (ts.isAwaitExpression(node) || ts.isParenthesizedExpression(node)
    || ts.isNonNullExpression(node) || ts.isAsExpression(node) || ts.isTypeAssertionExpression(node)) {
    return unwrap(node.expression);
  }
  return node;
}
// Follow query receivers, local aliases, callback returns and named query helpers.
// Inspect only the receiver chain: a canonical query's metadata join/whereExists
// must never make its credential update appear to target the installation table.
function tables(input?: ts.Node, seen = new Set<ts.Node>()): string[] {
  if (!input || seen.has(input)) return [];
  const node = unwrap(input);
  const next = new Set([...seen, input, node]);
  if (ts.isIdentifier(node)) return declared(node).flatMap(declaration => {
    if (ts.isVariableDeclaration(declaration)) return tables(declaration.initializer, next);
    if (ts.isBindingElement(declaration) && ts.isVariableDeclaration(declaration.parent.parent)) {
      return projectedTables(declaration.parent.parent.initializer, name(declaration.propertyName ?? declaration.name) ?? '', next);
    }
    if (ts.isParameter(declaration) && declaration.type?.getText().includes('ShopifyAdminCredentialRow')) return [canonical];
    return [];
  });
  if (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) return tables(node.expression, next);
  if (ts.isCallExpression(node)) {
    const table = literal(node.arguments[0])?.replace(/^public\./, '').split(/\s+as\s+/i)[0];
    if (table && (ts.isIdentifier(node.expression) || ['from', 'table'].includes(name(node.expression) ?? ''))
      && [canonical, ...Object.keys(legacy)].includes(table)) return [table];
    const receiver = ts.isPropertyAccessExpression(node.expression) || ts.isElementAccessExpression(node.expression)
      ? tables(node.expression.expression, next) : [];
    if (receiver.length) return receiver;
    const called = name(node.expression);
    const functions = declarations.filter(declaration => name((declaration as ts.FunctionDeclaration).name) === called);
    const returns = functions.flatMap(declaration => nodes(declaration).filter(ts.isReturnStatement)
      .flatMap(statement => tables(statement.expression, next)));
    const callbacks = node.arguments.filter(argument => ts.isArrowFunction(argument) || ts.isFunctionExpression(argument));
    return [...returns, ...callbacks.flatMap(callback => tables(callback, next))];
  }
  if (ts.isConditionalExpression(node)) return [...tables(node.whenTrue, next), ...tables(node.whenFalse, next)];
  if (ts.isBinaryExpression(node)) return [...tables(node.left, next), ...tables(node.right, next)];
  if (ts.isArrowFunction(node) || ts.isFunctionExpression(node)) {
    return ts.isBlock(node.body) ? nodes(node.body).filter(ts.isReturnStatement)
      .flatMap(statement => tables(statement.expression, next)) : tables(node.body, next);
  }
  return [];
}
// Resolve the selected member of a returned authority object, not all its metadata.
function projectedTables(input: ts.Node | undefined, field: string, seen: Set<ts.Node>): string[] {
  if (!input || seen.has(input)) return [];
  const node = unwrap(input);
  const next = new Set([...seen, input]);
  if (ts.isObjectLiteralExpression(node)) return node.properties.flatMap(property => {
    if (name(property.name) !== field) return [];
    return ts.isPropertyAssignment(property) ? tables(property.initializer, next)
      : ts.isShorthandPropertyAssignment(property)
        ? (checker.getShorthandAssignmentValueSymbol(property)?.declarations ?? [])
          .flatMap(declaration => ts.isVariableDeclaration(declaration) ? tables(declaration.initializer, next) : []) : [];
  });
  if (ts.isCallExpression(node)) return declarations.filter(declaration =>
    name((declaration as ts.FunctionDeclaration).name) === name(node.expression))
    .flatMap(declaration => nodes(declaration).filter(ts.isReturnStatement)
      .flatMap(statement => projectedTables(statement.expression, field, next)));
  return [];
}
// Resolve local shape aliases without requiring utility types from the runtime.
function typeKeys(type?: ts.TypeNode, seen = new Set<string>()): string[] {
  if (!type) return [];
  if (ts.isTypeLiteralNode(type)) return type.members.map(member => name(member.name) ?? '');
  if (ts.isIntersectionTypeNode(type) || ts.isUnionTypeNode(type)) return type.types.flatMap(child => typeKeys(child, seen));
  if (!ts.isTypeReferenceNode(type)) return [];
  const typeName = type.typeName.getText();
  if (['Omit', 'Pick'].includes(typeName)) {
    const fields = typeKeys(type.typeArguments?.[0], seen);
    const selection = type.typeArguments?.[1];
    const selected = selection ? nodes(selection).filter(ts.isLiteralTypeNode).map(node => literal(node.literal)) : [];
    return fields.filter(field => typeName === 'Omit' ? !selected.includes(field) : selected.includes(field));
  }
  if (seen.has(typeName)) return [];
  const next = new Set([...seen, typeName]);
  return production.flatMap(file => source(file).statements).flatMap(declaration => {
    if (ts.isInterfaceDeclaration(declaration) && declaration.name.text === typeName) {
      return declaration.members.map(member => name(member.name) ?? '');
    }
    if (ts.isTypeAliasDeclaration(declaration) && declaration.name.text === typeName) return typeKeys(declaration.type, next);
    return [];
  });
}
function keys(input?: ts.Node, seen = new Set<ts.Node>()): string[] {
  if (!input || seen.has(input)) return [];
  const node = unwrap(input);
  const next = new Set([...seen, input]);
  if (ts.isObjectLiteralExpression(node)) return node.properties.flatMap(property =>
    ts.isSpreadAssignment(property) ? keys(property.expression, next) : [name(property.name) ?? '']);
  if (ts.isArrayLiteralExpression(node)) return node.elements.flatMap(element => keys(element, next));
  if (ts.isIdentifier(node)) return declared(node).flatMap(declaration => {
    if (ts.isVariableDeclaration(declaration)) return keys(declaration.initializer, next);
    if (ts.isParameter(declaration) && declaration.type) {
      const type = checker.getTypeAtLocation(node);
      return [...type.getProperties().map(symbol => symbol.name), ...typeKeys(declaration.type)];
    }
    return [];
  });
  const value = literal(node);
  return value ? [value] : [];
}
function location(node: ts.Node, detail: string): string {
  const file = node.getSourceFile();
  const position = ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)
    ? node.expression.name.getStart() : node.getStart();
  const line = file.getLineAndCharacterOfPosition(position).line + 1;
  let owner = (ts.isMethodDeclaration(node) || ts.isFunctionDeclaration(node)) ? node.name?.getText() ?? '<anonymous>' : '<module/route handler>';
  for (let parent = node.parent; parent; parent = parent.parent) {
    if (ts.isFunctionDeclaration(parent) || ts.isMethodDeclaration(parent)) {
      owner = parent.name?.getText() ?? '<anonymous>'; break;
    }
    if (ts.isArrowFunction(parent) && ts.isVariableDeclaration(parent.parent)) {
      owner = parent.parent.name.getText(); break;
    }
  }
  const evidence = ts.isCallExpression(node) ? `${name(node.expression)}(${node.arguments.map(argument => argument.getText()).join(', ')})`
    : (ts.isMethodDeclaration(node) || ts.isFunctionDeclaration(node)) ? node.name?.getText() : node.getText();
  return `${path.relative(root, file.fileName)}:${line} ${owner} ${detail} -> ${evidence?.replace(/\s+/g, ' ')}`;
}
// Provider response ACCESS is acquisition material, not a persisted shadow read.
// Narrow expression exceptions, never a whole-file exemption for canonical writers.
const acquisitionReads: Record<string, string[]> = {
  'apps/backend/src/services/shopify/shopifyOAuthAcquisition.service.ts': ['tokenData'],
  'apps/backend/src/services/shopify/shopifyAdminCredentialRefreshProvider.service.ts': ['data'],
  'apps/backend/src/api/billing/shopify.events.service.ts': ['response.data'],
};
function reads(file: string, scope: ts.Node = source(file)): string[] {
  return nodes(scope).flatMap(node => {
    let field: string | undefined;
    let origin: ts.Node | undefined;
    if (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) {
      field = name(node); origin = node.expression;
    } else if (ts.isBindingElement(node)) {
      field = name(node.propertyName ?? node.name);
      const declaration = node.parent.parent;
      if (ts.isVariableDeclaration(declaration)) origin = declaration.initializer;
    }
    if (field && tokenFields.includes(field)) {
      const targets = tables(origin);
      if (targets.length && targets.every(table => table === canonical)) return [];
      if (origin && field === 'access_token' && acquisitionReads[file]?.includes(origin.getText())) return [];
      return [location(node, `READ ${targets.join('|') || 'unresolved authority'}.${field}`)];
    }
    if (ts.isCallExpression(node) && ['select', 'first', 'returning', 'pluck', 'raw'].includes(name(node.expression) ?? '')) {
      const targets = tables(node);
      return node.arguments.flatMap(argument => {
        const text = literal(argument);
        if (!text) return [];
        return Object.entries(legacy).flatMap(([table, token]) =>
          new RegExp(`\\b${token}\\b`).test(text)
          && (targets.includes(table) || new RegExp(`\\b${table}\\b`).test(text))
            ? [location(argument, `READ ${table}.${token}`)] : []);
      });
    }
    return [];
  });
}
function writes(file: string, scope: ts.Node = source(file)): string[] {
  return nodes(scope).filter(ts.isCallExpression).flatMap(call => {
    if (!['insert', 'update', 'upsert', 'merge'].includes(name(call.expression) ?? '')) return [];
    const targets = tables(call);
    const fields = call.arguments.flatMap(argument => keys(argument));
    return Object.entries(legacy).flatMap(([table, token]) => targets.includes(table) && fields.includes(token)
      ? [location(call, `WRITE ${table}.${token}`)] : []);
  });
}
function named(file: string, names: string[]): ts.Node[] {
  return nodes(source(file)).filter(node => (ts.isMethodDeclaration(node) || ts.isFunctionDeclaration(node)
    || ts.isVariableDeclaration(node) || ts.isInterfaceDeclaration(node)) && names.includes(name(node.name) ?? ''));
}
const inventory = () => ({
  LEGACY_READS: production.flatMap(file => reads(file)),
  LEGACY_WRITES: production.flatMap(file => writes(file)),
});
function empty(surfaces: string[]): void { expect(surfaces).toEqual([]); }

describe('CERT-4K — physical Shopify Admin legacy-shadow retirement (intentional RED)', () => {
  it('C4K-01 zero production legacy reads, including unreachable retired islands', () => {
    const remaining = inventory();
    console.info('CERT4K_RETIREMENT_SURFACES=' + JSON.stringify(remaining, null, 2));
    empty(remaining.LEGACY_READS);
  });
  it('C4K-02 zero production legacy insert/update/upsert/merge writes', () => {
    empty(production.flatMap(file => writes(file)));
  });
  it('C4K-03 installation type and createAppInstallation accept metadata only', () => {
    const type = named(core, ['ShopifyAppInstallation'])[0] as ts.InterfaceDeclaration;
    const forbidden = type ? type.members.filter(member => tokenFields.includes(name(member.name) ?? '')) : [];
    const create = named(core, ['createAppInstallation'])[0] as ts.MethodDeclaration | undefined;
    const parameters = create?.parameters.flatMap(parameter => {
      const fields = [...checker.getTypeAtLocation(parameter).getProperties().map(symbol => symbol.name), ...typeKeys(parameter.type)];
      return fields.filter(field => tokenFields.includes(field) || /^(accessToken|refreshToken|credentials?)$/i.test(field))
        .map(field => location(parameter, `CREDENTIAL PARAMETER ${field}`));
    }) ?? [];
    empty([...forbidden.map(node => location(node, 'LEGACY INSTALLATION FIELD')), ...parameters]);
  });
  it('C4K-04 legacy decrypted credential getters are absent', () => {
    empty(named(core, ['getDecryptedAccessToken', 'getDecryptedAccessTokenByShopId'])
      .map(node => location(node, 'OBSOLETE GETTER')));
  });
  it('C4K-05 hardFenceAppUninstalled preserves canonical fencing without legacy columns', () => {
    empty(named(core, ['hardFenceAppUninstalled']).flatMap(scope => [...reads(core, scope), ...writes(core, scope)]));
  });
  it('C4K-06 obsolete post-install methods are absent or provider-free retirement tombstones', () => {
    empty(named(core, ['completePostInstallation', 'registerAppUninstallWebhook', 'registerRefundsCreateWebhook'])
      .flatMap(scope => {
        const active = nodes(scope).filter(ts.isCallExpression).filter(call =>
          !['warn', 'info', 'log'].includes(name(call.expression) ?? ''));
        return active.length ? [location(scope, 'OBSOLETE CREDENTIAL-DEPENDENT POST-INSTALL METHOD')] : [];
      }));
  });
  it('C4K-07 retired billing resolver is absent', () => {
    empty(named(billing, ['resolveShopifyAccessToken']).map(node => location(node, 'RETIRED BILLING AUTHORITY')));
  });
  it('C4K-08 old opening cutover islands retain no legacy credential authority', () => {
    empty(islands.filter(file => fs.existsSync(path.join(root, file)))
      .flatMap(file => [...reads(file), ...writes(file)]));
  });
  it('C4K-09 dev route is ready for physical integration token removal', () => {
    empty([...reads(dev), ...writes(dev)]);
  });
  it('C4K-10 first-entry seed populates neither legacy column', () => {
    empty(writes(seed));
  });
  it('C4K-11 table-scoped analysis permits identity/lifecycle and sync metadata', () => {
    const generation = 'apps/backend/src/services/wms/openingInventoryCutoverGeneration.service.ts';
    expect(nodes(source(generation)).some(node => literal(node) === 'shopify_app_installations')).toBe(true);
    empty([...reads(generation), ...writes(generation), ...reads(consumer), ...writes(consumer)]);
    const metadataQueries = nodes(source(repository)).filter(ts.isCallExpression)
      .filter(call => name(call.expression) === 'select' && tables(call).includes('shopify_app_installations'));
    expect(metadataQueries.length).toBeGreaterThan(0);
    // Table presence, domain, GID, scopes, lifecycle and sync fields are never banned.
    expect(Object.values(legacy).some(field => ['shop_domain', 'shop_gid', 'scopes',
      'installed_at', 'uninstalled_at', 'sync_status', 'platform_shop_name'].includes(field))).toBe(false);
  });
  it('C4K-12 canonical ACCESS/REFRESH repository, lifecycle and consumer are permitted', () => {
    empty([...reads(repository), ...reads(lifecycle), ...reads(consumer)]);
    const canonicalWrites = nodes(source(repository)).filter(ts.isCallExpression)
      .filter(call => ['insert', 'update', 'merge'].includes(name(call.expression) ?? '')
        && tables(call).includes(canonical));
    expect(canonicalWrites.length).toBeGreaterThan(0);
    const fields = canonicalWrites.flatMap(call => call.arguments.flatMap(argument => keys(argument)));
    expect(fields).toEqual(expect.arrayContaining(['access_token_encrypted', 'refresh_token_encrypted']));
    // Apply the same write classifier to each canonical operation, not a file exemption:
    // repository compatibility-shadow writes remain RED in C4K-02.
    empty(canonicalWrites.flatMap(call => writes(repository, call)));
  });
});
