// packages/ui/src/components/Sidenav/index.tsx
import { useLocation, NavLink } from "react-router-dom";

// MUI components
import List from "@mui/material/List";
import Divider from "@mui/material/Divider";
import Link from "@mui/material/Link";

// SynchroFlow components
import MDBox from "../MDBox";
import MDTypography from "../MDTypography";
import SidenavCollapse from "./SidenavCollapse";

// Styles
import SidenavRoot from "./SidenavRoot";

// Define the shape of a route object
interface Route {
  type: "collapse" | "title" | "divider";
  name?: string;
  key: string;
  icon?: React.ReactNode;
  route?: string;
  href?: string;
  title?: string;
}

interface SidenavProps {
  brandName: string;
  routes: readonly Route[];
  isSidenavOpen: boolean;
}

export const Sidenav: React.FC<SidenavProps> = ({ brandName, routes, isSidenavOpen }) => {
  const location = useLocation();
  const collapseName = location.pathname.replace("/", "");

  const renderRoutes = routes.map(({ type, name, icon, title, key, href, route }) => {
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
          color="white"
          variant="caption"
          fontWeight="bold"
          textTransform="uppercase"
        >
          {title}
        </MDTypography>
      );
    } else if (type === "divider") {
      return <Divider key={key} light={true} />;
    }
    return null;
  });

  return (
    <SidenavRoot
      ownerState={{ miniSidenav: !isSidenavOpen }}
    >
      <MDBox pt={3} pb={1} px={4} textAlign="center">
        <MDBox component={NavLink} to="/" display="flex" alignItems="center">
          <MDBox
            width={"100%"}
            style={{ opacity: isSidenavOpen ? 1 : 0, transition: 'opacity 0.2s ease-in-out' }}
          >
            <MDTypography variant="h6" fontWeight="medium" color="white">
              {brandName}
            </MDTypography>
          </MDBox>
        </MDBox>
      </MDBox>
      <Divider light={true} />
      <List>{renderRoutes}</List>
    </SidenavRoot>
  );
};

export default Sidenav;