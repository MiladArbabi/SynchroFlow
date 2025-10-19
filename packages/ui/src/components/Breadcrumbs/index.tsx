// packages/ui/src/components/Breadcrumbs/index.tsx

import React from 'react';
import MDBox from '../MDBox';
import MDTypography from '../MDTypography';

interface BreadcrumbsProps {
  icon: React.ReactNode;
  title: string;
  light?: boolean;
}

const Breadcrumbs: React.FC<BreadcrumbsProps> = ({ icon, title, light }) => {
  return (
    <MDBox mr={{ xs: 0, md: 2 }}>
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