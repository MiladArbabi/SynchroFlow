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
import { ArrowUp } from 'lucide-react';
import { UpgradePrompt } from '../../components/UpgradePrompt';
import SimpleBar from '../../ui-component/third-party/SimpleBar';
import { useResolvedNavigation } from '../../runtime/useResolvedNavigation';
import { useModuleHealth } from '../../runtime/useModuleHealth';
import { useAlerts } from '../../pages/alerts/useAlerts';
import type { ResolvedNavItem, ResolvedNavGroup } from '../../runtime/resolveNavigation';

type SidenavState = 'EXPANDED' | 'COMPACT' | 'CLOSED';

interface SidenavProps {
  brandName: string;
  routes: unknown[];
  sidenavState: SidenavState;
  isConnected: boolean;
}

const SidenavContent: React.FC<SidenavProps> = ({ sidenavState }) => {
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

  const mainGroups = groups;

  const renderItem = (item: ResolvedNavItem) => {
    // /fulfillment is a sub-tab of the Orders module — highlight Orders when on fulfillment route
    const relatedPaths: Record<string, string[]> = {
      orders: ['/fulfillment'],
    };
    const isActive = pathname === item.path
      || pathname.startsWith(item.path + '?')
      || (relatedPaths[item.id] ?? []).some(p => pathname === p || pathname.startsWith(p + '?'));
    const isLocked = item.disabled;
    const hasHealth = moduleHealth.has(item.id);
    const isAlerts = item.id === 'alerts';
    const showAlertBadge = isAlerts && unreadAlerts > 0;

    const content = (
      <ListItemButton
        key={item.id}
        selected={isActive}
        onClick={() => {
          if (isLocked) {
            setUpgradeFeature(item.title);
            setUpgradeOpen(true);
          } else {
            navigate(item.path);
          }
        }}
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
        <ListItemIcon
          sx={{
            minWidth: 0,
            mr: isExpanded ? 1.5 : 0,
            justifyContent: 'center',
            color: 'inherit',
            position: 'relative',
          }}
        >
          {item.icon
            ? React.createElement(item.icon, { size: iconSize, strokeWidth: isActive ? 2.5 : 1.75 })
            : null}

          {/* MODULE HEALTH DOT */}
          {hasHealth && (
            <Box sx={{
              position: 'absolute', top: -2, right: -2,
              width: 7, height: 7, borderRadius: '50%',
              bgcolor: 'warning.main',
              border: '1.5px solid var(--bg)',
            }} />
          )}

          {/* ALERT UNREAD BADGE */}
          {showAlertBadge && (
            <Box sx={{
              position: 'absolute', top: -4, right: -6,
              minWidth: 16, height: 16, borderRadius: '8px',
              bgcolor: 'error.main',
              border: '1.5px solid var(--bg)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              px: '3px',
            }}>
              <Typography sx={{ fontSize: 9, fontWeight: 700, color: '#fff', lineHeight: 1 }}>
                {unreadAlerts > 99 ? '99+' : unreadAlerts}
              </Typography>
            </Box>
          )}
        </ListItemIcon>

        {/* LABEL + BADGES (expanded only) */}
        {isExpanded && (
          <>
            <ListItemText
              primary={
                <Typography sx={{
                  fontSize: 13,
                  fontWeight: isActive ? 600 : 400,
                  color: 'inherit',
                  lineHeight: 1.4,
                }}>
                  {item.title}
                </Typography>
              }
            />

            {/* TIER UPGRADE BADGE */}
            {isLocked && item.requiredTier && (
              <Box sx={{
                display: 'flex', alignItems: 'center', gap: '2px',
                bgcolor: 'var(--accent-ghost)',
                border: '1px solid var(--accent-border)',
                borderRadius: '4px',
                px: '5px', py: '1px',
                flexShrink: 0,
              }}>
                <ArrowUp size={9} color="var(--accent)" strokeWidth={2.5} />
                <Typography sx={{ fontSize: 9, fontWeight: 700, color: 'var(--accent)', lineHeight: 1.6 }}>
                  {item.requiredTier.charAt(0).toUpperCase() + item.requiredTier.slice(1)}
                </Typography>
              </Box>
            )}

            {/* ALERT COUNT (expanded — inline) */}
            {showAlertBadge && (
              <Box sx={{
                minWidth: 18, height: 18, borderRadius: '9px',
                bgcolor: 'error.main',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                px: '4px', flexShrink: 0,
              }}>
                <Typography sx={{ fontSize: 10, fontWeight: 700, color: '#fff', lineHeight: 1 }}>
                  {unreadAlerts > 99 ? '99+' : unreadAlerts}
                </Typography>
              </Box>
            )}
          </>
        )}
      </ListItemButton>
    );

    // Compact mode: wrap in tooltip
    if (isCompact) {
      return (
        <Tooltip key={item.id} title={item.title} placement="right" arrow>
          <span>{content}</span>
        </Tooltip>
      );
    }

    return <React.Fragment key={item.id}>{content}</React.Fragment>;
  };

  const renderGroup = (group: ResolvedNavGroup, showLabel = true) => (
    <Box key={group.id} sx={{ mb: 0.5 }}>
      {isExpanded && showLabel && (
        <Typography sx={{
          fontSize: 10, fontWeight: 600,
          color: 'var(--ink-4)',
          textTransform: 'uppercase',
          letterSpacing: '0.08em',
          px: 1.5, py: 0.75,
          mt: 0.5,
        }}>
          {group.label}
        </Typography>
      )}
      {!isExpanded && showLabel && <Box sx={{ height: 8 }} />}
      <List disablePadding>
        {group.items.map(renderItem)}
      </List>
    </Box>
  );

  return (
    <Box sx={{
      height: '100%',
      display: 'flex',
      flexDirection: 'column',
      bgcolor: 'var(--bg)',
    }}>

      {/* LOGO */}
      <Box sx={{
        px: 0,
        py: 1.5,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        borderBottom: '1px solid var(--rule)',
        flexShrink: 0,
        minHeight: 52,
      }}>
        {isExpanded && (
          <Box
            component="img"
            src="/logo.png"
            alt="LaSyncro"
            sx={{ height: 28, width: 'auto', display: 'block' }}
          />
        )}
        {isCompact && (
          <Box
            component="img"
            src="/favicon.png"
            alt="LaSyncro"
            sx={{ width: 28, height: 28, borderRadius: '6px', display: 'block' }}
          />
        )}
      </Box>

      {/* MAIN NAV — scrollable */}
      <SimpleBar
        sx={{
          flexGrow: 1,
          '& .simplebar-content': {
            display: 'flex',
            flexDirection: 'column',
          },
          px: isExpanded ? 1 : 0.5,
          py: 1,
        }}
      >
        {mainGroups.map(g => renderGroup(g))}
      </SimpleBar>

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