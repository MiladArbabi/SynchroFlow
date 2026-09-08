// tests/contract/commercial-provider-mapping-boundary.contract.test.ts
//
// BILL-ENTITLEMENT-01 / P0-B3 — architecture contract for provider->tier
// mapping authority. PERMANENT, authored RED.
// ===========================================================================
// WHAT THIS PROTECTS
//   P0-B2 proved every authoritative write goes through one service and leaves
//   provenance. It said nothing about whether the VALUE being written is
//   grounded in what the merchant actually bought. This contract governs that:
//
//     - Stripe tier must not be derived from sub.metadata.tier
//     - Stripe tier must come through the canonical provider-price resolver
//     - Shopify tier must not be derived from AppSubscription.name
//     - Shopify tier must come from planHandle through the canonical resolver
//     - provider-derived writes still route through transitionShopSubscription
//     - provider ownership is enforced AT the transition boundary
//
// MECHANISM
//   ARCH-01 is a real taint walk over the TypeScript AST: it marks every local
//   initialized from a `metadata.tier` access, propagates the taint through
//   derived locals, then checks whether the value handed to the transition
//   service as `to.tier` is tainted. A same-line grep cannot do this — today's
//   handler launders metadata through `rawTier` and then a ternary before the
//   value reaches the call.
//
//   ARCH-02..06 are wiring/existence checks: they assert which module a file
//   depends on and which symbol it calls, which is a structural fact, not a
//   behavioural guess.
//
// SCANNER SELF-VERIFICATION
//   Every synthetic-source test below must PASS both before and after the fix.
//   They exist so the real-source assertions can never pass vacuously.

import fs from 'fs';
import path from 'path';
import ts from 'typescript';

const REPO = path.resolve(__dirname, '../..');

const STRIPE_UPSERT = 'apps/backend/src/api/billing/handlers/handleSubscriptionUpsert.ts';
const SHOPIFY_RECONCILIATION =
  'apps/backend/src/services/shopify/shopifyBillingReconciliation.service.ts';
const SHOPIFY_APPLY = 'apps/backend/src/services/shopify/applyShopifyBillingState.service.ts';
const TRANSITION_SERVICE = 'apps/backend/src/services/billing/subscriptionTransition.service.ts';
const INTEGRATION_CONTROLLER = 'apps/backend/src/api/integrations/integration.controller.ts';

const STRIPE_RESOLVER_MODULE = 'providerPriceResolver.service';
const SHOPIFY_RESOLVER_MODULE = 'shopifyCommercialResolver.service';

const read = (rel: string) => fs.readFileSync(path.join(REPO, rel), 'utf8');

// ---------------------------------------------------------------------------
// ARCH-01 scanner — metadata taint walk
// ---------------------------------------------------------------------------

/**
 * Returns the text handed to transitionShopSubscription as `to.tier`, plus the
 * set of locals tainted by a `metadata.tier` read. A violation is a `to.tier`
 * expression that references any tainted local.
 */
export function analyzeMetadataTierTaint(
  fileName: string,
  sourceText: string
): { toTierExpression: string | null; taintedLocals: string[]; violation: boolean } {
  const src = ts.createSourceFile(fileName, sourceText, ts.ScriptTarget.Latest, true);
  const tainted = new Set<string>();

  const declarations: Array<{ name: string; initText: string }> = [];
  let toTierExpression: string | null = null;

  const isMetadataTierAccess = (node: ts.Node): boolean =>
    ts.isPropertyAccessExpression(node) &&
    node.name.text === 'tier' &&
    /(^|[.?\s(])metadata\b/.test(node.expression.getText(src));

  const visit = (node: ts.Node) => {
    // Collect every local declaration with its initializer text.
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) {
      const initText = node.initializer.getText(src);
      declarations.push({ name: node.name.text, initText });

      let seeded = false;
      const seed = (n: ts.Node) => {
        if (isMetadataTierAccess(n)) seeded = true;
        ts.forEachChild(n, seed);
      };
      seed(node.initializer);
      if (seeded) tainted.add(node.name.text);
    }

    // Locate transitionShopSubscription(...) -> arg0.to.tier
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === 'transitionShopSubscription'
    ) {
      const arg0 = node.arguments[0];
      if (arg0 && ts.isObjectLiteralExpression(arg0)) {
        for (const prop of arg0.properties) {
          if (
            ts.isPropertyAssignment(prop) &&
            prop.name.getText(src) === 'to' &&
            ts.isObjectLiteralExpression(prop.initializer)
          ) {
            for (const inner of prop.initializer.properties) {
              if (ts.isPropertyAssignment(inner) && inner.name.getText(src) === 'tier') {
                toTierExpression = inner.initializer.getText(src);
              } else if (ts.isShorthandPropertyAssignment(inner) && inner.name.text === 'tier') {
                toTierExpression = 'tier';
              }
            }
          }
        }
      }
    }

    ts.forEachChild(node, visit);
  };
  visit(src);

  // Propagate taint through derived locals until stable.
  let changed = true;
  while (changed) {
    changed = false;
    for (const decl of declarations) {
      if (tainted.has(decl.name)) continue;
      for (const t of tainted) {
        if (new RegExp(`\\b${t}\\b`).test(decl.initText)) {
          tainted.add(decl.name);
          changed = true;
          break;
        }
      }
    }
  }

  const violation =
    toTierExpression !== null &&
    [...tainted].some((t) => new RegExp(`\\b${t}\\b`).test(toTierExpression as string));

  return { toTierExpression, taintedLocals: [...tainted].sort(), violation };
}

