// packages/ui/src/layout/Customization/ThemeMode.tsx
import React from 'react'; // Import React

// material-ui
import { useColorScheme, Theme } from '@mui/material/styles'; // Import Theme
import FormControlLabel from '@mui/material/FormControlLabel';
import Radio from '@mui/material/Radio';
import RadioGroup from '@mui/material/RadioGroup';
import Stack from '@mui/material/Stack';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import { SxProps } from '@mui/system';


// project imports
import { ThemeMode } from 'config'; // Use our config
// --- FIX: Use our converted Avatar ---
import Avatar from 'ui-component/extended/Avatar'; // Adjusted import path

// assets
import { IconCpu, IconMoon, IconSun } from '@tabler/icons-react';

// ==============================|| CUSTOMIZATION - MODE ||============================== //

const ThemeModeLayout: React.FC = () => {
  // Use MUI's useColorScheme for managing light/dark/system
  const { mode, setMode } = useColorScheme();

  // Type the event handler
  const handleModeChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    setMode(event.target.value as 'light' | 'dark' | 'system'); // Cast value
  };

  // Helper function for Avatar SX
  const getAvatarSx = (targetMode: ThemeMode): SxProps<Theme> => ({
      width: 48,
      height: 48,
      mr: 1, // Add margin right for spacing
      // Border indicates selection
      border: '2px solid',
      borderColor: mode === targetMode ? 'primary.main' : 'divider',
      // Specific styles based on mode
      ...(targetMode === ThemeMode.DARK && {
          color: 'grey.100', // Text/Icon color for dark avatar
          bgcolor: 'dark.main', // Background for dark avatar
      }),
      ...(targetMode === ThemeMode.LIGHT && {
          color: 'warning.dark', // Icon color for light avatar
          bgcolor: 'background.paper', // Use paper background for light
      }),
      ...(targetMode === ThemeMode.SYSTEM && {
           color: 'text.secondary', // Icon color for system avatar
           bgcolor: 'background.paper', // Use paper background
      }),
      // Add hover effect if desired
      '&:hover': {
         borderColor: 'primary.light'
      }
  });


  return (
    // Use Stack for layout, adjust padding as needed within CustomTabPanel
    <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ p: 1 }}>
      <Typography variant="h5">Theme Mode</Typography>
      <RadioGroup
          row
          aria-label="theme-mode"
          value={mode}
          onChange={handleModeChange}
          name="theme-mode-radio-group" // Add name
          sx={{ gap: 1 }} // Add gap between radio buttons
       >
        {/* Light Mode */}
        <Tooltip title="Light Mode" arrow>
          <FormControlLabel
            // Use `control` prop for the Radio button
            control={<Radio value={ThemeMode.LIGHT} sx={{ display: 'none' }} />}
            // `label` prop receives the Avatar
            label={
              <Avatar variant="rounded" sx={getAvatarSx(ThemeMode.LIGHT)}>
                <IconSun size="1.5rem"/>
              </Avatar>
            }
            // Label placement (optional)
            // labelPlacement="bottom"
          />
        </Tooltip>

        {/* Dark Mode */}
        <Tooltip title="Dark Mode" arrow>
          <FormControlLabel
            control={<Radio value={ThemeMode.DARK} sx={{ display: 'none' }} />}
            label={
              <Avatar variant="rounded" sx={getAvatarSx(ThemeMode.DARK)}>
                <IconMoon size="1.5rem" style={{ transform: 'rotate(220deg)' }} />
              </Avatar>
            }
          />
        </Tooltip>

         {/* System Mode */}
         <Tooltip title="System Mode" arrow>
           <FormControlLabel
             control={<Radio value={ThemeMode.SYSTEM} sx={{ display: 'none' }} />}
             label={
               <Avatar variant="rounded" sx={getAvatarSx(ThemeMode.SYSTEM)}>
                 <IconCpu size="1.5rem"/>
               </Avatar>
             }
           />
         </Tooltip>
      </RadioGroup>
    </Stack>
  );
};

export default ThemeModeLayout;