// packages/ui/src/components/Breadcrumbs/index.tsx

import React from 'react';
import MDBox from '../MDBox';
import MDTypography from '../MDTypography';
import HomeIcon from '@mui/icons-material/Home'; // Import the specific icon

interface BreadcrumbsProps {
  icon: React.ReactNode;
  title: string;
  light?: boolean;
}

const Breadcrumbs: React.FC<BreadcrumbsProps> = ({ icon, title, light }) => {
  return (
    <MDBox mr={{ xs: 0, md: 2 }} display="flex" alignItems="center">
      <HomeIcon color={light ? "white" : "dark"} sx={{ mr: 1 }} />
      <MDTypography
        fontWeight="bold"
        textTransform="capitalize"
        variant="h6"
        color={light ? "white" : "dark"}
        noWrap
      >
        {title}
      </MDTypography>
    </MDBox>
  );
};

export default Breadcrumbs;