// packages/ui/src/components/DashboardLayout/index.tsx
import { ReactNode } from "react";
import { Theme } from "@mui/material/styles";
import MDBox from "../MDBox";

interface DashboardLayoutProps {
  children: ReactNode;
  isSidenavOpen: boolean;
}

export const DashboardLayout: React.FC<DashboardLayoutProps> = ({ children, isSidenavOpen }) => {  

  return (
    <MDBox
      sx={(theme: Theme) => ({
        p: 3,
        position: "relative",
        marginLeft: {
          xl: isSidenavOpen ? "274px" : "120px",
        },
        transition: theme.transitions.create(["margin-left"], {
          easing: theme.transitions.easing.easeInOut,
          duration: theme.transitions.duration.standard,
        }),
      })}
    >
      {children}
    </MDBox>
  );
}

export default DashboardLayout;