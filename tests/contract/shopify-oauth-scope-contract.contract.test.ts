/**
 * SHOP-REVIEW-OAUTH-REGRESSION-162 — Slice 162A.
 *
 * DB-free regression pin for the Shopify OAuth scope contract that previously
 * failed Shopify review:
 *   - OAUTH-SCOPES-01 / SHOPIFY-LOCATION-SCOPE-01 (2026-08-13): scope drift
 *     across the reconnect flow, the App Store flow, shopify.app.toml and the
 *     Shopify client; `read_locations` missing from the required contract; the
 *     callback ignoring Shopify's returned grant.
 *   - SHOPIFY-SCOPE-ACTIVE-VERSION-04 (2026-08-28): a real fresh OAuth failed
 *     closed with `SHOPIFY_REQUIRED_SCOPES_MISSING:read_locations`.
 *
 * Authoritative source : apps/backend/src/services/shopify/shopifyScopes.ts
 * Authoritative docs    : docs/playbooks/shopify_submission_playbook.md
 *                         ("Shopify OAuth Scope Contract — verified 2026-08-13")
 *                         docs/playbooks/oauth_scopes_location_scope_2026_08_13.md
 *                         ("Canonical required scope contract")
 * The source array and BOTH playbooks list the same 10 scopes in the same order;
 * that order is asserted below.
 *
 * Pure module: no DB, no createApp(), no HTTP server, no axios, no Shopify call,
 * no environment / root-.env dependency. `shopifyScopes.ts` has no imports.
 */
import {
  SHOPIFY_REQUIRED_SCOPES,
  SHOPIFY_REQUIRED_SCOPE_STRING,
  normalizeAndValidateShopifyGrantedScopes,
} from 'api-src/services/shopify/shopifyScopes';

// The documented authoritative required contract — identical in shopifyScopes.ts,
// shopify_submission_playbook.md and oauth_scopes_location_scope_2026_08_13.md.
const DOCUMENTED_REQUIRED_SCOPES = [
  'read_products',
  'read_orders',
  'read_customers',
  'read_inventory',
  'write_inventory',
  'read_locations',
  'read_fulfillments',
  'write_fulfillments',
  'read_merchant_managed_fulfillment_orders',
  'write_merchant_managed_fulfillment_orders',
] as const;

const EFFECTIVE_SORTED = [...DOCUMENTED_REQUIRED_SCOPES].sort().join(',');
const sortedOf = (xs: readonly string[]) => [...xs].sort();

describe('SHOP-REVIEW-OAUTH-REGRESSION-162 — required Shopify scope set', () => {
  it('SHOPIFY_REQUIRED_SCOPES is exactly the documented 10 scopes, in documented order', () => {
    expect(SHOPIFY_REQUIRED_SCOPES).toEqual(DOCUMENTED_REQUIRED_SCOPES);
    expect(SHOPIFY_REQUIRED_SCOPES).toHaveLength(10);
    expect(new Set(SHOPIFY_REQUIRED_SCOPES).size).toBe(10); // no duplicates
  });

  it('read_locations is a required scope', () => {
    expect(SHOPIFY_REQUIRED_SCOPES).toContain('read_locations');
  });

  it('SHOPIFY_REQUIRED_SCOPE_STRING is the exact comma-join of the required set — no whitespace, no drift', () => {
    expect(SHOPIFY_REQUIRED_SCOPE_STRING).toBe(DOCUMENTED_REQUIRED_SCOPES.join(','));
    expect(SHOPIFY_REQUIRED_SCOPE_STRING).not.toMatch(/\s/);

    const parts = SHOPIFY_REQUIRED_SCOPE_STRING.split(',');
    expect(parts).toHaveLength(10);
    expect(sortedOf(parts)).toEqual(sortedOf(DOCUMENTED_REQUIRED_SCOPES));
    expect(parts).toContain('read_locations');
  });
});

describe('normalizeAndValidateShopifyGrantedScopes — fail-closed granted-scope validation', () => {
  it('accepts a full explicit grant (any order) and returns the sorted effective set', () => {
    const granted = [...DOCUMENTED_REQUIRED_SCOPES].reverse().join(',');
    const effective = normalizeAndValidateShopifyGrantedScopes(granted);
    expect(effective).toBe(EFFECTIVE_SORTED);
    expect(effective.split(',')).toHaveLength(10);
  });

  it('accepts the compact grant where write_* stand in for read_* (verified dev-store shape) and returns all 10', () => {
    // 7 explicit grants — the 3 implied reads are omitted by Shopify.
    const compact = [
      'read_products',
      'read_orders',
      'read_customers',
      'write_inventory',
      'read_locations',
      'write_fulfillments',
      'write_merchant_managed_fulfillment_orders',
    ].join(',');
    expect(normalizeAndValidateShopifyGrantedScopes(compact)).toBe(EFFECTIVE_SORTED);
  });

  it.each<[string, string]>([
    ['write_inventory', 'read_inventory'],
    ['write_fulfillments', 'read_fulfillments'],
    ['write_merchant_managed_fulfillment_orders', 'read_merchant_managed_fulfillment_orders'],
  ])('%s implies %s', (_writeScope, impliedRead) => {
    // Full required set minus the implied read; the retained write grant must restore it.
    const granted = DOCUMENTED_REQUIRED_SCOPES.filter((s) => s !== impliedRead).join(',');
    const effective = normalizeAndValidateShopifyGrantedScopes(granted);
    expect(effective.split(',')).toContain(impliedRead);
    expect(effective).toBe(EFFECTIVE_SORTED);
  });

  it('fails closed when read_locations is not granted', () => {
    const granted = DOCUMENTED_REQUIRED_SCOPES.filter((s) => s !== 'read_locations').join(',');
    expect(() => normalizeAndValidateShopifyGrantedScopes(granted)).toThrow(
      'SHOPIFY_REQUIRED_SCOPES_MISSING:read_locations',
    );
  });

  it('fails closed when another required scope is not granted', () => {
    const granted = DOCUMENTED_REQUIRED_SCOPES.filter((s) => s !== 'read_products').join(',');
    expect(() => normalizeAndValidateShopifyGrantedScopes(granted)).toThrow(
      'SHOPIFY_REQUIRED_SCOPES_MISSING:read_products',
    );
  });

  it('rejects an empty string with SHOPIFY_GRANTED_SCOPES_MISSING', () => {
    expect(() => normalizeAndValidateShopifyGrantedScopes('')).toThrow('SHOPIFY_GRANTED_SCOPES_MISSING');
  });

  it('rejects a whitespace-only string with SHOPIFY_GRANTED_SCOPES_MISSING', () => {
    expect(() => normalizeAndValidateShopifyGrantedScopes('   ')).toThrow('SHOPIFY_GRANTED_SCOPES_MISSING');
  });

  it.each<[string, unknown]>([
    ['undefined', undefined],
    ['null', null],
    ['a number', 42],
    ['an object', { scope: 'read_products' }],
    ['an array', ['read_products']],
  ])('rejects a non-string granted-scope value (%s) with SHOPIFY_GRANTED_SCOPES_MISSING', (_label, value) => {
    expect(() => normalizeAndValidateShopifyGrantedScopes(value)).toThrow('SHOPIFY_GRANTED_SCOPES_MISSING');
  });
});
