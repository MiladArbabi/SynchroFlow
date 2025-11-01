/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable @typescript-eslint/no-unused-vars */
// packages/ui/src/layout/Customization/index.tsx
import React, { useState, useContext } from 'react'; // Import useContext

// material-ui
import { useColorScheme, useTheme, Theme } from '@mui/material/styles'; // Import Theme
import Button from '@mui/material/Button';
import Divider from '@mui/material/Divider';
import Drawer from '@mui/material/Drawer';
import Fab from '@mui/material/Fab';
import Grid from '@mui/material/Grid'; // Use v2 Grid
import IconButton from '@mui/material/IconButton';
import Stack from '@mui/material/Stack';
import Tab from '@mui/material/Tab';
import Tabs from '@mui/material/Tabs';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import Box from '@mui/material/Box';
import { SxProps } from '@mui/system';


// project imports - Assuming these are copied and will be converted
import FontFamily from './FontFamily';
import BoxContainer from './BoxContainer';
import PresetColor from './PresetColor';
import Layout from './Layout'; // This might conflict with our AppLayout, rename if necessary
import InputFilled from './InputFilled';
import BorderRadius from './BorderRadius';
import ThemeModeLayout from './ThemeMode';
import SidebarDrawer from './SidebarDrawer';
import MenuOrientation from './MenuOrientation';

import { DEFAULT_THEME_MODE, ThemeMode } from 'config'; // Use our config
import MainCard from 'ui-component/cards/MainCard'; // Use converted
import AnimateButton from 'ui-component/extended/AnimateButton'; // Use converted
import SimpleBar from 'ui-component/third-party/SimpleBar'; // Use converted
import useConfig from 'hooks/useConfig'; // Use our hook
import { ConfigContext } from 'contexts/ConfigContext'; // Import context for dispatch

// assets
import { IconSettings, IconPlus, IconTextSize, IconColorSwatch } from '@tabler/icons-react';

// Helper interface for CustomTabPanel props
interface TabPanelProps {
  children?: React.ReactNode;
  index: number;
  value: number;
  [key: string]: any; // Allow other props
}

// Internal CustomTabPanel component
function CustomTabPanel(props: TabPanelProps) {
  const { children, value, index, ...other } = props;

  return (
    <div
      role="tabpanel"
      hidden={value !== index}
      id={`simple-tabpanel-${index}`}
      aria-labelledby={`simple-tab-${index}`}
      {...other}
    >
      {value === index && <Box sx={{ p: 2.5 }}>{children}</Box>} {/* Add padding */}
    </div>
  );
}

// a11y props helper
function a11yProps(index: number) {
  return {
    id: `simple-tab-${index}`,
    'aria-controls': `simple-tabpanel-${index}`
  };
}

// ==============================|| LIVE CUSTOMIZATION ||============================== //