const COMPLIANT_STRIPE_SOURCE = `
  import { resolveStripeSubscriptionCommercial } from '../../../services/billing/providerPriceResolver.service.js';
  export async function handleSubscriptionUpsert(envelope: any, trx: any) {
    const sub = envelope.rawPayload as any;
    const commercial = resolveStripeSubscriptionCommercial(sub);
    await transitionShopSubscription(
      {
        shopId: envelope.shopId,
        to: { tier: commercial.tier, status: sub.status },
        metadata: { metadata_tier: sub.metadata?.tier, disagreement: commercial.metadataDisagreement },
        source: 'stripe_webhook', reason: envelope.eventType, actorType: 'stripe',
      },
      trx
    );
  }
`;

const LAUNDERED_METADATA_SOURCE = `
  export async function handleSubscriptionUpsert(envelope: any, trx: any) {
    const sub = envelope.rawPayload as any;
    const rawTier = sub?.metadata?.tier;
    const status = sub?.status ?? 'active';
    const tier = status === 'canceled' ? 'starter' : (rawTier as any);
    await transitionShopSubscription(
      { shopId: envelope.shopId, to: { tier, status },
        source: 'stripe_webhook', reason: 'x', actorType: 'stripe' },
      trx
    );
  }
`;

describe('P0-B3 — commercial provider mapping boundary', () => {
  // ── Scanner self-verification (must pass before AND after the fix) ───────
  describe('SCANNER: the taint walk detects laundering and clears compliant code', () => {
    it('flags a tier laundered through a local and a ternary', () => {
      const result = analyzeMetadataTierTaint('synthetic-laundered.ts', LAUNDERED_METADATA_SOURCE);
      expect(result.violation).toBe(true);
      expect(result.taintedLocals).toEqual(expect.arrayContaining(['rawTier', 'tier']));
    });

    it('clears a tier taken from the canonical resolver even when metadata is still read', () => {
      const result = analyzeMetadataTierTaint('synthetic-compliant.ts', COMPLIANT_STRIPE_SOURCE);
      expect(result.toTierExpression).toBe('commercial.tier');
      expect(result.violation).toBe(false);
    });
  });

  // ── ARCH-01 ─────────────────────────────────────────────────────────────
  describe('ARCH-01: authoritative Stripe tier may not come from sub.metadata.tier', () => {
    it('the value handed to the transition service as to.tier is not metadata-derived', () => {
      const result = analyzeMetadataTierTaint(STRIPE_UPSERT, read(STRIPE_UPSERT));

      expect({
        file: STRIPE_UPSERT,
        toTierExpression: result.toTierExpression,
        metadataTaintedLocals: result.taintedLocals,
        violation: result.violation,
      }).toMatchObject({ violation: false });
    });
  });

  // ── ARCH-02 ─────────────────────────────────────────────────────────────
  describe('ARCH-02: the Stripe upsert uses the canonical provider-price resolver', () => {
    it('the canonical Stripe resolver module exists', () => {
      expect(
        fs.existsSync(
          path.join(REPO, `apps/backend/src/services/billing/${STRIPE_RESOLVER_MODULE}.ts`)
        )
      ).toBe(true);
    });

    it('handleSubscriptionUpsert imports and calls it', () => {
      const source = read(STRIPE_UPSERT);
      expect(source).toContain(STRIPE_RESOLVER_MODULE);
      expect(source).toMatch(/resolveStripe(SubscriptionCommercial|PriceIdentity)\s*\(/);
    });
  });

  // ── ARCH-03 ─────────────────────────────────────────────────────────────
  describe('ARCH-03: authoritative Shopify tier may not come from the display name', () => {
    it('the name-keyed PLAN_NAME_TO_TIER map is no longer the tier authority', () => {
      const source = read(SHOPIFY_RECONCILIATION);
      expect(source).not.toContain('PLAN_NAME_TO_TIER');
    });
  });

  // ── ARCH-04 ─────────────────────────────────────────────────────────────
  describe('ARCH-04: Shopify reconciliation resolves tier from planHandle', () => {
    it('the canonical Shopify resolver module exists', () => {
      expect(
        fs.existsSync(
          path.join(REPO, `apps/backend/src/services/shopify/${SHOPIFY_RESOLVER_MODULE}.ts`)
        )
      ).toBe(true);
    });

    it('the Admin GraphQL query requests the plan handle', () => {
      // planHandle lives at AppSubscription -> lineItems -> plan ->
      // pricingDetails (AppRecurringPricing), available from API 2025-04.
      const source = read(SHOPIFY_RECONCILIATION);
      expect(source).toContain('planHandle');
      expect(source).toContain('pricingDetails');
    });

    it('reconciliation routes the handle through the canonical resolver', () => {
      expect(read(SHOPIFY_RECONCILIATION)).toContain(SHOPIFY_RESOLVER_MODULE);
    });
  });

  // ── ARCH-05 ─────────────────────────────────────────────────────────────
  // Protects P0-B2. Expected GREEN now and after the fix.
  describe('ARCH-05: provider-derived authoritative writes still route through the transition service', () => {
    it.each([STRIPE_UPSERT, SHOPIFY_APPLY])('%s calls transitionShopSubscription', (file) => {
      const source = read(file);
      expect(source).toContain('subscriptionTransition.service');
      expect(source).toMatch(/transitionShopSubscription\s*\(/);
    });
  });

  // ── ARCH-06 ─────────────────────────────────────────────────────────────
  describe('ARCH-06: provider ownership is enforced at the transition boundary', () => {
    it('the transition service reads the current billing_provider and an acting provider', () => {
      const source = read(TRANSITION_SERVICE);

      // Enforcement must live here, not solely in individual controllers.
      expect(source).toContain('actingProvider');
      expect(source).toMatch(/billing_provider|billingProvider/);
      expect(source).toContain('allowProviderSwitch');
    });

    it('controller-level guards remain, but are not the only enforcement', () => {
      // billing.controller.ts's 403 APP_STORE_MERCHANT guards are defence in
      // depth and must survive; ARCH-06 only requires the boundary to enforce
      // ownership as well.
      const controller = read('apps/backend/src/api/billing/billing.controller.ts');
      expect(controller).toContain('APP_STORE_MERCHANT');
    });
  });
});


// ---------------------------------------------------------------------------
// ARCH-07 scanner — OAuth reconnect commercial reconciliation, in call order
// ---------------------------------------------------------------------------

/**
 * Walks handleOAuthCallback's body and reports, in SOURCE ORDER, the position of
 * the authoritative reconciliation call and of session issuance.
 *
 * Comments are invisible to the AST, so a mention of applyShopifyBillingState in
 * a comment can never satisfy this. Only a real CallExpression counts.
 */
export function analyzeOAuthReconciliationOrder(
  fileName: string,
  sourceText: string
): {
  found: boolean;
  reconcileIndex: number | null;
  issueTokensIndex: number | null;
  reconcileBeforeIssue: boolean;
} {
  const src = ts.createSourceFile(fileName, sourceText, ts.ScriptTarget.Latest, true);

  let target: ts.Node | null = null;
  const findHandler = (node: ts.Node) => {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.name.text === 'handleOAuthCallback' &&
      node.initializer
    ) {
      target = node.initializer;
    }
    if (
      ts.isFunctionDeclaration(node) &&
      node.name?.text === 'handleOAuthCallback'
    ) {
      target = node;
    }
    ts.forEachChild(node, findHandler);
  };
  findHandler(src);

  if (!target) {
    return { found: false, reconcileIndex: null, issueTokensIndex: null, reconcileBeforeIssue: false };
  }

  let reconcileIndex: number | null = null;
  let issueTokensIndex: number | null = null;

  const calleeName = (call: ts.CallExpression): string => {
    const expr = call.expression;
    if (ts.isIdentifier(expr)) return expr.text;
    if (ts.isPropertyAccessExpression(expr)) return expr.name.text;
    return '';
  };

  const visit = (node: ts.Node) => {
    if (ts.isCallExpression(node)) {
      const name = calleeName(node);
      const pos = node.getStart(src);
      if (name === 'applyShopifyBillingState' && reconcileIndex === null) {
        reconcileIndex = pos;
      }
      if (name === 'issueAuthTokens' && issueTokensIndex === null) {
        issueTokensIndex = pos;
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(target);

  return {
    found: true,
    reconcileIndex,
    issueTokensIndex,
    reconcileBeforeIssue:
      reconcileIndex !== null &&
      issueTokensIndex !== null &&
      reconcileIndex < issueTokensIndex,
  };
}

const OAUTH_COMPLIANT_SOURCE = `
  import { applyShopifyBillingState } from '../../services/shopify/applyShopifyBillingState.service.js';
  export const handleOAuthCallback = async (req: any, res: any) => {
    await persistCredential();
    await withTenant(shopId, async (trx) => {
      await applyShopifyBillingState(shopId, trx);
    });
    const authTokens = await issueAuthTokens({ userId, shopId });
    return res.redirect(authTokens.userJwt);
  };
`;

const OAUTH_STAMP_ONLY_SOURCE = `
  export const handleOAuthCallback = async (req: any, res: any) => {
    const authTokens = await issueAuthTokens({ userId, shopId });
    // applyShopifyBillingState would belong here — mentioning it must not count.
    await withTenant(shopId, async (trx) => {
      await transitionShopSubscription({ to: { billingProvider: 'shopify' } }, trx);
    });
    return res.redirect(authTokens.userJwt);
  };
`;

const OAUTH_LATE_RECONCILE_SOURCE = `
  import { applyShopifyBillingState } from '../../services/shopify/applyShopifyBillingState.service.js';
  export const handleOAuthCallback = async (req: any, res: any) => {
    const authTokens = await issueAuthTokens({ userId, shopId });
    await withTenant(shopId, (trx) => applyShopifyBillingState(shopId, trx));
    return res.redirect(authTokens.userJwt);
  };
`;

describe('P0-B3 CORRECTION — OAuth reconnect commercial reconciliation', () => {
  // ── Scanner self-verification (green before AND after the fix) ───────────
  describe('SCANNER: call-order analysis is real, and comments do not count', () => {
    it('accepts reconciliation performed before session issuance', () => {
      const r = analyzeOAuthReconciliationOrder('synthetic-ok.ts', OAUTH_COMPLIANT_SOURCE);
      expect(r.found).toBe(true);
      expect(r.reconcileBeforeIssue).toBe(true);
    });

    it('rejects a stamp-only callback that only MENTIONS the reconciliation in a comment', () => {
      const r = analyzeOAuthReconciliationOrder('synthetic-stamp.ts', OAUTH_STAMP_ONLY_SOURCE);
      expect(r.found).toBe(true);
      expect(r.reconcileIndex).toBeNull();
      expect(r.reconcileBeforeIssue).toBe(false);
    });

    it('rejects reconciliation that happens only AFTER the session is issued', () => {
      const r = analyzeOAuthReconciliationOrder('synthetic-late.ts', OAUTH_LATE_RECONCILE_SOURCE);
      expect(r.found).toBe(true);
      expect(r.reconcileIndex).not.toBeNull();
      expect(r.reconcileBeforeIssue).toBe(false);
    });
  });

  // ── ARCH-07 ─────────────────────────────────────────────────────────────
  describe('ARCH-07: OAuth completion reconciles authoritative Shopify billing state', () => {
    it('the OAuth controller depends on the existing authoritative reconciliation service', () => {
      const source = read(INTEGRATION_CONTROLLER);
      // The one authoritative mapper. A second Shopify billing mapper is
      // explicitly out of bounds.
      expect(source).toContain('applyShopifyBillingState.service');
    });

    it('handleOAuthCallback invokes reconciliation, not provider-stamp-only completion', () => {
      const result = analyzeOAuthReconciliationOrder(
        INTEGRATION_CONTROLLER,
        read(INTEGRATION_CONTROLLER)
      );

      expect(result.found).toBe(true);
      expect({
        file: INTEGRATION_CONTROLLER,
        callsApplyShopifyBillingState: result.reconcileIndex !== null,
      }).toMatchObject({ callsApplyShopifyBillingState: true });
    });

    it('reconciliation happens BEFORE the post-OAuth session is issued', () => {
      const result = analyzeOAuthReconciliationOrder(
        INTEGRATION_CONTROLLER,
        read(INTEGRATION_CONTROLLER)
      );

      // Issuing a session first mints it from pre-reconnect commercial state —
      // the stale-JWT ordering risk in the production finding.
      expect({
        reconcileIndex: result.reconcileIndex,
        issueTokensIndex: result.issueTokensIndex,
        reconcileBeforeIssue: result.reconcileBeforeIssue,
      }).toMatchObject({ reconcileBeforeIssue: true });
    });

    it('the deliberate provider-ownership migration survives (P0-B3 protection intact)', () => {
      // Expected GREEN now and after the fix: the OAuth takeover remains the one
      // explicitly authorized provider switch. The correction must not remove it.
      const source = read(INTEGRATION_CONTROLLER);
      expect(source).toContain('allowProviderSwitch: true');
      expect(source).toMatch(/actingProvider:\s*'shopify'/);
    });
  });
});
