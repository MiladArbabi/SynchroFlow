/** CERT-4J: source-only authority/reachability closure; no application imports or I/O. */
import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

const root = path.resolve(__dirname, '../..');
const app = 'apps/backend/src/';
const core = 'packages/backend-core/src/';
const compatibility = `${core}services/shopify-app.service.ts`;
const canonicalConsumer = 'resolveShopifyAdminCredentialForConsumer';
const connectionClassifier = `${app}services/shopify/shopifyConnectionState.service.ts`;
const legacyMethods = [
  'getDecryptedAccessToken', 'getDecryptedAccessTokenByShopId',
  'completePostInstallation', 'registerAppUninstallWebhook', 'registerRefundsCreateWebhook',
];
const retiredExecutors = [
  'approveAndRunOpeningInventoryCutover', 'executeOpeningInventoryCutover',
  'executeOpeningInventoryCutoverBatch',
];
const tokenFields = ['access_token', 'access_token_encrypted'];
const metadataOnlyCredentialSql = /SELECT\s+credential\.credential_state,\s*\(credential\.access_token_encrypted IS NOT NULL\s*AND credential\.access_expires_at > pg_catalog\.now\(\)\) AS access_usable,\s*\(credential\.refresh_token_encrypted IS NOT NULL\s*AND credential\.refresh_expires_at > pg_catalog\.now\(\)\) AS refresh_usable,\s*\(credential\.rotation_lease_token IS NOT NULL\s*AND credential\.rotation_lease_expires_at > pg_catalog\.now\(\)\) AS lease_live\s+FROM public\.shopify_admin_credentials AS credential\s+WHERE credential\.shop_id = \? AND credential\.installation_id = \?/;
function files(directory: string): string[] {
  return fs.readdirSync(path.join(root, directory), { withFileTypes: true }).flatMap(entry => {
    const file = `${directory}/${entry.name}`;
    return entry.isDirectory() ? files(file)
      : entry.name.endsWith('.ts') && !entry.name.endsWith('.d.ts') ? [file] : [];
  }).sort();
}
const productionFiles = [...files(app.slice(0, -1)), ...files(core.slice(0, -1))];
const cache = new Map<string, ts.SourceFile>();
function source(file: string): ts.SourceFile {
  if (!cache.has(file)) cache.set(file, ts.createSourceFile(file,
    fs.readFileSync(path.join(root, file), 'utf8'), ts.ScriptTarget.Latest, true));
  return cache.get(file)!;
}
function nodes(node: ts.Node): ts.Node[] {
  const result = [node];
  node.forEachChild(child => { result.push(...nodes(child)); });
  return result;
}
const literal = (node?: ts.Node): string | undefined => node
  && (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) ? node.text : undefined;
