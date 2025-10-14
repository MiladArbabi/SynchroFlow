import React, { useState, useEffect } from 'react';
import { Outlet, useLocation } from 'react-router-dom';

// Import the components we copied from the Material Dashboard template
import Sidenav from './components/Sidenav';
import DashboardNavbar from './components/DashboardNavbar';
import DashboardLayout from './components/DashboardLayout';

// Import the context and routes
import { useMaterialUIController, setMiniSidenav } from './contexts/MaterialUI';
import routes from './routes.js'; // The routes file for the Sidenav

export function Layout() {
  const [controller, dispatch] = useMaterialUIController();
  const { miniSidenav, sidenavColor } = controller;
  const [onMouseEnter, setOnMouseEnter] = useState(false);
  const { pathname } = useLocation();

  // Open Sidenav on mouse enter
  const handleOnMouseEnter = () => {
    if (miniSidenav && !onMouseEnter) {
      setMiniSidenav(dispatch, false);
      setOnMouseEnter(true);
    }
  };

  // Close Sidenav on mouse leave
  const handleOnMouseLeave = () => {
    if (onMouseEnter) {
      setMiniSidenav(dispatch, true);
      setOnMouseEnter(false);
    }
  };
  
  // Set the document layout for the navbar
  //useEffect(() => {
  // This is a pattern from the template to ensure the layout name is set
  //}, [dispatch, pathname]);

  return (
    <DashboardLayout>
      <Sidenav
        color={sidenavColor}
        brand=""
        brandName="SynchroFlow"
        routes={routes}
        onMouseEnter={handleOnMouseEnter}
        onMouseLeave={handleOnMouseLeave}
      />
      <DashboardNavbar />
      <main style={{ flex: 1, padding: '2rem' }}>
        <Outlet />
      </main>
    </DashboardLayout>
  );
}