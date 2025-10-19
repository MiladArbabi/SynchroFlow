// packages/ui/src/components/DashboardLayout/index.tsx

import { ReactNode } from "react";
import { Theme } from "@mui/material/styles";
import MDBox from "../MDBox";
import DashboardNavbar from "../DashboardNavbar";

interface DashboardLayoutProps {
  children: ReactNode;
  isSidenavOpen: boolean;
  handleSidenavToggle: () => void;
}

export const DashboardLayout: React.FC<DashboardLayoutProps> = ({ 
  children, 
  isSidenavOpen, 
  handleSidenavToggle }) => {  
    
    return (
    <MDBox
      sx={(theme: Theme) => {
        // Define constants in the correct scope, using the theme object
        const sidenavWidth = theme.spacing(32); // 256px
        const collapsedSidenavWidth = theme.spacing(12); // 96px

        return {
          p: 3,
          position: "relative",
          [theme.breakpoints.up("xl")]: {
            marginLeft: isSidenavOpen ? sidenavWidth : collapsedSidenavWidth,
          },
          transition: theme.transitions.create(["margin-left"], {
            easing: theme.transitions.easing.easeInOut,
            duration: theme.transitions.duration.standard,
          }),
        };
      }}
    >
      <DashboardNavbar isSidenavOpen={isSidenavOpen} handleSidenavToggle={handleSidenavToggle} />
      {children}
    </MDBox>
  );
};

export default DashboardLayout;