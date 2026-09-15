// MON-REM-01B-3 — permanent commercial-capacity ownership contracts.

import fs from 'fs';
import path from 'path';

const ROOT = process.cwd();
const MEMBERS_CONTROLLER = path.join(
  ROOT,
  'apps/backend/src/api/members/members.controller.ts'
);

const SEAT_CAPACITY_SERVICE = path.join(
  ROOT,
  'apps/backend/src/services/billing/seat-capacity.service.ts'
);

function read(rel: string): string {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}

function walk(dir: string): string[] {
  const out: string[] = [];

  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === 'dist') continue;
      out.push(...walk(full));
      continue;
    }

    if (entry.isFile() && entry.name.endsWith('.ts')) {
      out.push(full);
    }
  }

  return out;
}

function createMemberBody(): string {
  const src = fs.readFileSync(MEMBERS_CONTROLLER, 'utf8');
  const start = src.indexOf('export const createMember');
  const end = src.indexOf('export const revokeMember', start);

  if (start < 0 || end < 0) {
    throw new Error('createMember source boundary not found');
  }

  return src.slice(start, end);
}

describe('MON-REM-01B-3 — seat/location commercial boundaries', () => {
  it('GREEN CONTROL: shared seat-capacity resolver owns canonical commercial-policy limits', () => {
    const service = fs.readFileSync(SEAT_CAPACITY_SERVICE, 'utf8');

    expect(service).toMatch(
      /from\s+['"]@lasyncro\/commercial-policy['"]/
    );

    expect(service).toMatch(
      /standardLimits\s*\(/
    );
  });

  it('GREEN CONTROL: createMember never treats JWT tier as seat-capacity truth', () => {
    const body = createMemberBody();
    const service = fs.readFileSync(SEAT_CAPACITY_SERVICE, 'utf8');

    expect(body).not.toMatch(
      /req\.user(?:!|\?)?\.tier|req\.user!\.tier|req\.user\?\.tier/
    );

    expect(body).toMatch(
      /resolveSeatCapacity\s*\(/
    );

    expect(service).toMatch(
      /trx\(['"]shop_subscriptions['"]\)/
    );

    expect(service).toMatch(
      /\.select\(['"]tier['"],\s*['"]extra_seats['"]\)/
    );
  });

  it('GREEN CONTROL: seat check is serialized on the authoritative per-shop subscription row', () => {
    const body = createMemberBody();
    const service = fs.readFileSync(SEAT_CAPACITY_SERVICE, 'utf8');

    // The shared resolver owns the authoritative subscription-row lock.
    expect(service).toMatch(
      /if\s*\(options\.lockSubscription\)[\s\S]{0,250}subscriptionQuery\s*=\s*subscriptionQuery\.forUpdate\(\)/
    );

    // Capacity observation is performed in that same resolver transaction.
    expect(service).toMatch(
      /trx\(['"]shop_memberships['"]\)[\s\S]{0,700}\.count\(['"]id as count['"]\)/
    );

    // createMember explicitly requests the lock and then performs both writes
    // with the same trx after capacity has been resolved.
    const resolveIndex = body.indexOf('resolveSeatCapacity(trx, shopId');
    const lockIndex = body.indexOf('lockSubscription: true', resolveIndex);
    const userInsertIndex = body.indexOf("trx('users')", lockIndex);
    const membershipInsertIndex = body.indexOf(
      "trx('shop_memberships')",
      userInsertIndex,
    );

    expect(resolveIndex).toBeGreaterThanOrEqual(0);
    expect(lockIndex).toBeGreaterThan(resolveIndex);
    expect(userInsertIndex).toBeGreaterThan(lockIndex);
    expect(membershipInsertIndex).toBeGreaterThan(userInsertIndex);
  });

  it('EXPECTED RED: Scale seat enforcement contains no unlimited/Infinity escape hatch', () => {
    const body = createMemberBody();

    expect(body).not.toMatch(/\bInfinity\b/);
    expect(body).not.toMatch(/Scale[\s\S]{0,100}unlimited/i);
  });

  it('GREEN CONTROL: no merchant warehouse-root creation boundary exists without quota awareness', () => {
    const srcRoot = path.join(ROOT, 'apps/backend/src');

    const allowedBootstrapOwners = new Set([
      'apps/backend/src/api/auth/auth.controller.ts',
      'apps/backend/src/api/integrations/integration.controller.ts',
    ]);

    const violations: string[] = [];

    for (const file of walk(srcRoot)) {
      const rel = path.relative(ROOT, file).replace(/\\/g, '/');

      if (rel.includes('/scripts/')) continue;

      const src = fs.readFileSync(file, 'utf8');

      const createsWarehouse =
        /(?:trx|db)\(['"]warehouses['"]\)\s*\.insert\(/.test(src);

      if (!createsWarehouse) continue;

      if (allowedBootstrapOwners.has(rel)) continue;

      const quotaAware =
        /\blocationLimit\b|\bstandardLimits\s*\(/.test(src);

      if (!quotaAware) violations.push(rel);
    }

    expect(violations).toEqual([]);
  });

  it('GREEN CONTROL: finite canonical location limits remain ratified', () => {
    const limits = read('packages/commercial-policy/src/limits.ts');

    expect(limits).toMatch(/starter[\s\S]{0,350}locationLimit:\s*1/);
    expect(limits).toMatch(/core[\s\S]{0,350}locationLimit:\s*1/);
    expect(limits).toMatch(/growth[\s\S]{0,350}locationLimit:\s*3/);
    expect(limits).toMatch(/scale[\s\S]{0,350}locationLimit:\s*10/);
  });
});
