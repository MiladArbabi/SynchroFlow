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
  IconLayoutDashboard,
  IconShoppingCart,
  IconBox,
  IconUsers,
  IconChartBar,
  IconCash,
  IconSettings
} from '@tabler/icons-react';
import SimpleBar from 'ui-component/third-party/SimpleBar';
import LogoSection from 'layout/MainLayout/LogoSection';

const SidenavContent: React.FC = () => {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const [drawerOpen, setDrawerOpen] = React.useState(true);

  const logo = useMemo(
    () => (
      <Box sx={{ display: 'flex', p: 2, justifyContent: drawerOpen ? 'flex-start' : 'center' }}>
        <LogoSection isCollapsed={!drawerOpen} />
      </Box>
    ),
    [drawerOpen]
  );

  const navItems = [
    { label: 'Dashboard', path: '/dashboard', icon: <IconLayoutDashboard size={18} /> },
    { label: 'Orders', path: '/orders', icon: <IconShoppingCart size={18} /> },
    { label: 'Products', path: '/products', icon: <IconBox size={18} /> },
    { label: 'Customers', path: '/customers', icon: <IconUsers size={18} /> },
    { label: 'Analytics', path: '/analytics', icon: <IconChartBar size={18} /> },
    { label: 'Finances', path: '/finances', icon: <IconCash size={18} /> }
  ];

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
            {navItems.map((item) => (
              <ListItemButton
                key={item.path}
                sx={{ borderRadius: '8px' }}
                selected={pathname === item.path}
                onClick={() => navigate(item.path)}
              >
                <ListItemIcon sx={{ minWidth: 40, justifyContent: 'center' }}>
                  {item.icon}
                </ListItemIcon>
                {drawerOpen && (
                  <ListItemText
                    primary={<Typography variant="body2">{item.label}</Typography>}
                  />
                )}
              </ListItemButton>
            ))}
          </List>
        </Box>

        {/* Account Settings — pinned bottom */}
        <List sx={{ px: drawerOpen ? 1 : 0.5, pb: 1 }}>
          <ListItemButton
            sx={{ borderRadius: '8px' }}
            selected={pathname === '/account/settings'}
            onClick={() => navigate('/account/settings')}
          >
            <ListItemIcon sx={{ minWidth: 40, justifyContent: 'center' }}>
              <IconSettings size={18} />
            </ListItemIcon>
            {drawerOpen && (
              <ListItemText
                primary={<Typography variant="body2">Settings</Typography>}
              />
            )}
          </ListItemButton>
        </List>
      </SimpleBar>
    </Box>
  );
};

export default SidenavContent;