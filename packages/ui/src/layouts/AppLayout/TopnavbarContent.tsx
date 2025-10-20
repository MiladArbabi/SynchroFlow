//packages/ui/src/layouts/AppLayout/TopnavbarContent.tsx
import React from "react";
import { useLocation } from "react-router-dom";
import Breadcrumbs from "../../components/Breadcrumbs";
import MDBox from "../../components/MDBox";
import IconButton from "@mui/material/IconButton";
import Icon from "@mui/material/Icon";
import MenuIcon from "@mui/icons-material/Menu";

interface TopnavbarContentProps {
  isSidenavOpen: boolean;
  handleSidenavToggle: () => void;
}

const TopnavbarContent: React.FC<TopnavbarContentProps> = ({ isSidenavOpen, handleSidenavToggle }) => {
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
          <MenuIcon />
        </IconButton>
        <Breadcrumbs icon="home" title={route[route.length - 1]} route={route} light={false} />
      </MDBox>

      {/* Right Side: Icons (Search, Notifications, User) */}
      <MDBox display="flex" alignItems="center" gap={1}>
        <IconButton size="small" disableRipple>
          <Icon>search</Icon>
        </IconButton>
        <IconButton size="small" disableRipple>
          <Icon>notifications</Icon>
        </IconButton>
        <IconButton size="small" disableRipple>
          <Icon>account_circle</Icon>
        </IconButton>
      </MDBox>
    </MDBox>
  );
}

export default TopnavbarContent;