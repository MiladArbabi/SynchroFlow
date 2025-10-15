// packages/ui/src/Layout.tsx
import { useState, useEffect } from "react";
import { useLocation, Outlet } from "react-router-dom";

// Material Dashboard 2 React example components
import Sidenav from "components/Sidenav";
import Configurator from "components/Configurator";
import DashboardLayout from "components/DashboardLayout";
import DashboardNavbar from "components/DashboardNavbar";

// Material Dashboard 2 React context
import { useMaterialUIController, setMiniSidenav, setOpenConfigurator } from "contexts/MaterialUI";

// Images and routes
import brandWhite from "assets/images/logo-ct.png";
import brandDark from "assets/images/logo-ct-dark.png";
import routes from "routes";

export function Layout() {
  const [controller, dispatch] = useMaterialUIController();
  const {
    miniSidenav,
    layout,
    openConfigurator,
    sidenavColor,
    transparentSidenav,
    whiteSidenav,
    darkMode,
  } = controller;
  const [onMouseEnter, setOnMouseEnter] = useState(false);
  const { pathname } = useLocation();

  // Open sidenav when mouse enter on mini sidenav
  const handleOnMouseEnter = () => {
    if (miniSidenav && !onMouseEnter) {
      setMiniSidenav(dispatch, false);
      setOnMouseEnter(true);
    }
  };

  // Close sidenav when mouse leave mini sidenav
  const handleOnMouseLeave = () => {
    if (onMouseEnter) {
      setMiniSidenav(dispatch, true);
      setOnMouseEnter(false);
    }
  };

   // We don't need the configurator for now, so this can be simplified.
  const handleConfiguratorOpen = () => setOpenConfigurator(dispatch, !openConfigurator);

   // Set the document layout for the navbar
  useEffect(() => {
    // This is a pattern from the template, we'll keep it for now.
  }, [dispatch, pathname]);

  // We only render the Sidenav and main layout if the layout is 'dashboard'
  if (layout !== "dashboard") {
    return <Outlet />;
  }

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