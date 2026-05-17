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
import { UpgradePrompt } from './UpgradePrompt';
import type { PlanFeature } from '../hooks/usePlanEntitlement';

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
}

interface ModuleTabBarProps {
  tabs: ModuleTab[];
}

export function ModuleTabBar({ tabs }: ModuleTabBarProps) {
  const pal = useAppTheme();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const { can } = usePlanEntitlement();

  const [upgradeOpen, setUpgradeOpen] = useState(false);
  const [upgradeFeature, setUpgradeFeature] = useState<string | undefined>();
  const [upgradeTier, setUpgradeTier] = useState<'core' | 'growth' | 'scale'>('growth');

  const isActive = (tab: ModuleTab) => {
    // Exact match only — prevents /wms matching /wms/analytics
    return pathname === tab.path;
  };

  const isLocked = (tab: ModuleTab) => {
    if (tab.feature) return !can(tab.feature);
    return false;
  };

  const handleClick = (tab: ModuleTab) => {
    if (isLocked(tab)) {
      setUpgradeFeature(tab.label);
      setUpgradeTier(tab.requiredTier ?? 'growth');
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
        {tabs.map((tab) => {
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
              {locked && tab.requiredTier && (
                <Box sx={{
                  display: 'flex', alignItems: 'center', gap: '2px',
                  bgcolor: 'var(--accent-ghost)',
                  border: '1px solid var(--accent-border)',
                  borderRadius: '4px',
                  px: '4px', py: '1px',
                }}>
                  <ArrowUp size={8} color="var(--accent)" strokeWidth={2.5} />
                  <Typography sx={{ fontSize: 9, fontWeight: 700, color: 'var(--accent)', lineHeight: 1.6 }}>
                    {tab.requiredTier.charAt(0).toUpperCase() + tab.requiredTier.slice(1)}
                  </Typography>
                </Box>
              )}
            </Box>
          );
        })}
      </Box>

      <UpgradePrompt
        requiredTier={upgradeTier}
        mode="modal"
        featureName={upgradeFeature}
        open={upgradeOpen}
        onClose={() => setUpgradeOpen(false)}
      />
    </>
  );
}