// packages/ui/src/layouts/AppLayout/SidenavContent.tsx
import React from "react";
import { useLocation, NavLink } from "react-router-dom";
import List from "@mui/material/List";
import Divider from "@mui/material/Divider";
import Link from "@mui/material/Link";
import MDBox from "../../components/MDBox";
import MDTypography from "../../components/MDTypography";
import SidenavCollapse from "../../components/SidenavCollapse";
import routes from "../../routes";

const brandName = "SynchroFlow"; // Placeholder for now

const SidenavContent: React.FC = () => {
  const location = useLocation();
  const collapseName = location.pathname.replace("/", "");

  const renderRoutes = routes.map(({ type, name, icon, title, key, href, route, component }) => {
    // We'll ignore the 'Sign In' route for the main sidenav
    if (key === "sign-in") return null;

    if (type === "collapse") {
      return href ? (
        <Link href={href} key={key} target="_blank" rel="noreferrer" sx={{ textDecoration: "none" }}>
          <SidenavCollapse name={name!} icon={icon} active={key === collapseName} />
        </Link>
      ) : (
        <NavLink key={key} to={route!}>
          <SidenavCollapse name={name!} icon={icon} active={key === collapseName} />
        </NavLink>
      );
    } else if (type === "title") {
      return (
        <MDTypography
          key={key}
          color="white" // This will need to be adjusted once we have a real theme
          variant="caption"
          fontWeight="bold"
          textTransform="uppercase"
        >
          {title}
        </MDTypography>
      );
    } else if (type === "divider") {
      return <Divider key={key} sx={{ opacity: 0.6 }} />;
    }
    return null;
  });

  return (
    <>
      <MDBox pt={3} pb={1} px={2} textAlign="center">
        <MDBox component={NavLink} to="/" display="flex" alignItems="center">
          <MDBox width="100%">
            <MDTypography variant="h6" fontWeight="medium">
              {brandName}
            </MDTypography>
          </MDBox>
        </MDBox>
      </MDBox>
      <Divider sx={{ opacity: 0.6 }} />
      <List>{renderRoutes}</List>
    </>
  );
}

export default SidenavContent;