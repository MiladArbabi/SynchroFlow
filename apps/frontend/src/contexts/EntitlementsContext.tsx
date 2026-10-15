// EntitlementsContext (LEGACY + CANONICAL SNAPSHOT)
// -----------------------------------------------
//
// Canonical Source of Truth:
// - `snapshot` (EntitlementSnapshot)
//
// Legacy (DO NOT USE IN NEW CODE):
// - `modules: string[]`
// - `flags: string[]`
// - `hasModule()`
// - `hasFlag()`
//
// Rationale:
// - Legacy UI/widgets still depend on array helpers
// - New runtime code MUST consume `snapshot` only
//
// Enforcement:
// - Runtime layer (runtime/*) is forbidden from using legacy helpers
// - Snapshot semantics are sealed and immutable

/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable react-refresh/only-export-components */
// apps/frontend/src/contexts/EntitlementsContext.tsx
import React, {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  type ReactNode,
} from 'react';
import { axiosInstance } from 'api/axiosConfig';
import { useAuth } from './AuthContext';
import { type Tier, isValidTier } from '../config/tiers';
import type { EntitlementSnapshot } from '../runtime/EntitlementSnapshot';

// --- Backend payload shape ---
interface EntitlementsResponse {
  shopId: number | null;

  // ⚠️ LEGACY — array form retained for backward compatibility
  modules: string[];
  flags: string[];

  /** Subscription tier from backend entitlements snapshot (MON-03) */
  tier: Tier;

  trialEndsAt: string | null; // ISO timestamp, null if not on trial
  /** Canonical shop_subscriptions.status; null until/no subscription truth. */
  subscriptionStatus: string | null;

  /** CURRENCY LAYER 2 — user display preference from shop_memberships */
  displayCurrency: string;
  locale: string;
  /** CURRENCY LAYER 3 — billing currency from shop_subscriptions. Set once at registration. */
  billingCurrency: string;
  /** SHB-03/04 — 'stripe' | 'shopify'. Drives billing-surface branching (Stripe checkout/portal vs Shopify hosted pricing page). */
  billingProvider: 'stripe' | 'shopify' | null;
}

// --- Context shape exposed to UI ---
interface EntitlementsContextValue {
  shopId: number | null;
  modules: string[];
  flags: string[];
  snapshot: EntitlementSnapshot;

  /**
   * Subscription tier (MON-03).
   * Use for UI gating of intelligence modules (MON-06) and upgrade prompts (MON-10).
   * Defaults to 'starter' until resolved.
   */
  tier: Tier;
  trialEndsAt: string | null;
  subscriptionStatus: string | null;

  displayCurrency: string;
  locale: string;
  billingCurrency: string;
  /** Billing provider. Null means ownership is unresolved and billing actions fail closed. */
  billingProvider: 'stripe' | 'shopify' | null;
  isLoading: boolean;
  hasResolved: boolean;
  error: string | null;
  hasModule: (moduleId: string) => boolean;
  hasFlag: (flagId: string) => boolean;
  refresh: () => void;
}

const EntitlementsContext = createContext<EntitlementsContextValue | undefined>(
  undefined
);

interface EntitlementsProviderProps {
  children: ReactNode;
}

/**
 * GH-1247 — SHOP SESSION BINDING
 * ───────────────────────────────
 * A snapshot belongs to the authenticated shop session it was fetched for:
 * the access token's shop_id claim. Same-shop silent refresh keeps the
 * snapshot. A snapshot is exposed, and the last-good snapshot restored, only
 * for the same shop — never across shops, never after logout. A token without
 * a valid shop identity never binds: it resolves fail-closed and no snapshot
 * is fetched or exposed for it.
 */
const SESSION_UNKNOWN_ERROR = 'ENTITLEMENTS_SESSION_UNKNOWN';

/**
 * The shop the access token is issued for (its shop_id claim), decoded the
 * same way as AuthContext's canonical #1164 JWT identity. Session identity
 * only — never commercial authority (the JWT tier is ignored). Absent,
 * undecodable or invalid claim → null.
 */
function jwtShopId(token: string): number | null {
  try {
    const segment = token.split('.')[1];
    if (!segment) return null;
    const payload = JSON.parse(atob(segment.replace(/-/g, '+').replace(/_/g, '/')));
    const shopId = payload && typeof payload === 'object' ? payload.shop_id : undefined;
    return Number.isSafeInteger(shopId) && shopId > 0 ? shopId : null;
  } catch {
    return null;
  }
}

const EMPTY_LIST: string[] = [];

/** Same known shop session. An unknown session (null) never matches anything. */
function sameSession(a: number | null, b: number | null): boolean {
  return a !== null && a === b;
}