const Customization: React.FC = () => {
  const theme = useTheme();
  // --- FIX: Use dispatch from ConfigContext ---
  // const { resetState } = useConfig(); // Removed resetState (handle via dispatch)
  const { dispatch } = useContext(ConfigContext);
  // --- END FIX ---
  const { setMode } = useColorScheme(); // MUI's hook for light/dark/system mode

  // drawer open state
  const [open, setOpen] = useState(false);
  const handleToggle = () => {
    setOpen(!open);
  };

  // tabs state
  const [value, setValue] = useState(0);
  // Type event as React.SyntheticEvent
  const handleChange = (_event: React.SyntheticEvent, newValue: number) => {
    setValue(newValue);
  };

  // --- FIX: Handle Reset using Dispatch ---
  const handleReset = () => {
    // Reset MUI's color scheme mode
    setMode(DEFAULT_THEME_MODE as 'light' | 'dark' | 'system'); // Cast type
    // Dispatch actions to reset our config state to defaults
    // Note: You might need to add a RESET action or dispatch individual SET actions
    // dispatch({ type: 'SET_THEME_DIRECTION', payload: theme.direction }); // Example reset
    dispatch({ type: 'SET_PRESET_COLOR', payload: 'default' }); // Example reset
    dispatch({ type: 'SET_BORDER_RADIUS', payload: 8 }); // Example reset
    // Add dispatch calls for other config properties...
    console.log("Resetting theme config..."); // Placeholder
  };
  // --- END FIX ---


  // Define Fab SX with type safety
  const fabSx: SxProps<Theme> = {
        borderRadius: 0,
        borderTopLeftRadius: '50%',
        borderBottomLeftRadius: '50%',
        borderTopRightRadius: '50%',
        borderBottomRightRadius: '4px',
        top: '25%',
        position: 'fixed',
        right: 10,
        zIndex: theme.zIndex.drawer + 1, // Ensure above drawer temporarily if needed
        // Use standard theme shadows
        boxShadow: theme.shadows[8], // Example shadow
        // Add hover styles if needed
         '&:hover': {
             boxShadow: theme.shadows[16]
         }
  };

  return (
    <>
      {/* toggle button */}
      <Tooltip title="Live Customize">
        <Fab
          component="div"
          onClick={handleToggle}
          size="medium"
          variant="circular"
          color="secondary"
          sx={fabSx}
        >
          <AnimateButton type="rotate">
            <IconButton color="inherit" size="large" disableRipple aria-label="live customize">
              <IconSettings />
            </IconButton>
          </AnimateButton>
        </Fab>
      </Tooltip>

      <Drawer
        anchor="right"
        onClose={handleToggle}
        open={open}
        // Use slotProps for Paper styles
        slotProps={{ paper: { sx: { width: 375, border: 'none' } } }} // Adjust width if needed
      >
        {open && (
          <SimpleBar sx={{ height: '100%' }}>
            <MainCard title="Theme Customization" content={false} border={false} sx={{ height: '100%' }}>
              {/* Header with Reset and Close */}
              <Stack
                  direction="row"
                  alignItems="center"
                  justifyContent="space-between"
                  spacing={1.5} // Use spacing prop
                  sx={{ p: 2.5 }}
              >
                <Typography variant="h5">Theme Customization</Typography>
                <Stack direction="row" alignItems="center" spacing={1.25}> {/* Use spacing */}
                  <Button variant="outlined" color="error" size="small" onClick={handleReset}>
                    Reset
                  </Button>
                  <IconButton sx={{ p: 0, color: 'grey.600' }} onClick={handleToggle} aria-label="close customization drawer">
                    <IconPlus size={24} style={{ transform: 'rotate(45deg)' }} />
                  </IconButton>
                </Stack>
              </Stack>
              <Divider />

              {/* Tabs */}
              <Box sx={{ width: '100%' }}>
                <Tabs
                  value={value}
                  sx={{
                    bgcolor: theme.palette.mode === 'dark' ? theme.palette.dark?.[800] || '#1a223f' : theme.palette.grey[50],
                    minHeight: 56,
                    borderBottom: `1px solid ${theme.palette.divider}`, // Add border
                    '& .MuiTabs-flexContainer': { height: '100%' }
                  }}
                  centered
                  onChange={handleChange}
                  aria-label="Theme customization tabs"
                >
                  <Tab label={<IconColorSwatch />} {...a11yProps(0)} sx={{ width: '50%' }} />
                  <Tab label={<IconTextSize />} {...a11yProps(1)} sx={{ width: '50%' }} />
                </Tabs>
              </Box>

              {/* Tab Panels */}
              <CustomTabPanel value={value} index={0}>
                <Grid container spacing={2.5}> {/* Use spacing prop */}
                  <Grid size={{ xs: 12 }}> {/* Use item and xs props */}
                    <ThemeModeLayout />
                    <Divider sx={{ mt: 2.5 }}/>
                  </Grid>
                  <Grid size={{ xs: 12 }}> 
                    <PresetColor />
                    <Divider sx={{ mt: 2.5 }}/>
                  </Grid>
                  <Grid size={{ xs: 12 }}> 
                    <InputFilled />
                    <Divider sx={{ mt: 2.5 }}/>
                  </Grid>
                  <Grid size={{ xs: 12 }}> 
                    <BoxContainer />
                    <Divider sx={{ mt: 2.5 }}/>
                  </Grid>
                  {/* --- Temporarily comment out unused sections --- */}
                  <Grid size={{ xs: 12 }}> 
                    <Layout />
                    <Divider sx={{ mt: 2.5 }}/>
                  </Grid> 
                  <Grid size={{ xs: 12 }}> 
                    <SidebarDrawer />
                    <Divider sx={{ mt: 2.5 }}/>
                  </Grid> 
                  <Grid size={{ xs: 12 }}> 
                    <MenuOrientation />
                    <Divider sx={{ mt: 2.5 }}/>
                  </Grid>
                   {/* --- End Temp Comment Out --- */}
                </Grid>
              </CustomTabPanel>
              <CustomTabPanel value={value} index={1}>
                <Grid container spacing={2}> {/* Use spacing */}
                  <Grid size={{ xs: 12 }}>  {/* Use item and xs */}
                    <FontFamily />
                    <Divider sx={{ mt: 2.5 }}/>
                  </Grid>
                  <Grid size={{ xs: 12 }}> 
                    <BorderRadius />
                    <Divider sx={{ mt: 2.5 }}/>
                  </Grid>
                </Grid>
              </CustomTabPanel>
            </MainCard>
          </SimpleBar>
        )}
      </Drawer>
    </>
  );
};

export default Customization;