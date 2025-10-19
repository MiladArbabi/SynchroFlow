//packages/ui/src/components/DashboardNavbar/index.tsx
import React from 'react';
import AppBar from '@mui/material/AppBar';
import Toolbar from '@mui/material/Toolbar';
import IconButton from '@mui/material/IconButton';
import TextField from '@mui/material/TextField';
import Box from '@mui/material/Box';
import MenuIcon from '@mui/icons-material/Menu';
import AccountCircleIcon from '@mui/icons-material/AccountCircle';
import NotificationsIcon from '@mui/icons-material/Notifications';

// Define the component's props for type safety
interface DashboardNavbarProps {
  isSidenavOpen: boolean;
  handleSidenavToggle: () => void;
}

const DashboardNavbar: React.FC<DashboardNavbarProps> = ({ handleSidenavToggle }) => {
  return (
    <AppBar
      position="sticky"
      sx={{
        backgroundColor: 'white',
        boxShadow: '0 1px 3px 0 rgba(0, 0, 0, 0.1), 0 1px 2px 0 rgba(0, 0, 0, 0.06)',
        color: 'text.primary',
        top: '1rem', // Creates the "floating" effect
        borderRadius: '0.75rem',
        padding: '0.25rem 0.5rem'
      }}
    >
      <Toolbar sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        {/* Left Side: Sidenav Toggle and Breadcrumbs/Title Placeholder */}
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <IconButton onClick={handleSidenavToggle} color="inherit">
            <MenuIcon />
          </IconButton>
          {/* Placeholder for Breadcrumbs */}
          <Box sx={{ display: { xs: 'none', sm: 'block' } }}>
            {/* You can add your Breadcrumbs component back here later */}
          </Box>
        </Box>

        {/* Right Side: Search Field and Action Icons */}
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <TextField
            variant="outlined"
            size="small"
            placeholder="Search here..."
            sx={{ width: '250px', display: { xs: 'none', md: 'block' } }}
          />
          <IconButton color="inherit">
            <AccountCircleIcon />
          </IconButton>
          <IconButton color="inherit">
            <NotificationsIcon />
          </IconButton>
        </Box>
      </Toolbar>
    </AppBar>
  );
};

export default DashboardNavbar;