/* eslint-disable @typescript-eslint/no-unused-vars */
// apps/frontend/src/components/ModuleTabBar.tsx
//
// MODULE TAB BAR
// --------------
// Folder-tab navigation pattern for multi-surface modules.
// Sits directly under the topnav, above module content.
//
// USAGE:
//   <ModuleTabBar tabs={[
//     { id: 'operations', label: 'Operations', path: '/wms' },
//     { id: 'analytics',  label: 'Analytics',  path: '/wms/analytics', requiredTier: 'growth' },
//   ]} />
//
// RULES:
// - Tab order is platform-controlled — never reorder at runtime
// - Locked tabs show upgrade badge and open UpgradePrompt on click
// - Active tab detected via pathname prefix match
// - Overflow wraps to second row — never scrolls horizontally

import { useState } from 'react';
import { Box, Typography } from '@mui/material';
import { useNavigate, useLocation } from 'react-router-dom';
import { ArrowUp } from 'lucide-react';
import { useAppTheme } from '../hooks/useAppTheme';
import { usePlanEntitlement } from '../hooks/usePlanEntitlement';
import { useCommercialAccess } from '../runtime/commercialContext';
import { useAuth } from '../contexts/AuthContext';
import { UpgradePrompt } from './UpgradePrompt';
import { getCapabilityPresentation } from '../commercial/capabilityPresentation';
import type { PlanFeature } from '../hooks/usePlanEntitlement';
import { tierAtLeast } from '@lasyncro/commercial-policy';
import type { AccessDecision, CapabilityId } from '@lasyncro/commercial-policy';

export interface ModuleTab {
  id: string;
  label: string;
  path: string;
  /** Optional count badge — shown as neutral pill when inactive, accent-ghost when active */
  count?: number;
  /** If set, tab is locked for users below this tier */
  requiredTier?: 'core' | 'growth' | 'scale';
  /** PlanFeature key — if set, uses usePlanEntitlement to determine lock state */
  feature?: PlanFeature;
  /**
   * Canonical commercial capability (COMMERCIAL-ACCESS-ARCH-01 P0-A2B). When
   * set, the decision comes from the shared commercial adapter
   * (runtime/commercialContext) — requiredTier/feature are ignored. Legacy
   * fields remain supported as transitional support for non-migrated tabs.
   */
  capabilityId?: CapabilityId;
  /** Optional benefit lines for this tab's upgrade modal. */
  upgradeBenefits?: string[];
  /**
   * GH-1222: advisory role visibility. When set, a user whose role is not
   * listed never sees the tab — it is filtered out BEFORE any commercial
   * decision, so it can never render a tier badge or open an UpgradePrompt.
   * Presentation only: backend requireAction remains the authority.
   */
  allowedRoles?: readonly ModuleTabRole[];
}

export type ModuleTabRole = 'owner' | 'admin' | 'operator';

interface ModuleTabBarProps {
  tabs: ModuleTab[];
}

