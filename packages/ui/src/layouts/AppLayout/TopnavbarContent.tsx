// packages/ui/src/layouts/AppLayout/TopnavbarContent.tsx
import React, { useContext } from "react"; // Import useContext
import { useLocation, Link as RouterLink } from "react-router-dom";
import { Box, IconButton, Button, Typography, Link } from "@mui/material"; // Consolidate MUI imports
import Breadcrumbs from '@mui/material/Breadcrumbs';
import IconComponent from "../../components/Icon";

// --- CONTEXT IMPORT ---
import { ConfigContext } from 'contexts/ConfigContext';
import useConfig from 'hooks/useConfig'; // We still need useConfig to read the state if needed
// --- END CONTEXT ---

interface TopnavbarContentProps {
  // handleSidenavToggle: () => void; // REMOVE this prop, we'll handle toggle internally
  isEditing: boolean;
  onEditToggle: () => void;
  onAddWidget: () => void;
}

const TopnavbarContent: React.FC<TopnavbarContentProps> = ({
  // handleSidenavToggle, // REMOVE this prop
  isEditing,
  onEditToggle,
  onAddWidget,
}) => {
  const location = useLocation();
  const pathnames = location.pathname.split("/").filter((x) => x);
  const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

  // --- GET STATE & DISPATCH ---
  const { state } = useConfig(); // Read state if needed (e.g., to change icon based on state)
  const { dispatch } = useContext(ConfigContext); // Get dispatch function

  // --- NEW TOGGLE HANDLER ---
  const handleToggleSidenav = () => {
    // Dispatch the action to flip the miniDrawer state
    dispatch({ type: 'SET_MINI_DRAWER', payload: !state.miniDrawer });
  };
  // --- END NEW HANDLER ---

  return (
    <Box
      display="flex"
      justifyContent="space-between"
      alignItems="center"
      height="100%"
      px={2}
    >
      {/* Left Side: Breadcrumbs and Sidenav Toggle */}
      <Box display="flex" alignItems="center" gap={2}>
        {/* Use the NEW internal handler */}
        <IconButton onClick={handleToggleSidenav} size="small" disableRipple>
          <IconComponent name="Menu" size="medium" color="inherit" />
        </IconButton>
        <Breadcrumbs aria-label="breadcrumb">
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
        </Breadcrumbs>
      </Box>

      {/* Right Side: Icons & Buttons */}
      <Box display="flex" alignItems="center" gap={1}>
        {isEditing && (
          <Button
            variant="contained"
            color="info"
            size="small"
            onClick={onAddWidget}
            startIcon={<IconComponent name="Plus" size="small" />}
          >
            Add Widget
          </Button>
        )}
        <Button
           variant={isEditing ? "contained" : "outlined"}
           color={isEditing ? "success" : "info"}
           size="small"
           onClick={onEditToggle}
           startIcon={<IconComponent name={isEditing ? "Save" : "Pencil"} size="small" />}
        >
          {isEditing ? "Done" : "Edit Layout"}
        </Button>
        <IconButton size="small" disableRipple>
          <IconComponent name="Search" size="small" color="inherit" />
        </IconButton>
        <IconButton size="small" disableRipple>
          <IconComponent name="Bell" size="small" color="inherit" />
        </IconButton>
        <IconButton size="small" disableRipple>
          <IconComponent name="User" size="small" color="inherit" />
        </IconButton>
      </Box>
    </Box>
  );
};

export default TopnavbarContent;