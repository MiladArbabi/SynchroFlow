// packages/ui/src/components/DashboardLayout/index.tsx

import { ReactNode } from "react";
import { Theme } from "@mui/material/styles";
import MDBox from "../MDBox";
import DashboardNavbar from "../DashboardNavbar";

interface DashboardLayoutProps {
  children: ReactNode;
  handleSidenavToggle: () => void;
}

export const DashboardLayout: React.FC<DashboardLayoutProps> = ({ 
  children, 
  handleSidenavToggle }) => {  
    
    return (
    <MDBox
      sx={(theme: Theme) => {
        return {
          flexGrow: 1, 
          width: '100%',
          p: 3,
          position: "relative"
        };
      }}
    >
        <DashboardNavbar handleSidenavToggle={handleSidenavToggle} />
      {children}
    </MDBox>
  );
};

export default DashboardLayout;