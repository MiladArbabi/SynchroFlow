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
  ReactNode,
} from 'react';
import { axiosInstance } from 'api/axiosConfig';
import { useAuth } from './AuthContext';
import { Tier, isValidTier } from '../config/tiers';
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

  /** CURRENCY LAYER 2 — user display preference from shop_memberships */
  displayCurrency: string;
  locale: string;
  /** CURRENCY LAYER 3 — billing currency from shop_subscriptions. Set once at registration. */
  billingCurrency: string;
  /** SHB-03/04 — 'stripe' | 'shopify'. Drives billing-surface branching (Stripe checkout/portal vs Shopify hosted pricing page). */
  billingProvider: string;
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

  displayCurrency: string;
  locale: string;
  billingCurrency: string;
  /** SHB-03/04 — billing provider; 'stripe' default. Shopify-billed shops must never see Stripe CTAs. */
  billingProvider: string;
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
  const [billingProvider, setBillingProvider] = useState<string>('stripe'); // SHB-03/04
  const [trialEndsAt, setTrialEndsAt] = useState<string | null>(null);

  // --- Preserve last known good entitlement snapshot (for auth refresh churn) ---
  const lastGoodSnapshotRef = React.useRef<{
    shopId: number | null;
    modules: string[];
    flags: string[];
    tier: Tier;
    displayCurrency: string;
    locale: string;
    billingCurrency: string;
    billingProvider: string;
  } | null>(null);

  const snapshot = React.useMemo(() => ({
    shopId,
    modules: new Set(modules),
    flags: new Set(flags)
  }), [shopId, modules, flags]);

  // simple invalidation token to force re-fetch
  const [refreshToken, setRefreshToken] = useState(0);
  const refresh = useCallback(() => {
    setRefreshToken((v) => v + 1);
  }, []);

  useEffect(() => {
    if (!isLoggedIn || !accessToken) {
      // logged out → clear entitlements
      setShopId(null);
      setModules([]);
      setFlags([]);
      setError(null);
      setIsLoading(false);
      setHasResolved(true); // ✅ CRITICAL: resolve entitlement state for logged-out users

      if (import.meta.env.DEV) {
        console.debug('[Entitlements] resolved (logged out)');
      }

      return;
    }

    let cancelled = false;
    setIsLoading(true);

    axiosInstance
      .get<EntitlementsResponse>('/api/v1/entitlements/me')
      .then((res) => {
        if (cancelled) return;

        const payload = res.data || ({} as Partial<EntitlementsResponse>);
        const nextShopId =
          typeof payload.shopId === 'number' ? payload.shopId : null;

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

        setShopId(nextShopId);
        setModules(nextModules);
        setFlags(nextFlags);
        setTier(nextTier);
        setTrialEndsAt(payload.trialEndsAt ?? null);
        setDisplayCurrency(payload.displayCurrency ?? 'USD');
        setLocale(payload.locale ?? 'en-US');
        setBillingCurrency(payload.billingCurrency ?? 'USD');
        setBillingProvider(payload.billingProvider ?? 'stripe'); // SHB-03/04
        setError(null);
        setHasResolved(true);
        // --- Persist last known good snapshot ---
        lastGoodSnapshotRef.current = {
          shopId: nextShopId,
          modules: nextModules,
          flags: nextFlags,
          tier: nextTier,
          displayCurrency: payload.displayCurrency ?? 'USD',
          locale: payload.locale ?? 'en-US',
          billingCurrency: payload.billingCurrency ?? 'USD',
          billingProvider: payload.billingProvider ?? 'stripe',
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

      // --- Fallback to last known good snapshot if available ---
      if (lastGoodSnapshotRef.current) {
        const snap = lastGoodSnapshotRef.current;

        if (import.meta.env.DEV) {
          console.info('[Entitlements] restored snapshot from memory', snap);
        }

        setShopId(snap.shopId);
        setModules(snap.modules);
        setFlags(snap.flags);
        setTier(snap.tier);
        setDisplayCurrency(snap.displayCurrency ?? 'USD');
        setLocale(snap.locale ?? 'en-US');
        setBillingCurrency(snap.billingCurrency ?? 'USD');
        setBillingProvider(snap.billingProvider ?? 'stripe'); // SHB-03/04
        setError(null);
        setHasResolved(true);

        return;
      }

      // --- Hard failure only if no snapshot exists ---
      setShopId(null);
      setModules([]);
      setFlags([]);
      setError(err?.message || 'Failed to load entitlements');
      setHasResolved(true);
      
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

  // ⚠️ LEGACY — DO NOT USE IN NEW CODE
  const hasModule = useCallback(
    (moduleId: string) => modules.includes(moduleId),
    [modules]
  );

  // ⚠️ LEGACY — DO NOT USE IN NEW CODE
  const hasFlag = useCallback(
    (flagId: string) => flags.includes(flagId),
    [flags]
  );

  const value: EntitlementsContextValue = {
    shopId,
    modules,
    flags,
    snapshot,

    tier,
    trialEndsAt,

    displayCurrency,
    locale,
    billingCurrency,
    billingProvider,
    isLoading,
    hasResolved,
    error,
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