export function ModuleTabBar({ tabs }: ModuleTabBarProps) {
  const pal = useAppTheme();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const { can, tier: legacyTier } = usePlanEntitlement();
  // COMMERCIAL-ACCESS-ARCH-01 P0-A2B-ADDITIVE-PARITY-01: capabilityId tabs
  // are decided from the SAME shared, snapshot-aware commercial-access
  // source Sidenav (useResolvedNavigation) and CommercialGate
  // (useCommercialAccess) consume — tier floor UNION the shop's live
  // entitlement snapshot (modules + flags), never a hand-rolled/empty one.
  const { decide, isResolved } = useCommercialAccess();
  const { user } = useAuth();
  const role = user?.role;

  // GH-1222: role eligibility first. A tab is removed only when the user's
  // role is KNOWN and not listed (unknown role is not a role denial). Removed
  // tabs never reach the commercial lock/upsell logic below.
  const visibleTabs = tabs.filter(
    (tab) => !tab.allowedRoles || role === undefined || tab.allowedRoles.includes(role as ModuleTabRole),
  );

  const [upgradeOpen, setUpgradeOpen] = useState(false);
  const [upgradeFeature, setUpgradeFeature] = useState<string | undefined>();
  const [upgradeBenefits, setUpgradeBenefits] = useState<string[] | undefined>();
  const [upgradeDecision, setUpgradeDecision] = useState<AccessDecision | null>(null);
  const [upgradeLegacyTier, setUpgradeLegacyTier] = useState<'core' | 'growth' | 'scale' | undefined>();

  const isActive = (tab: ModuleTab) => {
    // Exact match only — prevents /wms matching /wms/analytics
    return pathname === tab.path;
  };

  // SECURITY FIX (audit ISS-P12/P25): isLocked() previously only checked
  // `feature`, silently ignoring `requiredTier` — tabs using requiredTier
  // alone (Floor Planning, Problem Center) were unconditionally unlocked
  // regardless of the user's actual plan. capabilityId tabs now derive their
  // decision from the shared commercial adapter (P0-A2B) instead.
  const decisionFor = (tab: ModuleTab): AccessDecision | null =>
    tab.capabilityId ? decide(tab.capabilityId) : null;

  const isLocked = (tab: ModuleTab) => {
    // GH-1209: unresolved commercial truth is "not yet allowed", never a lock.
    // Mirrors CommercialGate: a source that does not report resolution state
    // (e.g. a test double) is treated as already resolved.
    if (isResolved === false) return false;
    const decision = decisionFor(tab);
    if (decision) return !decision.allowed;
    if (tab.requiredTier && !tierAtLeast(legacyTier, tab.requiredTier)) return true;
    if (tab.feature) return !can(tab.feature);
    return false;
  };

  const handleClick = (tab: ModuleTab) => {
    if (isLocked(tab)) {
      const decision = decisionFor(tab);
      const presentation = getCapabilityPresentation(tab.capabilityId);
      setUpgradeFeature(presentation?.featureName ?? tab.label);
      setUpgradeBenefits(presentation?.benefits ?? tab.upgradeBenefits);
      setUpgradeDecision(decision);
      setUpgradeLegacyTier(decision ? undefined : tab.requiredTier);
      setUpgradeOpen(true);
      return;
    }
    navigate(tab.path);
  };

  return (
    <>
      {/* TAB BAR CONTAINER */}
      <Box sx={{
        display: 'flex',
        flexWrap: 'wrap',
        bgcolor: 'var(--bg-2)',
        borderBottom: `1px solid var(--rule)`,
        px: 2,
        pt: '8px',
        gap: '2px',
      }}>
        {visibleTabs.map((tab) => {
          const active = isActive(tab);
          const locked = isLocked(tab);

          return (
            <Box
              key={tab.id}
              onClick={() => handleClick(tab)}
              sx={{
                position: 'relative',
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                px: '16px',
                py: '8px',
                cursor: 'pointer',
                borderRadius: '8px 8px 0 0',
                bgcolor: active ? 'var(--surface)' : 'transparent',
                // Active tab erases bottom border — folder effect
                mb: active ? '-1px' : 0,
                border: active ? `1px solid var(--rule)` : '1px solid transparent',
                borderBottom: active ? `1px solid var(--surface)` : '1px solid transparent',
                // Left accent pip on active
                '&::before': active ? {
                  content: '""',
                  position: 'absolute',
                  left: 0,
                  top: '20%',
                  height: '60%',
                  width: '2px',
                  borderRadius: '0 2px 2px 0',
                  bgcolor: 'var(--accent)',
                } : {},
                '&:hover': {
                  bgcolor: active ? 'var(--surface)' : 'var(--bg-3)',
                },
                transition: 'background 0.1s',
                opacity: locked && !active ? 0.7 : 1,
              }}
            >
              <Typography sx={{
                fontSize: 13,
                fontWeight: active ? 600 : 400,
                color: active ? 'var(--ink)' : 'var(--ink-3)',
                lineHeight: 1,
                userSelect: 'none',
                whiteSpace: 'nowrap',
              }}>
                {tab.label}
              </Typography>

              {/* COUNT BADGE — neutral bg inactive, accent-ghost active */}
              {tab.count != null && (
                <Box sx={{
                  px: '5px', py: '1px',
                  borderRadius: '4px',
                  bgcolor: active ? 'var(--accent-ghost)' : 'var(--bg-3)',
                  border: `1px solid ${active ? 'var(--accent-border)' : 'var(--rule)'}`,
                  minWidth: '18px',
                  textAlign: 'center',
                }}>
                  <Typography sx={{
                    fontSize: 10,
                    fontWeight: 600,
                    color: active ? 'var(--accent)' : 'var(--ink-4)',
                    lineHeight: 1.6,
                  }}>
                    {tab.count}
                  </Typography>
                </Box>
              )}

              {/* TIER UPGRADE BADGE */}
              {locked && (tab.requiredTier ?? decisionFor(tab)?.requiredTier) && (
                <Box sx={{
                  display: 'flex', alignItems: 'center', gap: '2px',
                  bgcolor: 'var(--accent-ghost)',
                  border: '1px solid var(--accent-border)',
                  borderRadius: '4px',
                  px: '4px', py: '1px',
                }}>
                  <ArrowUp size={8} color="var(--accent)" strokeWidth={2.5} />
                  <Typography sx={{ fontSize: 9, fontWeight: 700, color: 'var(--accent-text)', lineHeight: 1.6 }}>
                    {(() => {
                      const label = (tab.requiredTier ?? decisionFor(tab)?.requiredTier)!;
                      return label.charAt(0).toUpperCase() + label.slice(1);
                    })()}
                  </Typography>
                </Box>
              )}
            </Box>
          );
        })}
      </Box>

      <UpgradePrompt
        requiredTier={upgradeLegacyTier}
        decision={upgradeDecision ?? undefined}
        mode="modal"
        featureName={upgradeFeature}
        benefits={upgradeBenefits}
        open={upgradeOpen}
        onClose={() => setUpgradeOpen(false)}
      />
    </>
  );
}
