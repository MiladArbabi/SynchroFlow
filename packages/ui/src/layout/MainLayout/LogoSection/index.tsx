// packages/ui/src/layout/MainLayout/LogoSection/index.tsx
import React from 'react';
import { Link as RouterLink } from 'react-router-dom';

// material-ui
import Link from '@mui/material/Link';

// project imports
import { DASHBOARD_PATH } from 'config'; // Ensure this path is correct for your app
import Logo from 'ui-component/Logo';

// ==============================|| MAIN LOGO ||============================== //

// Define the component type using React.FC
const LogoSection: React.FC = () => {
  return (
    <Link component={RouterLink} to={DASHBOARD_PATH} aria-label="theme-logo">
      <Logo />
    </Link>
  );
};

export default LogoSection;