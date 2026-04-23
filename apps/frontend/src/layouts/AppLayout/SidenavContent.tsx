/* eslint-disable @typescript-eslint/no-explicit-any */
// apps/frontend/src/layouts/AppLayout/SidenavContent.tsx
import React, { useMemo } from 'react';
import {
  Box,
  List,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  Typography
} from '@mui/material';
import { useNavigate, useLocation } from 'react-router-dom';
import { useState } from 'react';
import { Lock } from 'lucide-react';
import { UpgradePrompt } from '../../components/UpgradePrompt';
import SimpleBar from '../../ui-component/third-party/SimpleBar';
import { useResolvedNavigation } from '../../runtime/useResolvedNavigation';
import { useModuleHealth } from '../../runtime/useModuleHealth';
import { useEntitlements } from '../../contexts/EntitlementsContext';

type SidenavState = 'EXPANDED' | 'COMPACT' | 'CLOSED';

interface SidenavProps {
  brandName: string;
  routes: any[];
  sidenavState: SidenavState;
  isConnected: boolean;
}

const SidenavContent: React.FC<SidenavProps> = ({
  brandName,
  sidenavState,
}) => {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const { groups } = useResolvedNavigation();
  const { snapshot } = useEntitlements();
  const moduleHealth = useModuleHealth();

  const isExpanded = sidenavState === 'EXPANDED';
  const isCompact = sidenavState === 'COMPACT';
  const iconSize = isExpanded ? 18 : isCompact ? 22 : 18;
  const [upgradeOpen, setUpgradeOpen] = useState(false);
  const [upgradeFeature, setUpgradeFeature] = useState<string | undefined>();

  console.log('SNAPSHOT MODULES:', Array.from(snapshot.moduleKey));

  const logo = useMemo(
  () => (
    <Box sx={{ display: 'flex', p: 2, justifyContent: 'flex-start', fontWeight: 600 }}>
      {brandName}
    </Box>
  ),
  [brandName]
);

  console.log('SIDENAV GROUPS RENDER:', groups);

  return (
    <Box sx={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      {logo}

      <SimpleBar
        sx={{
          height: 'calc(100% - 70px)',
          '& .simplebar-content': {
            display: 'flex',
            flexDirection: 'column',
            height: '100%'
          },
          px: isExpanded ? 2 : 0
        }}
      >
        <Box sx={{ flexGrow: 1 }}>
          <List sx={{ px: isExpanded ? 1 : 0.5 }}>
            {groups.flatMap(group => group.items).map((item) => (
                <ListItemButton
                  key={item.id}
                  selected={pathname === item.path}
                    disabled={false}
                    onClick={() => {
                      if (item.disabled) {
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
                      py: isExpanded ? 1 : 1.5,
                      opacity: item.disabled ? 0.5 : 1,
                    }}
                >
                <ListItemIcon
                  sx={{
                    minWidth: 0,
                    mr: isExpanded ? 1.5 : 0,
                    justifyContent: 'center',
                    position: 'relative'
                  }}
                >
                  {item.icon ? React.createElement(item.icon, { size: iconSize }) : null}
                  {/**
                   * MODULE HEALTH DOT (B-07)
                   * ------------------------
                   * Calm ambient signal — not a badge count.
                   * Appears when module has items needing attention.
                   * Position: top-right of icon, small filled circle.
                   */}
                  {moduleHealth.has(item.id) && (
                    <Box
                      sx={{
                        position: 'absolute',
                        top: -2,
                        right: -2,
                        width: 7,
                        height: 7,
                        borderRadius: '50%',
                        bgcolor: 'warning.main',
                        border: '1.5px solid',
                        borderColor: 'background.paper',
                      }}
                    />
                  )}
                {item.disabled && (
                    <Box sx={{ position: 'absolute', bottom: -2, right: -2 }}>
                      <Lock size={8} />
                    </Box>
                  )}
                </ListItemIcon>
                {isExpanded && (
                  <ListItemText
                    primary={<Typography variant="body2">{item.title}</Typography>}
                  />
                )}
              </ListItemButton>
            ))}
          </List>
        </Box>
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