export const EntitlementsProvider: React.FC<EntitlementsProviderProps> = ({
  children,
}) => {
  const { isLoggedIn, accessToken } = useAuth();

  const [shopId, setShopId] = useState<number | null>(null);
  const [modules, setModules] = useState<string[]>([]);
  const [flags, setFlags] = useState<string[]>([]);
  const [tier, setTier] = useState<Tier>('starter');
  const [isLoading, setIsLoading] = useState(false);
  const [hasResolved, setHasResolved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [displayCurrency, setDisplayCurrency] = useState<string>('USD');
  const [locale, setLocale] = useState<string>('en-US');
  const [billingCurrency, setBillingCurrency] = useState<string>('USD');
  const [billingProvider, setBillingProvider] = useState<'stripe' | 'shopify' | null>(null);
  const [trialEndsAt, setTrialEndsAt] = useState<string | null>(null);
  const [subscriptionStatus, setSubscriptionStatus] = useState<string | null>(null);

  // Session the committed state belongs to (GH-1247).
  const [committedSession, setCommittedSession] = useState<number | null>(null);

  // --- Preserve last known good entitlement snapshot (for auth refresh churn) ---
  const lastGoodSnapshotRef = React.useRef<{
    session: number;
    shopId: number | null;
    modules: string[];
    flags: string[];
    tier: Tier;
    subscriptionStatus: string | null;
    displayCurrency: string;
    locale: string;
    billingCurrency: string;
    billingProvider: 'stripe' | 'shopify' | null;
  } | null>(null);

  // simple invalidation token to force re-fetch
  const [refreshToken, setRefreshToken] = useState(0);
  const refresh = useCallback(() => {
    setRefreshToken((v) => v + 1);
  }, []);

  useEffect(() => {
    if (!isLoggedIn || !accessToken) {
      // logged out → clear entitlements; previous-shop access is invalidated (GH-1247)
      lastGoodSnapshotRef.current = null;
      setCommittedSession(null);
      setShopId(null);
      setModules([]);
      setFlags([]);
      setTier('starter');
      setBillingProvider(null);
      setTrialEndsAt(null);
      setSubscriptionStatus(null);
      setError(null);
      setIsLoading(false);
      setHasResolved(true); // ✅ CRITICAL: resolve entitlement state for logged-out users

      if (import.meta.env.DEV) {
        console.debug('[Entitlements] resolved (logged out)');
      }

      return;
    }

    // Unknown session identity: nothing is fetched or committed; the exposed
    // view below resolves it fail-closed (SESSION_UNKNOWN_ERROR).
    const session = jwtShopId(accessToken);
    if (session === null) {
      setIsLoading(false);
      return;
    }

    // A response is only ever committed to the session it was requested for;
    // a later token change cancels this request (stale responses are dropped).
    let cancelled = false;
    setIsLoading(true);

    axiosInstance
      .get<EntitlementsResponse>('/api/v1/entitlements/me')
      .then((res) => {
        if (cancelled) return;

        const payload = res.data || ({} as Partial<EntitlementsResponse>);
        const nextShopId =
          typeof payload.shopId === 'number' ? payload.shopId : null;

        // The snapshot must describe the shop the token is issued for.
        if (nextShopId !== session) {
          throw new Error('ENTITLEMENTS_SHOP_MISMATCH');
        }

        if (import.meta.env.DEV) {
          console.debug('[Entitlements] token-auth snapshot', {
            shopId: payload.shopId,
            modules: payload.modules,
            flags: payload.flags
          });
        }

        /**
         * TEMPORARY DEV OVERRIDE
         * ----------------------
         * Force-enable `order-nexus` module on the frontend until
         * backend entitlements fully support dynamic module rollout.
         *
         * Why:
         * - Orders UI is implemented as a dynamic module
         * - Backend `/entitlements/me` does not yet return `order-nexus`
         * - Without this, ProtectedRoute will redirect `/orders` → `/default`
         *
         * Removal condition:
         * - Backend returns `order-nexus` in `modules[]`
         *
         * IMPORTANT:
         * - This does NOT bypass entitlement checks
         * - It only augments the entitlement snapshot during development
         */
        const nextModules = Array.isArray(payload.modules)
          ? payload.modules
          : [];

        const nextFlags = Array.isArray(payload.flags) ? payload.flags : [];

        /* if (import.meta.env.DEV) {
          console.groupCollapsed('[Entitlements] resolved snapshot');
          console.log('shopId:', nextShopId);
          console.log('backend modules:', payload.modules);
          console.log('effective modules:', nextModules);
          console.log('flags:', nextFlags);
          console.groupEnd();
        } */

        // Validate against canonical Tier union — unrecognized values degrade to 'starter' (fail-safe).
        const nextTier: Tier = isValidTier(payload.tier) ? payload.tier : 'starter';
        const nextBillingProvider =
          payload.billingProvider === 'stripe' || payload.billingProvider === 'shopify'
            ? payload.billingProvider
            : null;

        setShopId(nextShopId);
        setModules(nextModules);
        setFlags(nextFlags);
        setTier(nextTier);
        setTrialEndsAt(payload.trialEndsAt ?? null);
        setSubscriptionStatus(payload.subscriptionStatus ?? null);
        setDisplayCurrency(payload.displayCurrency ?? 'USD');
        setLocale(payload.locale ?? 'en-US');
        setBillingCurrency(payload.billingCurrency ?? 'USD');
        setBillingProvider(nextBillingProvider);
        setError(null);
        setHasResolved(true);
        setCommittedSession(session);
        // --- Persist last known good snapshot ---
        lastGoodSnapshotRef.current = {
          session,
          shopId: nextShopId,
          modules: nextModules,
          flags: nextFlags,
          tier: nextTier,
          subscriptionStatus: payload.subscriptionStatus ?? null,
          displayCurrency: payload.displayCurrency ?? 'USD',
          locale: payload.locale ?? 'en-US',
          billingCurrency: payload.billingCurrency ?? 'USD',
          billingProvider: nextBillingProvider,
        };

        if (import.meta.env.DEV) {
          console.debug('[Entitlements] snapshot committed', lastGoodSnapshotRef.current);
        }

      })
      .catch((err: any) => {
        if (cancelled) return;

        if (import.meta.env.DEV) {
        console.warn(
          '[Entitlements] fetch failed – attempting fallback',
          err?.message
        );
      }

      // --- Fallback to last known good snapshot, same shop session only (GH-1247) ---
      if (lastGoodSnapshotRef.current && sameSession(lastGoodSnapshotRef.current.session, session)) {
        const snap = lastGoodSnapshotRef.current;

        if (import.meta.env.DEV) {
          console.info('[Entitlements] restored snapshot from memory', snap);
        }

        setShopId(snap.shopId);
        setModules(snap.modules);
        setFlags(snap.flags);
        setTier(snap.tier);
        setSubscriptionStatus(snap.subscriptionStatus);
        setDisplayCurrency(snap.displayCurrency ?? 'USD');
        setLocale(snap.locale ?? 'en-US');
        setBillingCurrency(snap.billingCurrency ?? 'USD');
        setBillingProvider(snap.billingProvider);
        setError(null);
        setHasResolved(true);
        setCommittedSession(session);

        return;
      }

      // --- Hard failure: no same-session snapshot — fail closed ---
      setShopId(null);
      setModules([]);
      setFlags([]);
      setTier('starter');
      setBillingProvider(null);
      setSubscriptionStatus(null);
      setTrialEndsAt(null);
      setError(err?.message || 'Failed to load entitlements');
      setHasResolved(true);
      setCommittedSession(session);

      })
      .finally(() => {
        if (!cancelled) {
          setIsLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [isLoggedIn, accessToken, refreshToken]);

  /**
   * GH-1247 — committed state is exposed only to the session it belongs to,
   * evaluated at render time so not even the render right after a token
   * change shows the previous shop. Logged out → cleared; unknown session
   * identity → resolved fail-closed; any other mismatch → pending,
   * fail-closed defaults until this session resolves.
   */
  const loggedOut = !isLoggedIn || !accessToken;
  const sessionShop = loggedOut ? null : jwtShopId(accessToken);
  const unknownSession = !loggedOut && sessionShop === null;
  const bound = sameSession(committedSession, sessionShop);
  const exposedShopId = bound ? shopId : null;
  const exposedModules = bound ? modules : EMPTY_LIST;
  const exposedFlags = bound ? flags : EMPTY_LIST;

  const snapshot = React.useMemo(() => ({
    shopId: exposedShopId,
    modules: new Set(exposedModules),
    flags: new Set(exposedFlags)
  }), [exposedShopId, exposedModules, exposedFlags]);

  // ⚠️ LEGACY — DO NOT USE IN NEW CODE
  const hasModule = useCallback(
    (moduleId: string) => exposedModules.includes(moduleId),
    [exposedModules]
  );

  // ⚠️ LEGACY — DO NOT USE IN NEW CODE
  const hasFlag = useCallback(
    (flagId: string) => exposedFlags.includes(flagId),
    [exposedFlags]
  );

  const value: EntitlementsContextValue = {
    shopId: exposedShopId,
    modules: exposedModules,
    flags: exposedFlags,
    snapshot,

    tier: bound ? tier : 'starter',
    trialEndsAt: bound ? trialEndsAt : null,
    subscriptionStatus: bound ? subscriptionStatus : null,

    displayCurrency: bound ? displayCurrency : 'USD',
    locale: bound ? locale : 'en-US',
    billingCurrency: bound ? billingCurrency : 'USD',
    billingProvider: bound ? billingProvider : null,
    isLoading: bound ? isLoading : !loggedOut && !unknownSession,
    hasResolved: bound ? hasResolved : loggedOut || unknownSession,
    error: bound ? error : unknownSession ? SESSION_UNKNOWN_ERROR : null,
    hasModule,
    hasFlag,
    refresh,
  };

  return (
    <EntitlementsContext.Provider value={value}>
      {children}
    </EntitlementsContext.Provider>
  );
};

export const useEntitlements = (): EntitlementsContextValue => {
  const ctx = useContext(EntitlementsContext);
  if (!ctx) {
    throw new Error('useEntitlements must be used within an EntitlementsProvider');
  }
  return ctx;
};