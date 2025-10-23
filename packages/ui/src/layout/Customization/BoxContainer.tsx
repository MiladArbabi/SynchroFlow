// packages/ui/src/layout/Customization/BoxContainer.tsx
import React, { useContext } from 'react'; // Import React, useContext

// material-ui
import CardMedia from '@mui/material/CardMedia';
import FormControlLabel from '@mui/material/FormControlLabel';
import Radio from '@mui/material/Radio';
import RadioGroup from '@mui/material/RadioGroup';
import Stack from '@mui/material/Stack';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import { useTheme, Theme } from '@mui/material/styles'; // Import Theme, useTheme
import { SxProps } from '@mui/system';


// project imports
import Avatar from 'ui-component/extended/Avatar'; // Use our converted Avatar
import useConfig from 'hooks/useConfig'; // Use our hook
import { ConfigContext } from 'contexts/ConfigContext'; // Import context for dispatch

// assets
// Use direct import for assets with Vite
import big from 'assets/images/customization/big.svg';
import small from 'assets/images/customization/small.svg';

// --- FIX: Convert to TypeScript Enum ---
enum ContainerType {
  CONTAINER = 'container',
  FLUID = 'fluid',
}
// --- END FIX ---


// ==============================|| CUSTOMIZATION - CONTAINER ||============================== //

const BoxContainer: React.FC = () => {
  const theme = useTheme(); // Get theme for styling
  const {
    state: { container }, // Read state from our context
    // setField // REMOVED
  } = useConfig();
  const { dispatch } = useContext(ConfigContext); // Get dispatch

  // Type the event handler
  const handleContainerChange = (event: React.ChangeEvent<HTMLInputElement>) => {
      const value = event.target.value;
      // Convert string value back to boolean for state
      const newContainerState = value === ContainerType.CONTAINER;
      if (newContainerState !== container) {
          // setField('container', newContainerState); // REMOVED
          dispatch({ type: 'SET_CONTAINER', payload: newContainerState }); // Use dispatch
      }
  };

   // Helper for Avatar SX - Fluid Option
   const fluidAvatarSx: SxProps<Theme> = {
       mr: 1.25,
       width: 48,
       height: 48,
       // Apply border based on selection state
       border: `2px solid ${!container ? theme.palette.primary.main : theme.palette.divider}`,
   };

    // Helper for Avatar SX - Container Option
    const containerAvatarSx: SxProps<Theme> = {
        width: 48,
        height: 48,
        // Apply border based on selection state
         border: `2px solid ${container ? theme.palette.primary.main : theme.palette.divider}`,
    };


  return (
    <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ p: 2 }}>
      <Typography variant="h5">Theme Width</Typography>
      <RadioGroup
        row
        aria-label="theme-width"
        // --- FIX: Map boolean state to enum string value ---
        value={container ? ContainerType.CONTAINER : ContainerType.FLUID}
        onChange={handleContainerChange}
        name="theme-width-radio-group"
        sx={{ gap: 1 }} // Add gap
      >
        {/* Fluid Option */}
        <Tooltip title="Fluid Layout (Full Width)" arrow>
          <FormControlLabel
            // --- FIX: Use Enum value ---
            control={<Radio value={ContainerType.FLUID} sx={{ display: 'none' }} />}
            label={
              <Avatar
                size="md"
                variant="rounded"
                outline // Use outline prop
                sx={fluidAvatarSx}
              >
                <CardMedia component="img" src={big} alt="Fluid layout icon" sx={{ width: 28, height: 28 }} />
              </Avatar>
            }
          />
        </Tooltip>

        {/* Container Option */}
        <Tooltip title="Boxed Layout" arrow>
          <FormControlLabel
            // --- FIX: Use Enum value ---
            control={<Radio value={ContainerType.CONTAINER} sx={{ display: 'none' }} />}
            label={
              <Avatar
                  size="md"
                  variant="rounded"
                  outline // Use outline prop
                  sx={containerAvatarSx}
               >
                <CardMedia component="img" src={small} alt="Boxed layout icon" sx={{ width: 16, height: 28 }} />
              </Avatar>
            }
          />
        </Tooltip>
      </RadioGroup>
    </Stack>
  );
};

export default BoxContainer;