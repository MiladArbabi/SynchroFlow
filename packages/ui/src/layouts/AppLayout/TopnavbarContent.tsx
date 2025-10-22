// packages/ui/src/layouts/AppLayout/TopnavbarContent.tsx
import React, { useContext } from "react";
import { useLocation, Link as RouterLink } from "react-router-dom";
import { Box, IconButton, Button, Typography, Breadcrumbs as MuiBreadcrumbs, Link } from "@mui/material"; // Renamed Breadcrumbs import
import IconComponent from "../../components/Icon";

import { ConfigContext } from 'contexts/ConfigContext';
import useConfig from 'hooks/useConfig';

// --- BERRY HEADER SECTION IMPORTS ---
// Import the *stub* components we just created
import SearchSection from 'layout/MainLayout/Header/SearchSection';
import MegaMenuSection from 'layout/MainLayout/Header/MegaMenuSection'; // Keep commented for now
import LocalizationSection from 'layout/MainLayout/Header/LocalizationSection';
import NotificationSection from 'layout/MainLayout/Header/NotificationSection';
import FullScreenSection from 'layout/MainLayout/Header/FullScreenSection';
import ProfileSection from 'layout/MainLayout/Header/ProfileSection';
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
      // Add gap for spacing between left and right sections if needed
      gap={2}
    >
      {/* === Left Side: Stays the Same === */}
      <Box display="flex" alignItems="center" gap={2}>
        <IconButton onClick={handleToggleSidenav} size="small" disableRipple>
          <IconComponent name="Menu" size="medium" color="inherit" />
        </IconButton>
        <MuiBreadcrumbs aria-label="breadcrumb">
          <Link component={RouterLink} underline="hover" color="inherit" to="/dashboard">
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

      {/* === Right Side: Use Berry Header Sections === */}
      <Box display="flex" alignItems="center" gap={1}>
        {/* Layout Edit Buttons (Keep these for now) */}
        {isEditing && (
          <Button
            variant="contained" color="info" size="small"
            onClick={onAddWidget} startIcon={<IconComponent name="Plus" size="small" />}
          > Add Widget </Button>
        )}
        <Button
           variant={isEditing ? "contained" : "outlined"} color={isEditing ? "success" : "info"} size="small"
           onClick={onEditToggle} startIcon={<IconComponent name={isEditing ? "Save" : "Pencil"} size="small" />}
        > {isEditing ? "Done" : "Edit Layout"} </Button>

         {/* --- Add Berry Sections Here --- */}
         <SearchSection />
         <Box sx={{ display: { xs: 'none', md: 'block' } }}><MegaMenuSection /></Box>
         <Box sx={{ display: { xs: 'none', sm: 'block' } }}><LocalizationSection /></Box>
         <NotificationSection />
         <Box sx={{ display: { xs: 'none', lg: 'block' } }}><FullScreenSection /></Box>
         <ProfileSection />
         {/* --- End Berry Sections --- */}
      </Box>
    </Box>
  );
};

export default TopnavbarContent;