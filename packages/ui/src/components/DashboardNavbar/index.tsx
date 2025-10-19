// packages/ui/src/components/DashboardNavbar/index.tsx

import { useState } from "react";
import { useLocation, Link } from "react-router-dom";

// MUI components
import AppBar from "@mui/material/AppBar";
import Toolbar from "@mui/material/Toolbar";
import IconButton from "@mui/material/IconButton";
import Menu from "@mui/material/Menu";
import Icon from "@mui/material/Icon";
import TextField from "@mui/material/TextField";

// SynchroFlow components
import MDBox from "../MDBox";
import Breadcrumbs from "../Breadcrumbs"; // Now imports our new, simple component

// Styles
import {
  navbar,
  navbarContainer,
  navbarRow,
  navbarIconButton
} from "./styles"; // Now imports our fixed styles

// Props interface
interface DashboardNavbarProps {
  isSidenavOpen: boolean;
  handleSidenavToggle: () => void;
  absolute?: boolean;
  light?: boolean;
}

export const DashboardNavbar: React.FC<DashboardNavbarProps> = ({ 
  isSidenavOpen, handleSidenavToggle, absolute, light }) => {
  const [openMenu, setOpenMenu] = useState<null | HTMLElement>(null);
  const route = useLocation().pathname.split("/").slice(1);

  const handleOpenMenu = (event: React.MouseEvent<HTMLElement>) => setOpenMenu(event.currentTarget);
  const handleCloseMenu = () => setOpenMenu(null);

  const renderMenu = () => (
    <Menu
      anchorEl={openMenu}
      anchorReference={null}
      anchorOrigin={{ vertical: "bottom", horizontal: "left" }}
      open={Boolean(openMenu)}
      onClose={handleCloseMenu}
      sx={{ mt: 2 }}
    >
      <div style={{ padding: '8px 16px' }}>No new notifications</div>
    </Menu>
  );

  return (
    <AppBar
      position={absolute ? "absolute" : "sticky"}
      color="inherit"
      sx={(theme) => navbar(theme, { transparentNavbar: false, absolute, light })}
    >
      <Toolbar sx={(theme) => navbarContainer(theme)}>
        <MDBox color="inherit" mb={{ xs: 1, md: 0 }} sx={(theme) => navbarRow(theme)}>
          <Breadcrumbs icon={<Icon>home</Icon>} title={route[route.length - 1] || 'Dashboard'} light={light} />
        </MDBox>

        <MDBox sx={(theme) => navbarRow(theme)}>
          {/* The menu toggle icon is always visible */}
              <IconButton sx={navbarIconButton} size="small" onClick={handleSidenavToggle}>
                <Icon>menu</Icon>
              </IconButton>

              {/* FIX: Use 'isSidenavOpen' to conditionally show the rest of the navbar content */}
              {isSidenavOpen && (
                <>
                  <MDBox pr={1}>
                    <TextField label="Search here" variant="outlined" size="small" />
                  </MDBox>
                  <MDBox color={light ? "white" : "inherit"}>
                    <Link to="/authentication/sign-in">
                      <IconButton sx={navbarIconButton} size="small">
                        <Icon>account_circle</Icon>
                      </IconButton>
                    </Link>
                    <IconButton size="small" color="inherit" sx={navbarIconButton} onClick={handleOpenMenu}>
                      <Icon>notifications</Icon>
                    </IconButton>
                    {renderMenu()}
                  </MDBox>
                </>
              )}
          </MDBox>
      </Toolbar>
    </AppBar>
  );
};

export default DashboardNavbar;