function name(expression: ts.Node): string | undefined {
  if (ts.isIdentifier(expression)) return expression.text;
  if (ts.isPropertyAccessExpression(expression)) return expression.name.text;
  if (ts.isElementAccessExpression(expression)) return literal(expression.argumentExpression);
  return undefined;
}
function importedNames(file: string): Map<string, string> {
  const result = new Map<string, string>();
  for (const node of source(file).statements.filter(ts.isImportDeclaration)) {
    const bindings = node.importClause?.namedBindings;
    if (bindings && ts.isNamedImports(bindings)) {
      bindings.elements.forEach(binding => result.set(binding.name.text,
        binding.propertyName?.text ?? binding.name.text));
    }
  }
  return result;
}
function calls(file: string, names: string[], scope: ts.Node = source(file)): ts.CallExpression[] {
  const aliases = importedNames(file);
  return nodes(scope).filter(ts.isCallExpression).filter(call => {
    const called = name(call.expression);
    return called !== undefined && names.includes(aliases.get(called) ?? called);
  });
}
function enclosingFunction(node: ts.Node): string {
  for (let parent = node.parent; parent; parent = parent.parent) {
    if (ts.isFunctionDeclaration(parent) || ts.isMethodDeclaration(parent)) {
      return parent.name?.getText() ?? '<anonymous>';
    }
    if ((ts.isArrowFunction(parent) || ts.isFunctionExpression(parent))
      && ts.isVariableDeclaration(parent.parent)) return parent.parent.name.getText();
  }
  return '<module/route handler>';
}
function location(file: string, node: ts.Node): string {
  const line = source(file).getLineAndCharacterOfPosition(node.getStart()).line + 1;
  return `${file}:${line} ${enclosingFunction(node)} -> ${node.getText()}`;
}
function externalCalls(names: string[], excluded: string[] = []): string[] {
  return productionFiles.filter(file => !excluded.includes(file)).flatMap(file =>
    calls(file, names).map(call => location(file, call)));
}
const legacyCallers = () => externalCalls(legacyMethods, [compatibility]);
function shadowReads(file: string): ts.Node[] {
  return nodes(source(file)).filter(node => {
    if (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) {
      return tokenFields.includes(name(node) ?? '');
    }
    if (ts.isBindingElement(node)) return tokenFields.includes(
      node.propertyName ? name(node.propertyName) ?? literal(node.propertyName) ?? '' : node.name.getText());
    // Explicit SQL/Knex projections count as reads; object assignments used by
    // insert/update/merge are writes and intentionally do not match this rule.
    if (ts.isCallExpression(node) && ['select', 'first', 'returning', 'pluck', 'raw'].includes(name(node.expression) ?? '')) {
      return node.arguments.some(arg => {
        const value = literal(arg);
        if (file === connectionClassifier && name(node.expression) === 'raw'
          && value !== undefined && metadataOnlyCredentialSql.test(value)) return false;
        return value !== undefined && tokenFields.some(field =>
          new RegExp(`\\b${field}\\b`).test(value));
      });
    }
    return false;
  });
}
function noLegacy(file: string): void {
  expect(shadowReads(file).map(node => location(file, node))).toEqual([]);
  expect(calls(file, [...legacyMethods, 'decrypt', 'decryptToken'])
    .map(call => location(file, call))).toEqual([]);
}
function declaration(file: string, declaredName: string): ts.Node {
  const found = nodes(source(file)).find(node =>
    (ts.isFunctionDeclaration(node) || ts.isVariableDeclaration(node))
    && node.name?.getText() === declaredName);
  expect(found).toBeDefined();
  return found!;
}
function canonical(file: string): void {
  noLegacy(file);
  const resolutions = calls(file, [canonicalConsumer]);
  expect(resolutions.length).toBeGreaterThan(0);
  for (const call of resolutions) {
    let parent: ts.Node = call.parent;
    if (ts.isAwaitExpression(parent)) parent = parent.parent;
    expect(ts.isVariableDeclaration(parent)).toBe(true);
    const variable = (parent as ts.VariableDeclaration).name.getText();
    const owner = (() => {
      let current: ts.Node = parent;
      while (current.parent && !ts.isFunctionLike(current)) current = current.parent;
      return current;
    })();
    const descendants = nodes(owner);
    const fields = descendants.filter(ts.isPropertyAccessExpression)
      .filter(node => node.expression.getText() === variable);
    expect(fields.some(node => node.name.text === 'accessToken' && node.getStart() > call.getStart())).toBe(true);
    expect(fields.some(node => node.name.text === 'shopDomain' && node.getStart() > call.getStart())).toBe(true);
    const guard = descendants.some(node => ts.isIfStatement(node)
      && node.expression.getText().includes(`${variable}.kind`)
      && nodes(node.expression).some(child => literal(child) === 'READY')
      && nodes(node.thenStatement).some(child => ts.isReturnStatement(child) || ts.isThrowStatement(child))
      && node.getStart() > call.getStart()
      && fields.filter(field => field.name.text === 'accessToken').every(field => node.getStart() < field.getStart()));
    const exhaustiveSwitch = descendants.some(node => ts.isSwitchStatement(node)
      && node.expression.getText() === `${variable}.kind`
      && ['REFRESH_IN_PROGRESS', 'RETRYABLE', 'PROVIDER_REJECTED', 'REAUTH_REQUIRED'].every(kind =>
        node.caseBlock.clauses.some(clause => ts.isCaseClause(clause) && literal(clause.expression) === kind
          && nodes(clause).some(child => ts.isThrowStatement(child)))));
    expect({ file, canonicalAccessGuarded: guard || exhaustiveSwitch })
      .toEqual({ file, canonicalAccessGuarded: true });
  }
}
function canonicalArguments(file: string, provider: string, fields: string[]): void {
  const providerCalls = calls(file, [provider]);
  expect(providerCalls.length).toBeGreaterThan(0);
  for (const call of providerCalls) expect(call.arguments.slice(0, fields.length)
    .map(arg => arg.getText())).toEqual(fields.map(field => `credential.${field}`));
}
function canonicalClient(file: string): void {
  canonical(file);
  const clients = calls(file, ['createShopifyGraphQLClient']);
  expect(clients.length).toBeGreaterThan(0);
  for (const client of clients) {
    const options = client.arguments[0];
    expect(options && ts.isObjectLiteralExpression(options)).toBe(true);
    const properties = (options as ts.ObjectLiteralExpression).properties.filter(ts.isPropertyAssignment);
    expect(properties.find(property => name(property.name) === 'accessToken')?.initializer.getText())
      .toBe('credential.accessToken');
    expect(properties.find(property => name(property.name) === 'platformShopName')?.initializer.getText())
      .toBe('credential.shopDomain');
  }
}
function imports(file: string): string[] {
  return nodes(source(file)).flatMap(node => {
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
      return [literal(node.moduleSpecifier) ?? ''];
    }
    if (ts.isCallExpression(node) && (node.expression.kind === ts.SyntaxKind.ImportKeyword
      || name(node.expression) === 'require')) return [literal(node.arguments[0]) ?? ''];
    return [];
  });
}
function mounted(file: string, route: string, handler: string): void {
  expect(calls(file, ['get', 'post', 'use']).some(call => literal(call.arguments[0]) === route
    && call.arguments.slice(1).some(arg => arg.getText() === handler))).toBe(true);
}
function writes(file: string): ts.PropertyAssignment[] {
  return nodes(source(file)).filter(ts.isPropertyAssignment)
    .filter(node => tokenFields.includes(name(node.name) ?? literal(node.name) ?? ''));
}
const residual = {
  compatibility,
  billing: `${app}api/shopify/shopify.billing.controller.ts`,
  dev: `${app}api/shopify/dev.routes.ts`,
  opening: [`${app}services/wms/openingInventoryCutover.service.ts`,
    `${app}services/wms/shopifyOpeningInventoryCutover.service.ts`],
  writers: [`${app}api/integrations/integration.controller.ts`,
    `${app}services/shopify/shopifyAdminCredential.repository.ts`],
  crypto: [`${app}services/shopify/shopifyAdminCredentialLifecycle.service.ts`,
    `${app}services/shopify/shopifyAdminCredentialConsumer.service.ts`],
  acquisition: [`${app}services/shopify/shopifyOAuthAcquisition.service.ts`,
    `${app}services/shopify/shopifyAdminCredentialRefreshProvider.service.ts`,
    `${app}api/billing/shopify.events.service.ts`],
  scripts: [`${app}scripts/seed_first_entry.ts`, 'apps/backend/seeds/dev_seed.ts'],
};
function inventory() {
  const callers = legacyCallers();
  const unknown = productionFiles.filter(file => shadowReads(file).length > 0
    && ![residual.compatibility, residual.billing, residual.dev, ...residual.opening,
      ...residual.crypto, ...residual.acquisition, ...residual.scripts].includes(file));
  return {
    ACTIVE_LEGACY_ADMIN_CREDENTIAL_READERS: [...callers, ...unknown.flatMap(file =>
      shadowReads(file).map(node => location(file, node)))],
    DEAD_COMPATIBILITY_SURFACES: callers.length === 0 ? [compatibility] : [],
    REACHABLE_COMPATIBILITY_SURFACES: callers.length > 0 ? [compatibility] : [],
    RETIRED_UNMOUNTED_SURFACES: [residual.billing, ...residual.opening],
    DEV_ONLY_SURFACES: [residual.dev],
    DEV_PLAINTEXT_ACCESS_LOG: calls(residual.dev, ['log']).some(call =>
      nodes(call).some(node => ts.isShorthandPropertyAssignment(node) && node.name.text === 'accessToken')),
    COMPATIBILITY_SHADOW_WRITERS: [...residual.writers, compatibility,
      ...residual.scripts].filter(file => writes(file).length > 0),
    CANONICAL_CRYPTO_BOUNDARIES: residual.crypto,
    CANONICAL_ACQUISITION_RESPONSES: residual.acquisition,
    SCRIPT_SEED_SURFACES: residual.scripts,
  };
}

