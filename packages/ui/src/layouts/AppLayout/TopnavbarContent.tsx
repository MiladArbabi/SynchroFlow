/* eslint-disable @typescript-eslint/no-unused-vars */
// packages/ui/src/layouts/AppLayout/TopnavbarContent.tsx
import React, { useContext } from "react";
import { useLocation, Link as RouterLink } from "react-router-dom";
import { Box, IconButton, Button, Typography, Breadcrumbs as MuiBreadcrumbs, Link, Tooltip } from "@mui/material"; // Renamed Breadcrumbs import
import IconComponent from "../../components/Icon";

import { ConfigContext } from 'contexts/ConfigContext';
import useConfig from 'hooks/useConfig';

// --- BERRY HEADER SECTION IMPORTS ---
// Import the *stub* components we just created
import SearchSection from 'layout/MainLayout/Header/SearchSection';
import MegaMenuSection from 'layout/MainLayout/Header/MegaMenuSection'; // Keep commented for now
import NotificationSection from 'layout/MainLayout/Header/NotificationSection';
import FullScreenSection from 'layout/MainLayout/Header/FullScreenSection';
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
  const pathnames = location.pathname.split("/").filter((x) => x);
  const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

  const { state } = useConfig();
  const { dispatch } = useContext(ConfigContext);

  const handleToggleSidenav = () => {
  dispatch({ type: 'SET_MINI_DRAWER', payload: !state.miniDrawer });
};

  return (
    <Box
      display="flex"
      justifyContent="space-between"
      alignItems="center"
      height="100%"
      px={2}
    >
      {/* === Left Side: Stays the Same === */}
      <Box display="flex" alignItems="center" gap={2}>
        <IconButton onClick={handleToggleSidenav} size="small" disableRipple>
          <IconComponent name="PanelLeft" size="medium" color="inherit" style={{ transform: state.miniDrawer ? 'rotate(180deg)' : 'rotate(0deg)', transition: 'transform 0.3s' }} />
        </IconButton>
        <MuiBreadcrumbs aria-label="breadcrumb">
          {/* --- ADDED HOME LINK --- */}
          <Link component={RouterLink} underline="hover" color="inherit" to="/dashboard" sx={{display: 'flex', alignItems: 'center'}}>
            <IconComponent name="Home" size="small" color="inherit" />
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
        <SearchSection />
        <Box sx={{ display: { xs: 'none', md: 'block' } }}><MegaMenuSection /></Box>
        <NotificationSection />
        <Box sx={{ display: { xs: 'none', lg: 'block' } }}><FullScreenSection /></Box>
        
        {/* Layout Edit Buttons (Keep these for now) */}
        <Box sx={{ display: { xs: 'none', sm: 'flex' }, alignItems: 'center', gap: 0.5 }}>
          {isEditing && (
            <Tooltip title="Add Widget">
              <IconButton onClick={onAddWidget} color="info">
                <IconComponent name="Plus" size="medium" />
              </IconButton>
            </Tooltip>
          )}
          <Tooltip title={isEditing ? "Save Layout" : "Edit Layout"}>
            <IconButton onClick={onEditToggle} color={isEditing ? "success" : "info"}>
              <IconComponent name={isEditing ? "Save" : "Pencil"} size="medium" />
            </IconButton>
          </Tooltip>
        </Box>
        {/* --- END REPLACEMENT --- */}

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