//packages/ui/src/layouts/AppLayout/TopnavbarContent.tsx
import React from "react";
import MDBox from "../../components/MDBox";

interface TopnavbarContentProps {
  isSidenavOpen: boolean;
  handleSidenavToggle: () => void;
}

const TopnavbarContent: React.FC<TopnavbarContentProps> = () => {

  return (
    <MDBox
      display="flex"
      justifyContent="space-between"
      alignItems="center"
      height="100%"
      px={2}
    >
      {/* Left Side: Breadcrumbs and Sidenav Toggle */}
      <MDBox display="flex" alignItems="center" gap={2}>
      </MDBox>
    </MDBox>
  );
}

export default TopnavbarContent;