describe('CERT-4J — active Shopify Admin legacy-reader prohibition', () => {
  it('C4J-01 sync worker passes canonical READY access/domain to performSmartSync', () => {
    const file = `${app}sync.worker.ts`;
    canonical(file);
    canonicalArguments(file, 'performSmartSync', ['accessToken', 'shopDomain']);
  });
  it('C4J-02 manual sync uses canonical authority and operational integration identity', () => {
    const file = `${app}api/integrations/manualSync.controller.ts`;
    noLegacy(file);
    expect(calls(file, [canonicalConsumer, 'performInitialSync', 'performSmartSync'])).toHaveLength(0);
    expect(calls(file, ['respondWithManualRecovery'])).toHaveLength(1);
    expect(calls(file, ['recordShopifySyncDispatchIntent', 'updateIntegrationStatus', 'sendToQueue', 'publish']))
      .toHaveLength(0);
  });
  it('C4J-03 bulk webhook registration uses canonical access/domain', () => {
    const file = `${app}services/shopify/shopifyWebhook.service.ts`;
    canonical(file);
    canonicalArguments(file, 'registerShopifyWebhooks', ['shopDomain', 'accessToken']);
  });
  it('C4J-04 mounted OAuth callback cannot reenter legacy post-installation auth', () => {
    const file = `${app}api/integrations/integration.controller.ts`;
    mounted(`${app}bootstrap/express.ts`, '/api/v1/integrations', 'integrationRoutes');
    mounted(`${app}api/integrations/integration.routes.ts`, '/oauth/callback/:platform', 'handleOAuthCallback');
    const callback = declaration(file, 'handleOAuthCallback');
    expect(calls(file, legacyMethods, callback).map(call => location(file, call))).toEqual([]);
    expect(calls(file, ['registerWebhooksForShop'], callback).length).toBeGreaterThan(0);
    canonical(`${app}services/shopify/shopifyWebhook.service.ts`);
  });
  it('C4J-05 backend-core legacy getters/registration have zero external production callers', () => {
    expect(legacyCallers()).toEqual([]);
  });
  it('C4J-06 refund backfill uses canonical credentials', () => {
    canonicalClient(`${app}services/shopify/shopifyRefundBackfill.service.ts`);
  });
  it('C4J-07 settings Shopify location client uses canonical credentials', () => {
    canonicalClient(`${app}api/settings/shopSettings.controller.ts`);
  });
  it('C4J-08 order identity provider recovery uses canonical credentials', () => {
    const file = `${app}services/order-identity-guard.service.ts`;
    canonical(file);
    canonicalArguments(file, 'createShopifyGraphQLClient', ['accessToken', 'shopDomain']);
  });
  it('C4J-09 retired fulfillment handler remains a provider-free tombstone', () => {
    const file = `${app}execution/handlers/proceed_fulfillment.handler.ts`;
    const handler = declaration(file, 'proceedFulfillmentHandler');
    expect(nodes(handler).filter(ts.isThrowStatement).map(node => node.expression.getText()))
      .toEqual(["new Error('PROCEED_FULFILLMENT_RETIRED')"]);
    expect(nodes(handler).filter(ts.isCallExpression)).toHaveLength(0);
    expect(nodes(handler).filter(ts.isNewExpression).map(node => node.expression.getText())).toEqual(['Error']);
    expect(source(file).statements.filter(ts.isImportDeclaration)
      .every(node => node.importClause?.isTypeOnly === true)).toBe(true);
    expect(calls(file, [canonicalConsumer])).toHaveLength(0);
    noLegacy(file);
    const guard = declaration(`${app}execution/execution.guard.ts`, 'validateExecution');
    expect(nodes(guard).some(node => ts.isIfStatement(node)
      && nodes(node.expression).some(child => literal(child) === 'proceed_fulfillment')
      && nodes(node.thenStatement).some(child => ts.isThrowStatement(child)
        && nodes(child).some(value => literal(value) === 'PROCEED_FULFILLMENT_RETIRED')))).toBe(true);
  });
  it('C4J-10 stow writeback uses canonical credentials', () => {
    canonicalClient(`${app}services/wms/shopifyInventorySync.service.ts`);
  });
  it('C4J-11 shipment writeback uses canonical credentials', () => {
    canonicalClient(`${app}services/wms/shopifyFulfillmentWriteback.service.ts`);
  });
  it('C4J-12 active opening snapshot/execution are canonical; generation reads identity only', () => {
    canonical(`${app}services/wms/shopifyOpeningInventorySnapshot.service.ts`);
    const generation = `${app}services/wms/openingInventoryCutoverGeneration.service.ts`;
    noLegacy(generation);
    expect(calls(generation, [canonicalConsumer, 'createShopifyGraphQLClient'])).toHaveLength(0);
    expect(nodes(source(generation)).some(node => literal(node) === 'shopify_app_installations')).toBe(true);
    expect(calls(generation, ['select']).some(call => call.arguments.map(literal)
      .join(',') === 'shop_domain,shop_gid')).toBe(true);
    const execution = `${app}services/wms/openingInventoryCutoverExecution.service.ts`;
    canonical(execution);
    const resolve = declaration(execution, 'resolveCutoverCredential');
    expect(calls(execution, [canonicalConsumer], resolve)).toHaveLength(1);
    expect(calls(execution, ['resolveCutoverCredential'])).toHaveLength(3);
    const credentialAccess = nodes(source(execution)).filter(ts.isPropertyAssignment)
      .filter(node => name(node.name) === 'accessToken' && node.initializer.getText() === 'credential.accessToken');
    expect(credentialAccess).toHaveLength(4); // Canonical adapter plus E02/E03/E04 provider boundaries.
  });
  it('C4J-13 mounted opening approval reaches generation/execution, never legacy executors', () => {
    mounted(`${app}bootstrap/express.ts`, '/api/v1/wms', 'wmsRoutes');
    mounted(`${app}api/wms/wms.routes.ts`, '/opening-inventory/cutover', 'httpApproveOpeningInventoryCutover');
    const file = `${app}api/wms/openingInventoryCutover.controller.ts`;
    const approve = declaration(file, 'httpApproveOpeningInventoryCutover');
    const create = calls(file, ['createOpeningInventoryCutoverGeneration'], approve);
    const advance = calls(file, ['advanceOpeningInventoryCutoverExecution'], approve);
    expect(create).toHaveLength(1);
    expect(advance).toHaveLength(1);
    expect(create[0].getStart()).toBeLessThan(advance[0].getStart());
    expect(externalCalls(retiredExecutors, residual.opening)).toEqual([]);
  });
  it('C4J-14 retired billing callbacks/helper have no active production callers', () => {
    const route = `${app}api/shopify/shopify.billing.routes.ts`;
    mounted(`${app}bootstrap/express.ts`, '/api/v1/shopify-billing', 'shopifyBillingRoutes');
    const registrations = calls(route, ['get', 'post', 'put', 'patch', 'delete', 'use']);
    expect(registrations).toHaveLength(1);
    expect(registrations[0].arguments[0] && literal(registrations[0].arguments[0])).toBe('/subscription');
    expect(registrations[0].arguments.at(-1)?.getText()).toBe('getShopifySubscription');
    const retired = ['handleShopifyCallback', 'createShopifyCharge', 'changeShopifyPlan', 'resolveShopifyAccessToken'];
    expect([...importedNames(route).values()].filter(value => retired.includes(value))).toEqual([]);
    expect(externalCalls(retired, [residual.billing])).toEqual([]);
    expect(calls(residual.billing, ['resolveShopifyAccessToken'],
      declaration(residual.billing, 'getShopifySubscription'))).toHaveLength(0);
  });
  it('C4J-15 dev route is unimported in production and prohibits production before decryption', () => {
    expect(productionFiles.filter(file => file !== residual.dev).flatMap(file =>
      imports(file).filter(value => /(?:^|\/)dev\.routes(?:\.js|\.ts)?$/.test(value))
        .map(value => `${file} -> ${value}`))).toEqual([]);
    const handler = calls(residual.dev, ['post'])[0];
    expect(handler).toBeDefined();
    const guard = nodes(handler).find(node => ts.isIfStatement(node)
      && node.expression.getText() === "process.env.NODE_ENV === 'production'");
    expect(guard).toBeDefined();
    expect(nodes(guard!).some(ts.isThrowStatement)).toBe(true);
    const canonicalResolution = calls(residual.dev, [canonicalConsumer], handler);
    const provider = calls(residual.dev, ['performSmartSync'], handler);
    expect(canonicalResolution).toHaveLength(1);
    expect(provider).toHaveLength(1);
    expect(guard!.getStart()).toBeLessThan(canonicalResolution[0].getStart());
    expect(canonicalResolution[0].getStart()).toBeLessThan(provider[0].getStart());
    // Plaintext logging is reported by inventory; it is not this migration gate.
  });
  it('C4J-16 former compatibility surfaces cannot regain legacy provider authority', () => {
    for (const file of residual.writers) {
      expect(shadowReads(file).map(node => location(file, node))).toEqual([]);
      expect(calls(file, legacyMethods).map(call => location(file, call))).toEqual([]);
    }
  });
  it('C4J-17 canonical ACCESS decryption remains permitted; reconnect fences old authority', () => {
    const lifecycle = residual.crypto[0];
    expect(calls(lifecycle, ['decrypt']).some(call =>
      call.arguments[0]?.getText() === 'credential.access_token_encrypted!')).toBe(true);
    expect(nodes(source(lifecycle)).some(node => ts.isPropertyAccessExpression(node)
      && node.expression.getText() === 'credential' && node.name.text === 'access_token_encrypted')).toBe(true);

    // GH-979: reconnect must not refresh or decrypt the superseded credential.
    const preparation = declaration(lifecycle, 'prepareShopifyAdminCredentialReconnect');
    const transaction = declaration(lifecycle, 'prepareReconnectTransaction');
    expect(calls(lifecycle, ['prepareReconnectTransaction'], preparation)).toHaveLength(1);
    for (const scope of [preparation, transaction]) {
      expect(calls(lifecycle, ['decrypt', 'refreshShopifyAdminCredential'], scope))
        .toHaveLength(0);
    }
    expect(calls(lifecycle, ['fenceShopifyAdminCredentialReconnect'], transaction))
      .toHaveLength(1);

    expect(nodes(source(`${app}services/shopify/shopifyAdminCredential.repository.ts`))
      .some(node => literal(node) === 'shopify_admin_credentials')).toBe(true);
    expect(calls(lifecycle, legacyMethods)).toHaveLength(0);
  });
  it('C4J-18 classified active legacy-reader inventory is empty', () => {
    const classifier = source(connectionClassifier);
    const raw = calls(connectionClassifier, ['raw']);
    expect(raw).toHaveLength(1);
    expect(literal(raw[0].arguments[0])).toMatch(metadataOnlyCredentialSql);
    expect(calls(connectionClassifier, [canonicalConsumer, ...legacyMethods, 'decrypt', 'decryptToken']))
      .toHaveLength(0);
    expect(nodes(classifier).filter(ts.isPropertyAccessExpression)
      .filter(node => ['access_token', 'access_token_encrypted', 'refresh_token_encrypted']
        .includes(node.name.text))).toHaveLength(0);
    expect(nodes(classifier).filter(ts.isBindingElement)
      .filter(node => /(?:access|refresh)_token(?:_encrypted)?/.test(node.name.getText()))).toHaveLength(0);
    const classified = inventory();
    console.info('CERT4J_CLASSIFIED_INVENTORY=' + JSON.stringify(classified, null, 2));
    expect(classified.ACTIVE_LEGACY_ADMIN_CREDENTIAL_READERS).toEqual([]);
  });
});
