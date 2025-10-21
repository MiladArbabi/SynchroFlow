// packages/ui/src/layouts/AppLayout/TopnavbarContent.tsx
import React from "react";
import { useLocation } from "react-router-dom";
import Breadcrumbs from "../../components/Breadcrumbs";
import MDBox from "../../components/MDBox";
import IconButton from "@mui/material/IconButton";
import IconComponent from "../../components/Icon";
import MDButton from "../../components/MDButton";

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
  
  const route = useLocation().pathname.split("/").slice(1);

  return (
    <MDBox
      display="flex"
      justifyContent="space-between"
      alignItems="center"
      height="100%"
      px={2}
    >
      {/* Left Side: Breadcrumbs and Sidenav Toggle */}
      <MDBox display="flex" alignItems="center" gap={2}>
        <IconButton onClick={handleSidenavToggle} size="small" disableRipple>
         <IconComponent name="Menu" size="medium" color="inherit" /> 
        </IconButton>
        <Breadcrumbs icon="home" title={route[route.length - 1] || 'Dashboard'} light={false} />
      </MDBox>

      {/* Right Side: Icons (Search, Notifications, User) */}
      <MDBox display="flex" alignItems="center" gap={1}>
        {isEditing && (
          <MDButton variant="gradient" color="info" size="small" onClick={onAddWidget} startIcon="Plus">
            Add Widget
          </MDButton>
        )}
        <MDButton
           variant={isEditing ? "gradient" : "outlined"}
           color={isEditing ? "success" : "info"}
           size="small"
           onClick={onEditToggle}
           startIcon={isEditing ? "Save" : "Edit"}
        >
          {isEditing ? "Done" : "Edit Layout"}
        </MDButton>
        <IconButton size="small" disableRipple>
          <IconComponent name="Search" size="small" color="inherit" />
        </IconButton>
        <IconButton size="small" disableRipple>
          <IconComponent name="Bell" size="small" color="inherit" />
        </IconButton>
        <IconButton size="small" disableRipple>
          <IconComponent name="User" size="small" color="inherit" />
        </IconButton>
      </MDBox>
    </MDBox>
  );
};

export default TopnavbarContent;