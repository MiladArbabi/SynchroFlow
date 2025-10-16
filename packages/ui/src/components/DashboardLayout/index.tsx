// packages/ui/src/components/DashboardLayout/index.tsx
import React, { useEffect } from "react";
import { useLocation } from "react-router-dom";
import MDBox from "components/MDBox";
import { useMaterialUIController, setLayout } from "contexts/MaterialUI";

interface DashboardLayoutProps {
  children: React.ReactNode;
}

export const DashboardLayout: React.FC<DashboardLayoutProps> = ({ children }) => {
  const [controller, dispatch] = useMaterialUIController();
  const { miniSidenav } = controller;
  const { pathname } = useLocation();

  useEffect(() => {
    setLayout(dispatch, "dashboard");
  }, [pathname, dispatch]);

  return (
    <MDBox
      sx={({ breakpoints, transitions, functions: { pxToRem } }: any) => ({
        p: 3,
        position: "relative",
        [breakpoints.up("xl")]: {
          marginLeft: miniSidenav ? pxToRem(120) : pxToRem(274),
          transition: transitions.create(["margin-left", "margin-right"], {
            easing: transitions.easing.easeInOut,
            duration: transitions.duration.standard,
          }),
        },
      })}
    >
      {children}
    </MDBox>
  );
}

export default DashboardLayout;