/* eslint-disable @typescript-eslint/no-unused-vars */
// packages/ui/src/layout/Customization/InputFilled.tsx
import React, { useContext } from 'react'; // Import React, useContext

// material-ui
import { useColorScheme, useTheme, Theme } from '@mui/material/styles'; // Import Theme
import FormControlLabel from '@mui/material/FormControlLabel';
import Radio from '@mui/material/Radio';
import RadioGroup from '@mui/material/RadioGroup';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import Tooltip from '@mui/material/Tooltip';
import { SxProps } from '@mui/system';


// project imports
import { ThemeMode } from 'config'; // Use our config
import Avatar from 'ui-component/extended/Avatar'; // Use our converted Avatar
import useConfig from 'hooks/useConfig'; // Use our hook
import { ConfigContext } from 'contexts/ConfigContext'; // Import context for dispatch

// ==============================|| CUSTOMIZATION - INPUT FILLED ||============================== //

const InputFilled: React.FC = () => {
  const theme = useTheme(); // Get theme for styling
  const { colorScheme } = useColorScheme(); // Read light/dark mode if needed (though theme.palette.mode is often simpler)
  const {
    state: { outlinedFilled }, // Read state from our context
    // setField // REMOVED
  } = useConfig();
  const { dispatch } = useContext(ConfigContext); // Get dispatch

  // Type the event handler
  const changeInputBackground = (event: React.ChangeEvent<HTMLInputElement>) => {
    const value = event.target.value;
    // Determine the boolean value based on the radio button's value string
    const newOutlinedFilled = value === 'filled';
    if (newOutlinedFilled !== outlinedFilled) {
      // setField('outlinedFilled', newOutlinedFilled); // REMOVED
      dispatch({ type: 'SET_OUTLINED_FILLED', payload: newOutlinedFilled }); // Use dispatch
    }
  };

  // Helper for Avatar SX - Filled Option
  const filledAvatarSx: SxProps<Theme> = {
      mr: 1,
      width: 48,
      height: 30, // Make it rectangular
      // Use standard theme access with fallbacks
      bgcolor: theme.palette.mode === ThemeMode.DARK
          ? theme.palette.dark?.[800] || '#1a223f'
          : theme.palette.grey[50] || '#f8fafc',
      // Apply border based on *selection* state (opposite of outlinedFilled)
      border: `2px solid ${outlinedFilled ? theme.palette.primary.main : theme.palette.divider}`,
      // Remove outline prop if not needed, border handles it
  };

   // Helper for Avatar SX - Outlined Option
   const outlinedAvatarSx: SxProps<Theme> = {
       width: 48,
       height: 30, // Make it rectangular
       bgcolor: 'transparent', // Explicitly transparent
        // Apply border based on *selection* state
       border: `2px solid ${!outlinedFilled ? theme.palette.primary.main : theme.palette.divider}`,
   };


  return (
    // Use Stack for layout
    <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ p: 2 }}>
      <Typography variant="h5">Input Background</Typography>
      <RadioGroup
          row
          aria-label="input-background"
          // --- FIX: Value should be string 'filled' or 'outlined' ---
          value={outlinedFilled ? 'filled' : 'outlined'} // Map boolean state to string value
          onChange={changeInputBackground}
          name="input-background-radio-group"
          sx={{ gap: 1 }} // Add gap
      >
        {/* Filled Option */}
        <Tooltip title="Background Filled" arrow>
          <FormControlLabel
            // --- FIX: Value should be 'filled' ---
            control={<Radio value="filled" sx={{ display: 'none' }} />}
            label={
              <Avatar variant="rounded" size="badge" sx={filledAvatarSx}> {/* Adjust size if needed */}
                {' '} {/* Empty content */}
              </Avatar>
            }
          />
        </Tooltip>

        {/* Outlined Option */}
        <Tooltip title="Background Outlined" arrow>
          <FormControlLabel
             // --- FIX: Value should be 'outlined' ---
            control={<Radio value="outlined" sx={{ display: 'none' }} />}
            label={
              // Use outline prop on Avatar
              <Avatar variant="rounded" size="badge" outline sx={outlinedAvatarSx}> {/* Adjust size */}
                {' '} {/* Empty content */}
              </Avatar>
            }
          />
        </Tooltip>
      </RadioGroup>
    </Stack>
  );
};

export default InputFilled;