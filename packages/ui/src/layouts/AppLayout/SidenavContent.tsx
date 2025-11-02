/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable @typescript-eslint/no-unused-vars */
// packages/ui/src/layouts/AppLayout/SidenavContent.tsx
import React, { useMemo } from 'react';
import { Box, useMediaQuery, Chip, Stack } from '@mui/material'; // Import necessary MUI components
import { useTheme } from '@mui/material/styles';
import routes from 'routes';

// --- BERRY COMPONENT IMPORTS ---
import LogoSection from 'layout/MainLayout/LogoSection'; 
import MenuList from 'layout/MainLayout/MenuList';     
import SimpleBar from 'ui-component/third-party/SimpleBar'; 
import ConnectStoreCard from 'components/ConnectStoreCard';

// --- STATE MANAGEMENT & CONFIG ---
import { useGetMenuMaster } from 'api/menu'; // Uses our refactored hook (reads from ConfigContext)
import { MenuOrientation } from 'config';
import useConfig from 'hooks/useConfig';
// import MenuCard from './MenuCard'; // We'll add this later if needed

// --- CONSTANTS ---
// import { drawerWidth } from 'store/constant'; // We might not need this exact width logic initially

// ==============================|| NEW SIDENAV CONTENT ||============================== //

const SidenavContent: React.FC<{ 
  brandName: string;
  routes: any; // Consider typing this array
  isSidenavOpen: boolean;
  isConnected: boolean; // <-- 2. Accept new props
  onOpenModal: () => void; // <-- 2. Accept new props
}> = ({
  brandName, routes, isSidenavOpen,
  isConnected, // <-- 3. Use the new props
  onOpenModal  // <-- 3. Use the new props
}) => {
  const theme = useTheme();
  const downMD = useMediaQuery(theme.breakpoints.down('md'));

  const { menuMaster } = useGetMenuMaster(); // Reads drawerOpen state from our ConfigContext via the hook
  const drawerOpen = menuMaster.isDashboardDrawerOpened;

  const {
    state: { menuOrientation } // Read menuOrientation, though we might not use it directly here
  } = useConfig();

  // Memoize the Logo section
  const logo = useMemo(
    () => (
      <Box sx={{ display: 'flex', p: 2, justifyContent: 'center' }}> {/* Center logo */}
        <LogoSection />
      </Box>
    ),
    []
  );

  // Memoize the main menu drawer content
  const drawerContent = useMemo(() => {
    // Determine if the vertical menu is considered "open" based on orientation and state
    // For our layout, we primarily care about drawerOpen state.
    const isVerticalOpen = drawerOpen; // Simplified for our fixed vertical layout

    // Placeholder for potential extra content (like Berry's MenuCard or version chip)
    const extraContent = (
      <Box sx={{ p: 2, display: 'flex', flexDirection: 'column', gap: 2, pt: 0 }}>
        <Stack direction="row" sx={{ justifyContent: 'center', my: 2 }}>
          {/* Use VITE_APP_VERSION from env if available, otherwise a placeholder */}
          <Chip label={import.meta.env.VITE_APP_VERSION || 'v1.0.0'} size="small" color="default" />
        </Stack>
      </Box>
    );

    // Define base SX for the scrollable area
    // Adjust padding based on drawerOpen state
    const simpleBarSX = {
      // Set height to fill the available space minus the logo height (adjust as needed)
      height: 'calc(100% - 70px)', // Example height calculation
      '& .simplebar-content': {
        height: '100%',
        display: 'flex',
        flexDirection: 'column'
      },
      // Adjust padding inside the scrollbar based on drawer state
      px: drawerOpen ? 2 : 0, // More padding when open
      mt: drawerOpen ? 0 : '20px' // Add margin top when closed (mini)
    };

    return (
      // Use SimpleBar for consistent scrolling
      // We don't need the downMD conditional rendering here as SimpleBar handles mobile well enough
      // The Box inside SimpleBar provides the padding
      <SimpleBar sx={simpleBarSX}>
         <Box sx={{ flexGrow: 1 }}> {/* Box to allow MenuList to take available space */}
            <MenuList />
         </Box>

         {/* --- Render Card outside of 'extraContent' --- */}
        {/* Show the card if NOT connected, regardless of drawer state */}
        {/* Use padding to match 'extraContent' when open, and minimal when collapsed */}
        <Box sx={{ p: drawerOpen ? 2 : 0.5, pt: 2 }}>
          {!isConnected && <ConnectStoreCard onOpenModal={onOpenModal} />}
        </Box>

        {/* Render extra content only when the drawer is fully open */}
        {isVerticalOpen && extraContent}
      </SimpleBar>
    );
  }, [drawerOpen, isConnected, onOpenModal]); 

  return (
    // Use a Box that fills the height and acts as the main container
    <Box sx={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      {/* Render the logo */}
      {logo}
      {/* Render the drawer content (MenuList + Extras inside SimpleBar) */}
      {drawerContent}
    </Box>
  );
};

export default SidenavContent;