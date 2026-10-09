/** SHOP-REVIEW-AUTH-01 RED-3A — live schema authority only; no application fixtures. */
import knex, { type Knex } from 'knex';

type Column = { not_null: boolean; type_name: string; default_expression: string | null };
type Check = { expression: string; validated: boolean };
let catalog: Knex;

beforeAll(() => {
  // Also guarded by the backend-integration project before this file loads.
  if (!/^synchroflow_test_[A-Za-z0-9_]+$/.test(process.env.PGDATABASE ?? '')) {
    throw new Error('RED3A_REQUIRES_DISPOSABLE_DATABASE');
  }
  catalog = knex({
    client: 'pg',
    connection: {
      host: process.env.PGHOST,
      port: Number(process.env.PGPORT),
      user: process.env.PGUSER,
      password: process.env.PGPASSWORD,
      database: process.env.PGDATABASE,
    },
    pool: { min: 0, max: 1 },
  });
});

afterAll(async () => {
  if (catalog) await catalog.destroy();
});

async function column(name: string): Promise<Column> {
  const { rows } = await catalog.raw(`
    SELECT a.attnotnull AS not_null, t.typname AS type_name,
           pg_catalog.pg_get_expr(d.adbin, d.adrelid) AS default_expression
      FROM pg_catalog.pg_attribute a
      JOIN pg_catalog.pg_type t ON t.oid = a.atttypid
      LEFT JOIN pg_catalog.pg_attrdef d
        ON d.adrelid = a.attrelid AND d.adnum = a.attnum
     WHERE a.attrelid = 'public.shopify_admin_credentials'::regclass
       AND a.attname = ? AND NOT a.attisdropped
  `, [name]);
  expect(rows).toHaveLength(1);
  return rows[0];
}

async function checks(name: string): Promise<Check[]> {
  const { rows } = await catalog.raw(`
    SELECT pg_catalog.pg_get_expr(c.conbin, c.conrelid) AS expression,
           c.convalidated AS validated
      FROM pg_catalog.pg_constraint c
      JOIN pg_catalog.pg_attribute a
        ON a.attrelid = c.conrelid AND a.attname = ?
     WHERE c.conrelid = 'public.shopify_admin_credentials'::regclass
       AND c.contype = 'c' AND c.conkey = ARRAY[a.attnum]::smallint[]
  `, [name]);
  return rows;
}

async function defaultValue(name: string): Promise<unknown> {
  const { default_expression: expression } = await column(name);
  if (expression === null) return null;
  // Evaluate the live catalog default in PostgreSQL, independent of cast/parentheses.
  const { rows } = await catalog.raw(`SELECT (${expression}) AS value`);
  return rows[0].value;
}

/** Ignore PostgreSQL deparser casts/parentheses, never arbitrary boolean branches. */
function comparison(expression: string): string {
  return expression.replace(
    /'(?:[^']|'')*'|::(?:text|bigint|integer|numeric)\b|[()]|"credential_state"|"credential_generation"/gi,
    token => token.startsWith("'") ? token : token.startsWith('"') ? token.slice(1, -1) : '',
  ).trim();
}

/** Recognize finite membership, rather than merely finding state words in SQL. */
function allowedStates(expression: string): string[] | null {
  const normalized = comparison(expression);
  const membership = /^credential_state\s*=\s*ANY\s+ARRAY\[([\s\S]*)\]$/i.exec(normalized);
  let literals: string[];
  if (membership) {
    literals = membership[1].split(',').map(value => value.trim());
  } else {
    const terms = normalized.split(/\s+OR\s+/i);
    literals = [];
    for (const term of terms) {
      const equality = /^credential_state\s*=\s*('(?:[^']|'')*')$/i.exec(term.trim());
      if (!equality) return null;
      literals.push(equality[1]);
    }
  }
  if (!literals.length || literals.some(value => !/^'(?:[^']|'')*'$/.test(value))) return null;
  return [...new Set(literals.map(value => value.slice(1, -1).replace(/''/g, "'")))].sort();
}

describe('SHOP-REVIEW-AUTH-01 RED-3A — public.shopify_admin_credentials schema authority', () => {
  it('R3A-1: credential_state is mandatory', async () => {
    expect((await column('credential_state')).not_null).toBe(true);
  });

  it('R3A-2: credential_state defaults to ACTIVE', async () => {
    expect(await defaultValue('credential_state')).toBe('ACTIVE');
  });

  it('R3A-3: credential_state has exact ACTIVE / REAUTH_REQUIRED CHECK enforcement', async () => {
    const constraints = (await checks('credential_state')).filter(check => check.validated);
    const stateSets = constraints.map(check => allowedStates(check.expression));
    expect(stateSets).toContainEqual(['ACTIVE', 'REAUTH_REQUIRED']);
    const constraint = constraints.find(check =>
      JSON.stringify(allowedStates(check.expression)) === JSON.stringify(['ACTIVE', 'REAUTH_REQUIRED']))!;
    // Evaluate the actual DB CHECK on typed values, without tenant/FK fixtures.
    // CHECK permits NULL; R3A-1 separately protects the required NOT NULL boundary.
    for (const state of ['ACTIVE', 'REAUTH_REQUIRED', 'REFRESHING', 'ROTATING',
      'EXPIRED', 'FAILED', 'INVALID', 'PENDING', 'ARBITRARY_STATE', '', 'ACTIVE ']) {
      const { rows } = await catalog.raw(`
        SELECT (${constraint.expression}) IS FALSE AS rejected
          FROM (SELECT ?::text AS credential_state) AS candidate
      `, [state]);
      expect({ state, rejected: rows[0].rejected }).toEqual({
        state, rejected: state !== 'ACTIVE' && state !== 'REAUTH_REQUIRED',
      });
    }
  });

  it('R3A-4: credential_generation is mandatory bigint', async () => {
    const generation = await column('credential_generation');
    expect(generation.not_null).toBe(true);
    // int8 is PostgreSQL's canonical catalog identity for SQL bigint.
    expect(generation.type_name).toBe('int8');
  });

  it('R3A-5: credential_generation defaults to zero', async () => {
    // PostgreSQL bigint defaults may be returned by the driver as a string.
    expect(String(await defaultValue('credential_generation'))).toBe('0');
  });

  it('R3A-6: credential_generation has effective non-negative CHECK protection', async () => {
    const constraints = (await checks('credential_generation')).filter(check => check.validated);
    const constraint = constraints.find(check => {
      const expression = comparison(check.expression).replace(/\s+/g, '');
      return ['credential_generation>=0', '0<=credential_generation',
        'credential_generation>-1', '-1<credential_generation'].includes(expression);
    });
    expect(constraint).toBeDefined();
    for (const generation of ['-9223372036854775808', '-1', '0', '1', '9223372036854775807']) {
      const { rows } = await catalog.raw(`
        SELECT (${constraint!.expression}) IS FALSE AS rejected
          FROM (SELECT ?::bigint AS credential_generation) AS candidate
      `, [generation]);
      expect({ generation, rejected: rows[0].rejected }).toEqual({
        generation, rejected: generation.startsWith('-'),
      });
    }
  });
});
