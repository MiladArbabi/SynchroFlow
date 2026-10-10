/** SHOP-REVIEW-AUTH-01 — RED-1: source-only contracts; no runtime imports or DB. */
import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

const root = path.resolve(__dirname, '../..');
const credentialTable = 'shopify_admin_credentials';
const parse = (file: string) => ts.createSourceFile(
  file, fs.readFileSync(path.join(root, file), 'utf8'), ts.ScriptTarget.Latest, true,
);
function nodes(node: ts.Node): ts.Node[] {
  const result = [node];
  node.forEachChild(child => { result.push(...nodes(child)); });
  return result;
}
const method = (node: ts.Node, name: string): node is ts.CallExpression =>
  ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)
  && node.expression.name.text === name;
const literal = (node?: ts.Node): string | undefined =>
  node && (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node))
    ? node.text : undefined;

// Resolve literal constants/template interpolation without executing migrations.
function strings(source: ts.SourceFile) {
  const constants = new Map<string, ts.Expression>();
  for (const node of nodes(source)) {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) {
      constants.set(node.name.text, node.initializer);
    }
  }
  function value(node?: ts.Node, seen = new Set<string>()): string | undefined {
    if (!node) return undefined;
    const text = literal(node);
    if (text !== undefined) return text;
    if (ts.isIdentifier(node) && !seen.has(node.text)) {
      return value(constants.get(node.text), new Set([...seen, node.text]));
    }
    if (ts.isTemplateExpression(node)) {
      let text = node.head.text;
      for (const span of node.templateSpans) {
        const part = value(span.expression, seen);
        if (part === undefined) return undefined;
        text += part + span.literal.text;
      }
      return text;
    }
    return undefined;
  }
  return value;
}
const compact = (text: string) => text
  .replace(/\/\*[\s\S]*?\*\//g, '').replace(/--[^\n]*/g, '')
  .replace(/"/g, '').replace(/\s+/g, ' ').trim().toLowerCase();
function migration(file: string) {
  const source = parse(`apps/backend/migrations/${file}`);
  const value = strings(source);
  const up = source.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'up');
  const forward = up ? nodes(up) : [];
  const sql = compact(forward.filter(node => method(node, 'raw'))
    .map(node => value((node as ts.CallExpression).arguments[0]) ?? '').join('\n'));
  const create = forward.find(node => method(node, 'createTable')
    && value(node.arguments[0]) === credentialTable) as ts.CallExpression | undefined;
  return { file, forward, value, sql, create };
}
const migrations = fs.readdirSync(path.join(root, 'apps/backend/migrations'))
  .filter(file => file.endsWith('.ts')).map(migration);
function credentialMigration() {
  const candidates = migrations.filter(m => m.create
    || /create table (?:if not exists )?(?:public\.)?shopify_admin_credentials\s*\(/.test(m.sql));
  expect(candidates.map(m => m.file)).toEqual(expect.arrayContaining([expect.any(String)]));
  expect(candidates).toHaveLength(1);
  return candidates[0];
}
// Balanced parentheses preserve nested SQL functions and composite constraints.
function parenthesized(text: string, opening: number): string {
  let depth = 0;
  for (let i = opening; i < text.length; i++) {
    if (text[i] === '(') depth++;
    if (text[i] === ')' && --depth === 0) return text.slice(opening + 1, i);
  }
  throw new Error('Unbalanced SQL contract expression');
}
function columns(text: string): string[] {
  return text.replace(/[\[\]'"`]/g, '').split(',').map(v => v.trim());
}
function strictTenant(expression: string) {
  expect(expression).toMatch(/\bshop_id\s*=/);
  expect(expression).toMatch(/current_setting\s*\(\s*'app\.current_tenant'\s*,\s*true\s*\)/);
  expect(expression).toMatch(/>\s*0\b/);
  expect(expression).toMatch(/\band\b/);
  expect(expression).not.toMatch(/\bor\b|\bis null\b|\btrue\b(?!\s*\))|coalesce\s*\([^)]*,\s*0\s*\)/);
  // Equality and positivity must reference the same tenant expression.
  const tenant = expression.match(/shop_id\s*=\s*([\s\S]*?)\s+and\s+([\s\S]*?)\s*>\s*0\s*$/);
  expect(tenant).not.toBeNull();
  expect(tenant?.[1].trim()).toBe(tenant?.[2].trim());
}

describe('SHOP-REVIEW-AUTH-01 — canonical Shopify Admin credential architecture', () => {
  it('creates the canonical credential table with persistent shape and a unique installation FK', () => {
    const m = credentialMigration();
    const callback = m.create?.arguments[1];
    const tableNodes = callback ? nodes(callback) : [];
    const tableSqlMatch = /create table (?:if not exists )?(?:public\.)?shopify_admin_credentials\s*\(/.exec(m.sql);
    const tableSql = tableSqlMatch
      ? parenthesized(m.sql, tableSqlMatch.index + tableSqlMatch[0].length - 1) : '';
    const definitions = tableNodes.filter(node => ts.isCallExpression(node)
      && ts.isPropertyAccessExpression(node.expression)
      && ts.isIdentifier(node.expression.expression));
    const columnNames = definitions.map(node => m.value((node as ts.CallExpression).arguments[0]));
    for (const name of [
      'shop_id', 'access_token_encrypted', 'refresh_token_encrypted',
      'access_expires_at', 'refresh_expires_at', 'granted_scopes',
      'credential_generation', 'credential_state', 'rotation_lease_token',
      'rotation_lease_expires_at', 'rotation_started_at', 'created_at', 'updated_at',
    ]) {
      const timestamps = ['created_at', 'updated_at'].includes(name)
        && tableNodes.some(node => method(node, 'timestamps'));
      expect({ column: name, declared: columnNames.includes(name) || timestamps
        || new RegExp(`(?:^|,)\\s*${name}\\s+\\w+`).test(tableSql) })
        .toEqual({ column: name, declared: true });
    }
    const literalList = (node?: ts.Node): string[] | undefined => {
      if (node && ts.isStringLiteral(node)) return [node.text];
      if (node && ts.isArrayLiteralExpression(node)
        && node.elements.every(ts.isStringLiteral)) {
        return node.elements.map(element => (element as ts.StringLiteral).text);
      }
      return undefined;
    };
    const receiver = callback && (ts.isArrowFunction(callback) || ts.isFunctionExpression(callback))
      ? callback.parameters[0]?.name : undefined;
    const chains = tableNodes.filter(ts.isExpressionStatement).map(statement => {
      const calls: ts.CallExpression[] = [];
      let base: ts.Expression = statement.expression;
      while (ts.isCallExpression(base) && ts.isPropertyAccessExpression(base.expression)) {
        calls.unshift(base);
        base = base.expression.expression;
      }
      return receiver && ts.isIdentifier(receiver) && ts.isIdentifier(base)
        && base.text === receiver.text ? calls : [];
    });
    const anchor = 'installation_id';
    const declaredColumn = (calls: ts.CallExpression[]) => calls.find(call =>
      method(call, 'integer') || method(call, 'bigInteger'));
    const mapsInstallationToId = (child?: string[], parent?: string[]) => {
      if (!child || !parent || child.length !== parent.length) return false;
      const index = child.indexOf(anchor);
      return index >= 0 && parent[index] === 'id';
    };
    const knexFk = chains.some(calls => {
      const inTable = calls.find(call => method(call, 'inTable'));
      const foreign = calls.find(call => method(call, 'foreign')) ?? declaredColumn(calls);
      const references = calls.find(call => method(call, 'references'));
      return m.value(inTable?.arguments[0])?.replace(/^public\./, '') === 'shopify_app_installations'
        && mapsInstallationToId(literalList(foreign?.arguments[0]), literalList(references?.arguments[0]));
    });
    const sqlFk = [...tableSql.matchAll(/foreign key\s*\(([^)]+)\)\s*references\s+(?:public\.)?shopify_app_installations\s*\(([^)]+)\)/g)]
      .some(match => mapsInstallationToId(columns(match[1]), columns(match[2])));
    const inlineFk = /(?:^|,)\s*installation_id\s+[^,]*?references\s+(?:public\.)?shopify_app_installations\s*\(\s*id\s*\)/.test(tableSql);
    expect(columnNames.includes(anchor)
      || /(?:^|,)\s*installation_id\s+\w+/.test(tableSql)).toBe(true);
    expect(knexFk || sqlFk || inlineFk).toBe(true);
    const uniqueKnex = chains.some(calls => {
      const unique = calls.find(call => method(call, 'unique'));
      if (!unique) return false;
      const pair = unique.arguments.length > 0
        ? literalList(unique.arguments[0])
        : literalList(declaredColumn(calls)?.arguments[0]);
      return pair?.length === 1 && pair[0] === anchor;
    });
    const uniqueSql = [...tableSql.matchAll(/(?:unique|primary key)\s*\(([^)]+)\)/g)]
      .some(match => columns(match[1]).length === 1 && columns(match[1])[0] === anchor)
      || new RegExp(`(?:^|,)\\s*${anchor}\\s+[^,]*\\bunique\\b`).test(tableSql)
      || new RegExp(`create unique index\\s+\\w+\\s+on\\s+(?:public\\.)?${credentialTable}\\s*\\(\\s*${anchor}\\s*\\)\\s*;`).test(m.sql);
    expect(uniqueKnex || uniqueSql).toBe(true);
  });

  it('binds credential installation and shop to the same tenant at the database boundary', () => {
    const m = credentialMigration();
    const parentTable = 'shopify_app_installations';
    const parentKeys: string[][] = [];
    const bindings: { child: string[]; parent: string[] }[] = [];
    const columnList = (node?: ts.Node): string[] => {
      if (node && ts.isArrayLiteralExpression(node)) {
        return node.elements.map(element => m.value(element) ?? '');
      }
      const text = m.value(node);
      return text === undefined ? [] : columns(text);
    };
    const isParentPair = (pair: string[]) => pair.length === 2
      && [...pair].sort().join(',') === 'id,shop_id';

    // Inspect schema callbacks and actual call chains, never comment text.
    for (const schema of m.forward) {
      if (!(method(schema, 'createTable') || method(schema, 'alterTable') || method(schema, 'table'))) continue;
      const target = m.value(schema.arguments[0])?.replace(/^public\./, '');
      const callback = schema.arguments[1];
      if (!callback || !(ts.isArrowFunction(callback) || ts.isFunctionExpression(callback))) continue;
      const receiver = callback.parameters[0]?.name;
      if (!receiver || !ts.isIdentifier(receiver)) continue;
      for (const statement of nodes(callback).filter(ts.isExpressionStatement)) {
        const calls: ts.CallExpression[] = [];
        let base: ts.Expression = statement.expression;
        while (ts.isCallExpression(base) && ts.isPropertyAccessExpression(base.expression)) {
          calls.unshift(base);
          base = base.expression.expression;
        }
        if (!ts.isIdentifier(base) || base.text !== receiver.text) continue;
        if (target === parentTable) {
          const key = calls.find(call => method(call, 'unique') || method(call, 'primary'));
          if (key) parentKeys.push(columnList(key.arguments[0]));
        }
        if (target === credentialTable) {
          const foreign = calls.find(call => method(call, 'foreign'));
          const references = calls.find(call => method(call, 'references'));
          const inTable = calls.find(call => method(call, 'inTable'));
          if (foreign && references && inTable
            && m.value(inTable.arguments[0])?.replace(/^public\./, '') === parentTable) {
            bindings.push({ child: columnList(foreign.arguments[0]), parent: columnList(references.arguments[0]) });
          }
        }
      }
    }

    // Scope raw constraints to their owning CREATE/ALTER TABLE, including
    // multiple ALTER commands and optional constraint names.
    for (const statement of m.sql.split(';')) {
      const create = /^create table (?:if not exists )?(?:public\.)?(\w+)\s*\(/.exec(statement.trim());
      const alter = /^alter table (?:only )?(?:public\.)?(\w+)\s+/.exec(statement.trim());
      const target = create?.[1] ?? alter?.[1];
      const body = create
        ? parenthesized(statement.trim(), create[0].length - 1)
        : alter ? statement.trim().slice(alter[0].length) : '';
      if (target === parentTable) {
        for (const key of body.matchAll(/(?:^|,)\s*(?:add\s+)?(?:constraint\s+\w+\s+)?(?:unique|primary key)\s*\(([^)]+)\)/g)) {
          parentKeys.push(columns(key[1]));
        }
      }
      if (target === credentialTable) {
        for (const fk of body.matchAll(/(?:^|,)\s*(?:add\s+)?(?:constraint\s+\w+\s+)?foreign key\s*\(([^)]+)\)\s*references\s+(?:public\.)?shopify_app_installations\s*\(([^)]+)\)/g)) {
          bindings.push({ child: columns(fk[1]), parent: columns(fk[2]) });
        }
      }
    }
    // Reversed order is valid only when the FK preserves both positional
    // mappings and PostgreSQL has an explicit unique/primary parent pair.
    const sameTenantBinding = bindings.some(({ child, parent }) =>
      child.length === 2 && isParentPair(parent)
      && child[parent.indexOf('id')] === 'installation_id'
      && child[parent.indexOf('shop_id')] === 'shop_id');
    expect({
      parentHasExplicitUniqueOrPrimaryKeyOnIdAndShopId: parentKeys.some(isParentPair),
      credentialHasCompositeInstallationAndShopForeignKeyToSameTenant: sameTenantBinding,
    }).toEqual({
      parentHasExplicitUniqueOrPrimaryKeyOnIdAndShopId: true,
      credentialHasCompositeInstallationAndShopForeignKeyToSameTenant: true,
    });
  });

  it('enforces positive-tenant FORCE-RLS and relaxes both legacy tokens without dropping them', () => {
    const m = credentialMigration();
    for (const mode of ['enable', 'force']) {
      expect(m.sql).toMatch(new RegExp(`alter table (?:public\\.)?${credentialTable} ${mode} row level security`));
    }
    const policies = m.sql.split(';').filter(sql => /create policy\b/.test(sql)
      && new RegExp(`\\bon (?:public\\.)?${credentialTable}\\b`).test(sql));
    expect(policies.length).toBeGreaterThan(0);
    const using: string[] = [];
    const checks: string[] = [];
    for (const policy of policies) {
      for (const clause of policy.matchAll(/\b(using|with check)\s*\(/g)) {
        const expression = parenthesized(policy, clause.index! + clause[0].length - 1);
        strictTenant(expression);
        (clause[1] === 'using' ? using : checks).push(expression);
      }
    }
    expect(using.length).toBeGreaterThan(0);
    expect(checks.length).toBeGreaterThan(0);
    for (const [table, token] of [
      ['integrations', 'access_token_encrypted'], ['shopify_app_installations', 'access_token'],
    ]) {
      const rawNullable = new RegExp(`alter table (?:public\\.)?${table}\\s+alter (?:column )?${token}\\s+drop not null`).test(m.sql);
      const knexNullable = m.forward.some(node => (method(node, 'alterTable') || method(node, 'table'))
        && m.value(node.arguments[0]) === table && node.arguments[1]
        && nodes(node.arguments[1]).some(child => ts.isExpressionStatement(child)
          && new RegExp(`\\(['"]${token}['"]\\)\\.nullable\\(\\)\\.alter\\(`)
            .test(child.getText().replace(/\s+/g, ''))));
      expect({ table, token, nullable: rawNullable || knexNullable }).toEqual({ table, token, nullable: true });
      expect(m.sql).not.toMatch(new RegExp(`drop (?:column )?(?:if exists )?${token}\\b|drop table (?:if exists )?(?:public\\.)?${table}\\b`));
      expect(m.forward.some(node => method(node, 'dropColumn') && m.value(node.arguments[0]) === token)).toBe(false);
    }
  });

  it('declares integrations:write in ACTION_ROLE_MAP for exactly owner and admin', () => {
    const source = parse('apps/backend/src/middleware/require-action.middleware.ts');
    const declaration = nodes(source).find(node => ts.isVariableDeclaration(node)
      && ts.isIdentifier(node.name) && node.name.text === 'ACTION_ROLE_MAP') as ts.VariableDeclaration;
    expect(ts.isObjectLiteralExpression(declaration.initializer!)).toBe(true);
    const map = declaration.initializer as ts.ObjectLiteralExpression;
    const action = map.properties.find(node => ts.isPropertyAssignment(node)
      && literal(node.name) === 'integrations:write') as ts.PropertyAssignment | undefined;
    expect(action).toBeDefined();
    expect(ts.isArrayLiteralExpression(action!.initializer)).toBe(true);
    const roles = (action!.initializer as ts.ArrayLiteralExpression).elements.map(literal);
    expect(roles).toHaveLength(2);
    expect([...roles].sort()).toEqual(['admin', 'owner']);
  });

  it('guards authenticated reconnect with canonical requireAction while keeping fresh install separate', () => {
    const source = parse('apps/backend/src/api/integrations/integration.routes.ts');
    const routes = nodes(source).filter(node => method(node, 'get')) as ts.CallExpression[];
    const reconnect = routes.filter(route => literal(route.arguments[0]) === '/oauth/initiate');
    const install = routes.filter(route => literal(route.arguments[0]) === '/shopify/install');
    expect(reconnect).toHaveLength(1);
    expect(install).toHaveLength(1);
    expect(reconnect[0].arguments.slice(1).map(node => node.getText())).toContain('authenticateToken');
    expect(install[0].arguments.slice(1).map(node => node.getText())).toContain('handleShopifyInstall');
    expect(install[0].arguments.slice(1).map(node => node.getText())).not.toContain('authenticateToken');
    expect(nodes(install[0]).some(node => ts.isCallExpression(node)
      && ts.isIdentifier(node.expression) && node.expression.text === 'requireAction')).toBe(false);
    const guardIndex = reconnect[0].arguments.findIndex(node => ts.isCallExpression(node)
      && ts.isIdentifier(node.expression) && node.expression.text === 'requireAction'
      && literal(node.arguments[0]) === 'integrations:write');
    expect(guardIndex).toBeGreaterThan(0);
    const authIndex = reconnect[0].arguments.findIndex(node => ts.isIdentifier(node) && node.text === 'authenticateToken');
    const handlerIndex = reconnect[0].arguments.findIndex(node => ts.isIdentifier(node) && node.text === 'initiateOAuth');
    expect(authIndex).toBeLessThan(guardIndex);
    expect(handlerIndex).toBeGreaterThan(guardIndex);
    const canonical = source.statements.filter(ts.isImportDeclaration).find(node =>
      literal(node.moduleSpecifier)?.endsWith('/middleware/require-action.middleware.js')
      || literal(node.moduleSpecifier)?.endsWith('/middleware/require-action.middleware'));
    expect(canonical).toBeDefined();
    const bindings = canonical!.importClause?.namedBindings;
    expect(bindings && ts.isNamedImports(bindings)
      && bindings.elements.some(binding => binding.name.text === 'requireAction'
        && (binding.propertyName?.text ?? binding.name.text) === 'requireAction')).toBe(true);
  });
});
