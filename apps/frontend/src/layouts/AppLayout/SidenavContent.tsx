/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable @typescript-eslint/no-unused-vars */
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
import { useModuleHealth } from 'runtime/useModuleHealth';
import { useNavigate, useLocation } from 'react-router-dom';
import SimpleBar from 'ui-component/third-party/SimpleBar';
import { useResolvedNavigation } from 'runtime/useResolvedNavigation';
import { useEntitlements } from 'contexts/EntitlementsContext';

type SidenavState = 'EXPANDED' | 'COMPACT' | 'CLOSED';

interface SidenavProps {
  brandName: string;
  routes: any[];
  sidenavState: SidenavState;
  isConnected: boolean;
}

const SidenavContent: React.FC<SidenavProps> = ({
  brandName,
  routes,
  sidenavState,
  isConnected,
}) => {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const { groups } = useResolvedNavigation();
  const { snapshot } = useEntitlements();
  const moduleHealth = useModuleHealth();

  const isExpanded = sidenavState === 'EXPANDED';
  const isCompact = sidenavState === 'COMPACT';

  const iconSize = isExpanded ? 18 : isCompact ? 22 : 18;

  console.log('SNAPSHOT MODULES:', Array.from(snapshot.modules));

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
                  sx={{
                    borderRadius: '8px',
                    justifyContent: isExpanded ? 'flex-start' : 'center',
                    px: isExpanded ? 1.5 : 0,
                    py: isExpanded ? 1 : 1.5
                  }}
                  selected={pathname === item.path}
                  onClick={() => navigate(item.path)}
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
    </Box>
  );
};

export default SidenavContent;