/* eslint-disable @typescript-eslint/no-unused-vars */
// apps/frontend/src/layouts/AppLayout/SidenavContent.tsx
import React from 'react';
import {
  Box,
  List,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  Typography,
  Tooltip,
} from '@mui/material';
import { useNavigate, useLocation } from 'react-router-dom';
import { useState } from 'react';
import { ArrowUp, ChevronDown } from 'lucide-react';
import { UpgradePrompt } from '../../components/UpgradePrompt';
import SimpleBar from '../../ui-component/third-party/SimpleBar';
import { useResolvedNavigation } from '../../runtime/useResolvedNavigation';
import { useModuleHealth } from '../../runtime/useModuleHealth';
import { useAlerts } from '../../pages/alerts/useAlerts';
import type { ResolvedNavItem, ResolvedNavGroup } from '../../runtime/resolveNavigation';

type SidenavState = 'EXPANDED' | 'COMPACT';

interface SidenavProps {
  brandName: string;
  routes: unknown[];
  sidenavState: SidenavState;
  isConnected: boolean;
  /** FT2_READY === Shopify connected and syncing. Used for Sync Status stub until Channels surface is built. */
  isFt2Ready: boolean;
}

const SidenavContent: React.FC<SidenavProps> = ({ sidenavState, isFt2Ready }) => {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const { groups } = useResolvedNavigation();
  const moduleHealth = useModuleHealth();

  // Unread alert count for badge
  const { data: alertsData } = useAlerts();
  const unreadAlerts = alertsData?.data?.length ?? 0;

  const isExpanded = sidenavState === 'EXPANDED';
  const isCompact = sidenavState === 'COMPACT';
  const iconSize = isCompact ? 20 : 18;

  const [upgradeOpen, setUpgradeOpen] = useState(false);
  const [upgradeFeature, setUpgradeFeature] = useState<string | undefined>();

  // Tracks which top-level item has its accordion open in expanded mode.
  // Only one item open at a time. Null = all collapsed.
  const [expandedItem, setExpandedItem] = useState<string | null>(null);

  // Hover popover anchor for compact mode submodule flyout.
  const [popoverAnchor, setPopoverAnchor] = useState<{ el: HTMLElement; itemId: string } | null>(null);

  const isItemActive = (item: ResolvedNavItem): boolean => {
    // Item is active if current path matches it directly OR any of its children
    if (pathname === item.path || pathname.startsWith(item.path + '?')) return true;
    return (item.children ?? []).some(
      c => pathname === c.path || pathname.startsWith(c.path + '/')
    );
  };

  const renderChild = (child: { id: string; title: string; path: string; requiredTier?: string }) => {
    const isActive = pathname === child.path || pathname.startsWith(child.path + '/');
    return (
      <ListItemButton
        key={child.id}
        selected={isActive}
        onClick={() => navigate(child.path)}
        sx={{
          borderRadius: '6px',
          pl: 4.5, pr: 1.5, py: 0.625,
          mb: 0.125,
          fontSize: 12,
          color: isActive ? 'var(--accent)' : 'var(--ink-3)',
          bgcolor: isActive ? 'var(--accent-ghost)' : 'transparent',
          '&:hover': { bgcolor: 'var(--bg-2)', color: 'var(--ink)' },
          '&.Mui-selected': { bgcolor: 'var(--accent-ghost)' },
          transition: 'background 0.15s, color 0.15s',
        }}
      >
        <Typography sx={{ fontSize: 12, fontWeight: isActive ? 500 : 400, color: 'inherit', lineHeight: 1.4 }}>
          {child.title}
        </Typography>
        {child.requiredTier && (
          <Box sx={{
            ml: 'auto', display: 'flex', alignItems: 'center', gap: '2px',
            bgcolor: 'var(--accent-ghost)', border: '1px solid var(--accent-border)',
            borderRadius: '4px', px: '4px', py: '1px', flexShrink: 0,
          }}>
            <ArrowUp size={8} color="var(--accent)" strokeWidth={2.5} />
            <Typography sx={{ fontSize: 9, fontWeight: 700, color: 'var(--accent)', lineHeight: 1.6 }}>
              {child.requiredTier.charAt(0).toUpperCase() + child.requiredTier.slice(1)}
            </Typography>
          </Box>
        )}
      </ListItemButton>
    );
  };

  const renderItem = (item: ResolvedNavItem) => {
    const isActive = isItemActive(item);
    const isLocked = item.disabled;
    const hasHealth = moduleHealth.has(item.id);
    const hasChildren = (item.children ?? []).length > 0;
    const isOpen = expandedItem === item.id;

    const handleClick = () => {
      if (isLocked) { setUpgradeFeature(item.title); setUpgradeOpen(true); return; }
      if (isExpanded && hasChildren) {
        // Navigate to parent route AND toggle accordion.
        // Closing an already-open accordion does not re-navigate.
        navigate(item.path);
        setExpandedItem(prev => prev === item.id ? null : item.id);
      } else {
        navigate(item.path);
      }
    };

    const buttonContent = (
      <ListItemButton
        key={item.id}
        selected={isActive}
        onClick={handleClick}
        onMouseEnter={isCompact && hasChildren ? (e) => setPopoverAnchor({ el: e.currentTarget, itemId: item.id }) : undefined}
        onMouseLeave={isCompact && hasChildren ? () => setPopoverAnchor(null) : undefined}
        sx={{
          borderRadius: '8px',
          justifyContent: isExpanded ? 'flex-start' : 'center',
          px: isExpanded ? 1.5 : 0,
          py: 0.875,
          mb: 0.25,
          position: 'relative',
          color: isActive ? 'var(--accent)' : 'var(--ink-3)',
          bgcolor: isActive ? 'var(--accent-ghost)' : 'transparent',
          borderLeft: isActive ? '2px solid var(--accent)' : '2px solid transparent',
          opacity: isLocked ? 0.6 : 1,
          '&:hover': {
            bgcolor: isActive ? 'var(--accent-ghost)' : 'var(--bg-2)',
            color: isActive ? 'var(--accent)' : 'var(--ink)',
          },
          '&.Mui-selected': {
            bgcolor: 'var(--accent-ghost)',
            '&:hover': { bgcolor: 'var(--accent-ghost)' },
          },
          transition: 'background 0.15s, color 0.15s',
        }}
      >
        {/* ICON */}
        <ListItemIcon sx={{ minWidth: 0, mr: isExpanded ? 1.5 : 0, justifyContent: 'center', color: 'inherit', position: 'relative' }}>
          {item.icon ? React.createElement(item.icon, { size: iconSize, strokeWidth: isActive ? 2.5 : 1.75 }) : null}
          {hasHealth && (
            <Box sx={{ position: 'absolute', top: -2, right: -2, width: 7, height: 7, borderRadius: '50%', bgcolor: 'warning.main', border: '1.5px solid var(--bg)' }} />
          )}
        </ListItemIcon>

        {/* LABEL + CHEVRON + BADGES (expanded only) */}
        {isExpanded && (
          <>
            <ListItemText
              primary={
                <Typography sx={{ fontSize: 13, fontWeight: isActive ? 600 : 400, color: 'inherit', lineHeight: 1.4 }}>
                  {item.title}
                </Typography>
              }
            />
            {hasChildren && !isLocked && (
              <Box sx={{ ml: 'auto', color: 'var(--ink-4)', display: 'flex', alignItems: 'center', transition: 'transform 0.2s', transform: isOpen ? 'rotate(180deg)' : 'rotate(0deg)' }}>
                <ChevronDown size={14} strokeWidth={1.75} />
              </Box>
            )}
            {isLocked && item.requiredTier && (
              <Box sx={{ display: 'flex', alignItems: 'center', gap: '2px', bgcolor: 'var(--accent-ghost)', border: '1px solid var(--accent-border)', borderRadius: '4px', px: '5px', py: '1px', flexShrink: 0 }}>
                <ArrowUp size={9} color="var(--accent)" strokeWidth={2.5} />
                <Typography sx={{ fontSize: 9, fontWeight: 700, color: 'var(--accent)', lineHeight: 1.6 }}>
                  {item.requiredTier.charAt(0).toUpperCase() + item.requiredTier.slice(1)}
                </Typography>
              </Box>
            )}
          </>
        )}
      </ListItemButton>
    );

    return (
      <React.Fragment key={item.id}>
        {/* Compact: plain tooltip when no children, popover handled via onMouseEnter when has children */}
        {isCompact && !hasChildren
          ? <Tooltip title={item.title} placement="right" arrow><span>{buttonContent}</span></Tooltip>
          : buttonContent
        }
        {/* Expanded: inline accordion children */}
        {isExpanded && hasChildren && isOpen && (
          <List disablePadding sx={{ mb: 0.25 }}>
            {item.children!.map(renderChild)}
          </List>
        )}
      </React.Fragment>
    );
  };

  const renderGroup = (group: ResolvedNavGroup, showLabel = true) => (
    <Box key={group.id} sx={{ mb: 0.5 }}>
      {isExpanded && showLabel && (
        <Typography sx={{ fontSize: 10, fontWeight: 600, color: 'var(--ink-4)', textTransform: 'uppercase', letterSpacing: '0.08em', px: 1.5, py: 0.75, mt: 0.5 }}>
          {group.label}
        </Typography>
      )}
      {!isExpanded && showLabel && <Box sx={{ height: 8 }} />}
      <List disablePadding>
        {group.items.map(renderItem)}
      </List>
    </Box>
  );

  // Compact mode: popover flyout for submodule children on hover
  const popoverItem = popoverAnchor
    ? groups.flatMap(g => g.items).find(i => i.id === popoverAnchor.itemId)
    : null;

  return (
    <Box sx={{ height: '100%', display: 'flex', flexDirection: 'column', bgcolor: 'var(--bg)' }}>

      {/* MAIN NAV — scrollable */}
      <SimpleBar sx={{ flexGrow: 1, '& .simplebar-content': { display: 'flex', flexDirection: 'column' }, px: isExpanded ? 1 : 0.5, py: 1 }}>
        {groups.map(g => renderGroup(g))}
      </SimpleBar>

      {/* SYNC STATUS (stub) — replace with real channel health when Channels surface is built */}
      {isFt2Ready && isExpanded && (
        <Box sx={{ px: 2, py: 1.5, borderTop: '1px solid var(--rule)', flexShrink: 0 }}>
          <Typography sx={{ fontSize: 10, fontWeight: 600, color: 'var(--ink-4)', textTransform: 'uppercase', letterSpacing: '0.08em', mb: 0.5 }}>
            Sync Status
          </Typography>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
            <Box sx={{ width: 7, height: 7, borderRadius: '50%', bgcolor: 'success.main', flexShrink: 0 }} />
            <Typography sx={{ fontSize: 12, color: 'var(--ink-3)' }}>All channels live</Typography>
          </Box>
        </Box>
      )}

      {/* COMPACT MODE — submodule hover popover */}
      {isCompact && popoverItem?.children && (
        <Box
          onMouseEnter={() => setPopoverAnchor(prev => prev)}
          onMouseLeave={() => setPopoverAnchor(null)}
          sx={{
            position: 'fixed',
            left: 56,
            top: popoverAnchor?.el.getBoundingClientRect().top ?? 0,
            zIndex: 1300,
            bgcolor: 'var(--bg)',
            border: '1px solid var(--rule)',
            borderRadius: '8px',
            boxShadow: '0 4px 16px rgba(0,0,0,0.12)',
            py: 0.5,
            minWidth: 160,
          }}
        >
          <Typography sx={{ fontSize: 10, fontWeight: 600, color: 'var(--ink-4)', textTransform: 'uppercase', letterSpacing: '0.08em', px: 1.5, pt: 0.5, pb: 0.75 }}>
            {popoverItem.title}
          </Typography>
          <List disablePadding sx={{ px: 0.5 }}>
            {popoverItem.children.map(child => (
              <ListItemButton
                key={child.id}
                onClick={() => { navigate(child.path); setPopoverAnchor(null); }}
                sx={{ borderRadius: '6px', px: 1.5, py: 0.75, color: 'var(--ink-3)', '&:hover': { bgcolor: 'var(--bg-2)', color: 'var(--ink)' } }}
              >
                <Typography sx={{ fontSize: 13, fontWeight: 400, color: 'inherit' }}>{child.title}</Typography>
              </ListItemButton>
            ))}
          </List>
        </Box>
      )}

      <UpgradePrompt
        requiredTier="growth"
        mode="modal"
        featureName={upgradeFeature}
        open={upgradeOpen}
        onClose={() => setUpgradeOpen(false)}
      />
    </Box>
  );
};

export default SidenavContent;