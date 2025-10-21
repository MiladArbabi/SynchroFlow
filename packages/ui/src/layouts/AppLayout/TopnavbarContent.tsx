// packages/ui/src/layouts/AppLayout/TopnavbarContent.tsx
import React from "react";
import { useLocation, Link as RouterLink } from "react-router-dom";
import { Box } from "@mui/material";
import IconButton from "@mui/material/IconButton";
import IconComponent from "../../components/Icon";
import { Button } from "@mui/material";
import {Typography} from "@mui/material";
import MuiBreadcrumbs from "@mui/material/Breadcrumbs"; 
import Link from "@mui/material/Link";

interface TopnavbarContentProps {
  handleSidenavToggle: () => void;
  isEditing: boolean;
  onEditToggle: () => void;
  onAddWidget: () => void;
}

const TopnavbarContent: React.FC<TopnavbarContentProps> = ({
  handleSidenavToggle,
  isEditing,
  onEditToggle,
  onAddWidget,
}) => {  
  
  const location = useLocation();
  const pathnames = location.pathname.split("/").filter((x) => x); // Filter out empty strings

  // Helper function to capitalize first letter
  const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

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
        <IconButton onClick={handleSidenavToggle} size="small" disableRipple>
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

      {/* Right Side: Icons (Search, Notifications, User) */}
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
           variant={isEditing ? "contained" : "outlined"} // Map gradient to contained
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