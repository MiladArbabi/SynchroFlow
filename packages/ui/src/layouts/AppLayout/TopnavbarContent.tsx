/* eslint-disable @typescript-eslint/no-unused-vars */
// packages/ui/src/layouts/AppLayout/TopnavbarContent.tsx
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
import IconComponent from "../../components/Icon";
import { KoreIcon } from "components/KoreIcon";

import useConfig from 'hooks/useConfig';
import { useOpsContext } from 'contexts/OpsContext';

// --- BERRY HEADER SECTION IMPORTS ---
// import MegaMenuSection from 'layout/MainLayout/Header/MegaMenuSection'; // Keep commented for now
import NotificationSection from 'layout/MainLayout/Header/NotificationSection';
// import FullScreenSection from 'layout/MainLayout/Header/FullScreenSection';
import ProfileSection from 'layout/MainLayout/Header/ProfileSection';
import MobileSection from 'layout/MainLayout/Header/MobileSection';
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
  const pathnames = location.pathname.split("/").filter((x) => x);
  const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
  const { context: opsContext } = useOpsContext();
  const { state, dispatch } = useConfig();

  const matchDownMd = useMediaQuery(theme.breakpoints.down('md'));

  // 4. Calculate new insights
  const newInsightCount = opsContext.proactiveInsights.filter(
    (i) => i.status === 'new'
  ).length;

  // ---  SIDEBAR HANDLER ---
  const handleToggleSidenav = () => {
   dispatch({ type: 'SET_MINI_DRAWER', payload: !state.miniDrawer });
  };

  // ---  OPS CONSOLE HANDLER ---
  const handleToggleOpsConsole = () => {
    dispatch({ type: 'TOGGLE_OPS_CONSOLE' });
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
          <Link component={RouterLink} underline="hover" color="inherit" to="/dashboard" sx={{display: 'flex', alignItems: 'center'}}>
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
        {/* --- Berry Sections in Order --- */}
        {/* --- KORE ICON --- */}
        <Tooltip title="Open Kore Command (Cmd+J)">
          <IconButton
            color="inherit"
            onClick={handleToggleOpsConsole}
            data-testid="kore-navbar-button"
            size="small" 
            disableRipple
          >
            <KoreIcon isActive={newInsightCount > 0} />
          </IconButton>
        </Tooltip>

        {/*<Box sx={{ display: { xs: 'none', md: 'block' } }}><MegaMenuSection /></Box> */}          
        <NotificationSection />
        {/* <Box sx={{ display: { xs: 'none', lg: 'block' } }}><FullScreenSection /></Box> */}
        
        {/* Layout Edit Buttons (Keep these for now) */}
        {/* --- MODIFIED: Group buttons when editing --- */}
        <Box sx={{ display: { xs: 'none', sm: 'flex' }, alignItems: 'center' }}>
          {isEditing ? (
            // 2. If editing, show the grouped container
            <Box
              sx={{
                display: 'flex',
                alignItems: 'center',
                gap: 0.5,
                border: '1px solid',
                borderColor: theme.palette.divider,
                borderRadius: '8px', // Adjust as needed
                padding: '4px',
              }}
            >
              <Tooltip title="Add Widget">
                <IconButton onClick={onAddWidget} color="info" size="small">
                  <IconComponent name="Plus" size="medium" />
                </IconButton>
              </Tooltip>
              <Tooltip title="Save Layout">
                <IconButton onClick={onEditToggle} color="success" size="small">
                  <IconComponent name="Save" size="medium" />
                </IconButton>
              </Tooltip>
            </Box>
          ) : (
          <Tooltip title={isEditing ? "Save Layout" : "Edit Layout"}>
            <IconButton onClick={onEditToggle} color="info">
              <IconComponent name={isEditing ? "Save" : "Pencil"} size="medium" />
            </IconButton>
          </Tooltip>
          )}
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