/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable @typescript-eslint/no-unused-vars */
// apps/frontend/src/layouts/AppLayout/TopnavbarContent.tsx
import React, { useContext } from "react";
import { useLocation, Link as RouterLink } from "react-router-dom";
import { 
  Box, 
  IconButton,
  Typography, 
  Breadcrumbs as MuiBreadcrumbs, 
  useMediaQuery, 
  Link, 
  Tooltip, 
  useTheme,
} from "@mui/material";
import { useColorScheme } from '@mui/material/styles';
import IconComponent from "../../components/Icon";

import useConfig from 'hooks/useConfig';

// --- BERRY HEADER SECTION IMPORTS ---
// import MegaMenuSection from 'layout/MainLayout/Header/MegaMenuSection'; // Keep commented for now

// import FullScreenSection from 'layout/MainLayout/Header/FullScreenSection';
import ProfileSection from 'layout/MainLayout/Header/ProfileSection';
import MobileSection from 'layout/MainLayout/Header/MobileSection';
import { openFt1Checklist } from "activation/openFt1Checklist";
// --- END BERRY IMPORTS ---

interface TopnavbarContentProps {
  isEditing: boolean;
  onEditToggle: () => void;
  onAddWidget: () => void;
}

const TopnavbarContent: React.FC<TopnavbarContentProps> = ({
  isEditing,
  onEditToggle,
  onAddWidget,
}) => {
  const location = useLocation();
  const theme = useTheme();
  const { mode, setMode } = useColorScheme();

  const pathnames = location.pathname.split("/").filter((x) => x);
  const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
  const { state, dispatch } = useConfig();

  const matchDownMd = useMediaQuery(theme.breakpoints.down('md'));

  const isDev =
   typeof import.meta !== 'undefined' &&
   (import.meta as any).env?.DEV === true;

  // ---  SIDEBAR HANDLER ---
  const handleToggleSidenav = () => {
   dispatch({ type: 'SET_MINI_DRAWER', payload: !state.miniDrawer });
  };

  return (
    <Box
      sx={{
        width: '100%',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '0 16px'
      }}
    >
      {/* === Left Side === */}
      <Box sx={{ display: 'flex', alignItems: 'center' }}>
        <IconButton onClick={handleToggleSidenav} size="small" disableRipple>
          <IconComponent name="PanelLeft" size="medium" color="inherit" /* style={{ transform: state.miniDrawer ? 'rotate(180deg)' : 'rotate(0deg)', transition: 'transform 0.3s' }} */ />
        </IconButton>
        <MuiBreadcrumbs aria-label="breadcrumb">
          {/* --- HOME LINK --- */}
          <Link component={RouterLink} underline="hover" color="inherit" to="/" sx={{display: 'flex', alignItems: 'center'}}>
            {/* <IconComponent name="Breadcrumbs" size="small" color="inherit" /> */}
          </Link>
          {pathnames.map((value, index) => {
            const last = index === pathnames.length - 1;
            const to = `/${pathnames.slice(0, index + 1).join('/')}`;
            return last ? (
              <Typography color="text.primary" key={to}>{capitalize(value.replace('-', ' '))}</Typography>
            ) : (
              <Link component={RouterLink} underline="hover" color="inherit" to={to} key={to}>{capitalize(value.replace('-', ' '))}</Link>
            );
          })}
        </MuiBreadcrumbs>
      </Box>

      {/* Spacer to push right side items */}
      <Box sx={{ flexGrow: 1 }} />

      <Box display="flex" alignItems="center" gap={{ xs: 0.5, sm: 1, md: 1.5 }}> {/* Adjust gap */}
       <Box display="flex" alignItems="center" gap={0.5}>
        <Tooltip title="Light mode">
          <IconButton
            size="small"
            onClick={() => setMode('light')}
            sx={{
              color: mode === 'light' ? 'primary.main' : 'text.secondary'
            }}
          >
            <IconComponent name="Sun" size="medium" />
          </IconButton>
        </Tooltip>

        <Tooltip title="Dark mode">
          <IconButton
            size="small"
            onClick={() => setMode('dark')}
            sx={{
              color: mode === 'dark' ? 'primary.main' : 'text.secondary'
            }}
          >
            <IconComponent name="Moon" size="medium" />
          </IconButton>
        </Tooltip>
      </Box>

        <ProfileSection />
         {/* --- End Berry Sections --- */}
         {/* Mobile Section - Renders only on 'xs' screens */}
        <Box sx={{ display: { xs: 'block', sm: 'none' } }}> {/* Show only on xs */}
          <MobileSection />
        </Box>
      </Box>
    </Box>
  );
};

export default TopnavbarContent;