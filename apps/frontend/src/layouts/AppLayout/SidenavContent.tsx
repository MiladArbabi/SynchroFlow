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
import { useNavigate, useLocation } from 'react-router-dom';
import {
  IconShoppingCart,
  IconBox,
  IconUsers,
  IconCash,
  IconSettings,
  IconShieldCheck
} from '@tabler/icons-react';
import SimpleBar from 'ui-component/third-party/SimpleBar';
import LogoSection from 'layout/MainLayout/LogoSection';
import { useResolvedNavigation } from 'runtime/useResolvedNavigation';
import { useEntitlements } from 'contexts/EntitlementsContext';

interface SidenavProps {
  brandName: string;
  routes: any[];
  isSidenavOpen: boolean;
  isConnected: boolean;
}

const SidenavContent: React.FC<SidenavProps> = ({
  brandName,
  routes,
  isSidenavOpen,
  isConnected,
}) => {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const [drawerOpen, setDrawerOpen] = React.useState(true);
  const { groups } = useResolvedNavigation();

  const { snapshot } = useEntitlements();
  console.log('SNAPSHOT MODULES:', Array.from(snapshot.modules));

  const logo = useMemo(
    () => (
      <Box sx={{ display: 'flex', p: 2, justifyContent: drawerOpen ? 'flex-start' : 'center' }}>
        <LogoSection isCollapsed={!drawerOpen} />
      </Box>
    ),
    [drawerOpen]
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
          px: drawerOpen ? 2 : 0
        }}
      >
        <Box sx={{ flexGrow: 1 }}>
          <List sx={{ px: drawerOpen ? 1 : 0.5 }}>
            {groups.flatMap(group => group.items).map((item) => (

                <ListItemButton
                  key={item.id}
                  sx={{ borderRadius: '8px' }}
                  selected={pathname === item.path}
                  onClick={() => navigate(item.path)}
                >
                <ListItemIcon sx={{ minWidth: 40, justifyContent: 'center' }}>
                  {item.icon ? React.createElement(item.icon, { size: 18 }) : null}
                </ListItemIcon>
                {drawerOpen && (
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