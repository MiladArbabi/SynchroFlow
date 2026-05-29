/* eslint-disable @typescript-eslint/no-unused-vars */
// apps/frontend/src/layouts/AppLayout/SidenavContent.tsx
import React, { useState, useEffect, useRef } from 'react';
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
import { ArrowUp, ChevronDown, Settings, LogOut } from 'lucide-react';
import { UpgradePrompt } from '../../components/UpgradePrompt';
import SimpleBar from '../../ui-component/third-party/SimpleBar';
import { useResolvedNavigation } from '../../runtime/useResolvedNavigation';
import { useModuleHealth } from '../../runtime/useModuleHealth';
import { useAlerts } from '../../pages/alerts/useAlerts';
import type { ResolvedNavItem, ResolvedNavGroup } from '../../runtime/resolveNavigation';
import { Popper, Paper, ClickAwayListener, Divider } from '@mui/material';
import { useTheme, alpha } from '@mui/material/styles';
import { useAuth } from '../../contexts/AuthContext';
import { axiosInstance } from '../../api/axiosConfig';

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
  const theme = useTheme();
  const { user, logout } = useAuth();

  // Unread alert count for badge
  const { data: alertsData } = useAlerts();
  const unreadAlerts = alertsData?.data?.length ?? 0;

  const isExpanded = sidenavState === 'EXPANDED';
  const isCompact = sidenavState === 'COMPACT';
  const iconSize = isCompact ? 20 : 18;

  const [upgradeOpen, setUpgradeOpen] = useState(false);
  const [upgradeFeature, setUpgradeFeature] = useState<string | undefined>();

  // Profile popover
  const profileAnchorRef = useRef<HTMLDivElement | null>(null);
  const [profileOpen, setProfileOpen] = useState(false);

  const handleProfileClose = (e: MouseEvent | TouchEvent) => {
    if (profileAnchorRef.current?.contains(e.target as Node)) return;
    setProfileOpen(false);
  };

  const handleLogout = async () => {
    setProfileOpen(false);
    try {
      await axiosInstance.post('/api/v1/auth/logout');
    } catch (err) {
      console.warn('[ProfileMenu] logout API call failed (non-fatal — clearing local session)', err);
    }
    logout();
    navigate('/login');
  };

  const initial = (user?.first_name?.[0] ?? user?.email?.[0] ?? 'U').toUpperCase();
  const displayName = user?.first_name
    ? `${user.first_name}${user.last_name ? ' ' + user.last_name : ''}`
    : user?.email ?? 'Account';

  // Tracks which top-level item has its accordion open in expanded mode.
  // Only one item open at a time. Null = all collapsed.
  const [expandedItem, setExpandedItem] = useState<string | null>(null);

  // Auto-expand parent accordion when child route is active (e.g. landing via tab bar).
  useEffect(() => {
    for (const group of groups) {
      for (const item of group.items) {
        if ((item.children ?? []).some(c => pathname === c.path || pathname.startsWith(c.path + '/') || pathname.startsWith(c.path + '?'))) {
          setExpandedItem(item.id);
          return;
        }
      }
    }
  }, [pathname, groups]);

  // Hover popover anchor for compact mode submodule flyout.
  const [popoverAnchor, setPopoverAnchor] = useState<{ el: HTMLElement; itemId: string } | null>(null);
  const popoverCloseTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const isItemActive = (item: ResolvedNavItem): boolean => {
    // Item is active if current path matches it directly OR any of its children
    if (pathname === item.path || pathname.startsWith(item.path + '?')) return true;
    return (item.children ?? []).some(
      c => pathname === c.path || pathname.startsWith(c.path + '/') || pathname.startsWith(c.path + '?')
    );
  };

  const renderChild = (child: { id: string; title: string; path: string; requiredTier?: string }) => {
    // Children are leaf routes — exact match only. startsWith would cause /wms to match /wms/analytics.
    const isActive = pathname === child.path || pathname.startsWith(child.path + '?');
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

    // Label/icon click → navigate only. Chevron click → toggle only.
    const handleClick = () => {
      if (isLocked) { setUpgradeFeature(item.title); setUpgradeOpen(true); return; }
      navigate(item.path);
    };

    const handleChevronClick = (e: React.MouseEvent) => {
      e.stopPropagation();
      setExpandedItem(prev => prev === item.id ? null : item.id);
    };

    const buttonContent = (
      <ListItemButton
        key={item.id}
        selected={isActive}
        onClick={handleClick}
        onMouseEnter={isCompact && hasChildren ? (e) => {
          if (popoverCloseTimer.current) clearTimeout(popoverCloseTimer.current);
          setPopoverAnchor({ el: e.currentTarget, itemId: item.id });
        } : undefined}
        onMouseLeave={isCompact && hasChildren ? () => {
          popoverCloseTimer.current = setTimeout(() => setPopoverAnchor(null), 100);
        } : undefined}
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
              <Box
                onClick={handleChevronClick}
                sx={{ ml: 'auto', color: 'var(--ink-4)', display: 'flex', alignItems: 'center', transition: 'transform 0.2s', transform: isOpen ? 'rotate(180deg)' : 'rotate(0deg)', p: '4px', borderRadius: '4px', borderLeft: '1px solid var(--rule)', '&:hover': { bgcolor: 'var(--bg-3)', borderLeftColor: 'transparent' } }}
              >
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

      {/* PROFILE TRIGGER — bottom of sidenav */}
      {isFt2Ready && (
        <Box
          ref={profileAnchorRef}
          onClick={() => setProfileOpen(prev => !prev)}
          sx={{
            px: isExpanded ? 1.5 : 0,
            py: 1,
            mx: isExpanded ? 0 : 0.5,
            mb: 0.5,
            borderTop: '1px solid var(--rule)',
            display: 'flex',
            alignItems: 'center',
            gap: 1.25,
            cursor: 'pointer',
            borderRadius: isExpanded ? 0 : '8px',
            justifyContent: isCompact ? 'center' : 'flex-start',
            '&:hover': { bgcolor: 'var(--bg-2)' },
            transition: 'background 0.15s',
            flexShrink: 0,
          }}
        >
          {/* AVATAR */}
          <Box sx={{
            width: 28, height: 28, borderRadius: '50%', flexShrink: 0,
            bgcolor: alpha(theme.palette.primary.main, 0.15),
            border: `1.5px solid ${profileOpen ? theme.palette.primary.main : 'var(--rule)'}`,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            transition: 'border-color 0.15s',
          }}>
            <Typography sx={{ fontSize: 12, fontWeight: 700, color: theme.palette.primary.main, lineHeight: 1 }}>
              {initial}
            </Typography>
          </Box>
          {/* NAME — expanded only */}
          {isExpanded && (
            <Box sx={{ minWidth: 0, flex: 1 }}>
              <Typography sx={{ fontSize: 12, fontWeight: 500, color: 'var(--ink)', lineHeight: 1.3, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {displayName}
              </Typography>
              <Typography sx={{ fontSize: 10, color: 'var(--ink-3)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {user?.email}
              </Typography>
            </Box>
          )}
        </Box>
      )}

      {/* PROFILE POPOVER — opens right of sidenav */}
      <Popper
        open={profileOpen}
        anchorEl={profileAnchorRef.current}
        placement="right-end"
        transition
        disablePortal={false}
        popperOptions={{ modifiers: [{ name: 'offset', options: { offset: [0, 8] } }] }}
        sx={{ zIndex: 1300 }}
      >
        {({ TransitionProps }) => (
          <ClickAwayListener onClickAway={handleProfileClose}>
            <Box {...TransitionProps} sx={{
              bgcolor: 'var(--surface)',
              border: '0.5px solid var(--rule)',
              borderRadius: '10px',
              boxShadow: theme.shadows[8],
              minWidth: 220,
              overflow: 'hidden',
            }}>
              {/* IDENTITY */}
              <Box sx={{ px: 2, pt: 1.75, pb: 1.25 }}>
                <Typography sx={{ fontSize: 13, fontWeight: 600, color: 'var(--ink)', lineHeight: 1.3 }}>
                  {displayName}
                </Typography>
                <Typography sx={{ fontSize: 11, color: 'var(--ink-3)', mt: '2px' }}>
                  {user?.email}
                </Typography>
              </Box>

              <Divider sx={{ borderColor: 'var(--rule)' }} />

              {/* ACTIONS */}
              <Box sx={{ py: 0.5 }}>
                <Box
                  onClick={() => { setProfileOpen(false); navigate('/settings'); }}
                  sx={{ display: 'flex', alignItems: 'center', gap: 1.25, px: 2, py: 0.875, cursor: 'pointer', '&:hover': { bgcolor: 'var(--bg-2)' } }}
                >
                  <Settings size={15} strokeWidth={1.75} color="var(--ink-3)" />
                  <Typography sx={{ fontSize: 13, color: 'var(--ink)' }}>Settings</Typography>
                </Box>
                <Box
                  onClick={handleLogout}
                  sx={{ display: 'flex', alignItems: 'center', gap: 1.25, px: 2, py: 0.875, cursor: 'pointer', '&:hover': { bgcolor: 'var(--bg-2)' } }}
                >
                  <LogOut size={15} strokeWidth={1.75} color="var(--ink-3)" />
                  <Typography sx={{ fontSize: 13, color: 'var(--ink)' }}>Log out</Typography>
                </Box>
              </Box>
            </Box>
          </ClickAwayListener>
        )}
      </Popper>

      {/* COMPACT MODE — submodule hover popover */}
      {isCompact && popoverItem?.children && (
        <Box
          onMouseEnter={() => { if (popoverCloseTimer.current) clearTimeout(popoverCloseTimer.current); }}
          onMouseLeave={() => { popoverCloseTimer.current = setTimeout(() => setPopoverAnchor(null), 100); }}
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