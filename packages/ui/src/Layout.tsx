// packages/ui/src/Layout.tsx
import { useState, useEffect } from "react";
import { useLocation, Outlet } from "react-router-dom";
import DashboardLayout from "components/DashboardLayout";
import DashboardNavbar from "components/DashboardNavbar";
import Sidenav from "components/Sidenav";
import Configurator from "components/Configurator";
import { useMaterialUIController, setMiniSidenav } from "contexts/MaterialUI";
import brandWhite from "assets/images/logo-ct.png";
import brandDark from "assets/images/logo-ct-dark.png";
import routes from "routes";

export function Layout() {
  const [controller, dispatch] = useMaterialUIController();
  const { miniSidenav, sidenavColor, transparentSidenav, whiteSidenav, darkMode } = controller;
  const [onMouseEnter, setOnMouseEnter] = useState(false);
  const { pathname } = useLocation();

  const handleOnMouseEnter = () => {
    if (miniSidenav && !onMouseEnter) {
      setMiniSidenav(dispatch, false);
      setOnMouseEnter(true);
    }
  };

  const handleOnMouseLeave = () => {
    if (onMouseEnter) {
      setMiniSidenav(dispatch, true);
      setOnMouseEnter(false);
    }
  };

  useEffect(() => {
    // Placeholder for any layout-specific effects
  }, [pathname]);

  return (
    <>
      <Sidenav
        color={sidenavColor}
        brand={(transparentSidenav && !darkMode) || whiteSidenav ? brandDark : brandWhite}
        brandName="SynchroFlow"
        routes={routes}
        onMouseEnter={handleOnMouseEnter}
        onMouseLeave={handleOnMouseLeave}
      />
      <Configurator />
      <DashboardLayout>
        <DashboardNavbar />
        <Outlet />
      </DashboardLayout>
    </>
  );
}