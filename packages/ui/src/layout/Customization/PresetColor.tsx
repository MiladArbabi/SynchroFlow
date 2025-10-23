/* eslint-disable @typescript-eslint/no-unused-vars */
// packages/ui/src/layout/Customization/PresetColor.tsx
import React, { useContext } from 'react';

// material-ui
import { useColorScheme, useTheme, Theme } from '@mui/material/styles';
import Grid from '@mui/material/Grid'; // Use v2 Grid
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import { SxProps } from '@mui/system';


// project imports
import { ThemeMode } from 'config'; // Use our config
import Avatar from 'ui-component/extended/Avatar'; // Use our converted Avatar
import useConfig from 'hooks/useConfig'; // Use our hook
import { ConfigContext } from 'contexts/ConfigContext'; // Import context for dispatch

// --- FIX: Import colors from presetColors.ts ---
import { presetColorOptions } from 'themes/presetColors'; // Use our TS color definitions

// assets
import { IconCheck } from '@tabler/icons-react';

// Define ColorOption type based on ColorSet from presetColors.ts (simplified for swatch)
interface ColorOption {
  id: string;
  primary: string; // light mode primary for swatch
  secondary: string; // light mode secondary for swatch
  primaryDarkSwatch: string; // <-- FIX: Use correct property name
  secondaryDarkSwatch: string; // dark mode secondary for swatch
}

// Define Props for PresetColorBox
interface PresetColorBoxProps {
    color: ColorOption;
    presetColorId: string; // Use ID for clarity
    setPresetColorId: (id: string) => void; // Function accepts ID
}

// Internal PresetColorBox component
const PresetColorBox: React.FC<PresetColorBoxProps> = ({ color, presetColorId, setPresetColorId }) => {
    const theme = useTheme(); // Get theme for mode check
    const isSelected = presetColorId === color.id;

    // Determine swatch colors based on current theme mode
    const swatchPrimary = theme.palette.mode === ThemeMode.DARK ? color.primaryDarkSwatch : color.primary;
    const swatchSecondary = theme.palette.mode === ThemeMode.DARK ? color.secondaryDarkSwatch : color.secondary;

    // Define Avatar SX
    const avatarSx: SxProps<Theme> = {
        width: 48,
        height: 48,
        background: `linear-gradient(135deg, ${swatchPrimary} 50%, ${swatchSecondary} 50%)`,
        opacity: isSelected ? 0.6 : 1,
        cursor: 'pointer',
        border: `2px solid ${isSelected ? theme.palette.primary.main : 'transparent'}`,
        '&:hover': {
            opacity: 0.8
        }
    };

    return (
        // Use Grid item prop if needed, or just let container handle spacing
        <Grid> {/* Keep item prop for spacing */}
            <Avatar
                // color="inherit" // Removed, color is handled by background
                title={color.id}
                size="md" // Use standard size prop
                variant="rounded" // Make it rounded square
                sx={avatarSx}
                onClick={() => setPresetColorId(color.id)} // Pass ID back
            >
                {/* Render check icon if selected */}
                {isSelected && <IconCheck color={theme.palette.common.white} size={28} />}
            </Avatar>
        </Grid>
    );
}

// ==============================|| CUSTOMIZATION - PRESET COLOR ||============================== //

const PresetColor: React.FC = () => {
  // Read light/dark mode using MUI hook (needed for swatch display)
  const { mode: colorScheme } = useColorScheme(); // Alias mode to colorScheme if needed, or use mode directly
  const {
    state: { presetColor }, // Read currently selected preset ID from our context
    // setField // REMOVED
  } = useConfig();
  const { dispatch } = useContext(ConfigContext); // Get dispatch

  // Map presetColorOptions from TS file to simplified ColorOption for swatches
  const colorOptions: ColorOption[] = presetColorOptions.map(p => ({
        id: p.id,
        primary: p.primaryMain,
        secondary: p.secondaryMain,
        primaryDarkSwatch: p.darkPrimaryMain, // <-- FIX: Use correct property name
        secondaryDarkSwatch: p.darkSecondaryMain,
  }));


  // Handler uses dispatch
  const handlePresetColorChange = (newPresetColorId: string) => {
      dispatch({ type: 'SET_PRESET_COLOR', payload: newPresetColorId });
  };

  return (
    <Stack spacing={1} sx={{ px: 2, pb: 2 }}> {/* Use spacing and adjust padding */}
      <Typography variant="h5">Preset Color</Typography>
      <Grid container spacing={1.5} alignItems="center"> {/* Use Grid container */}
        {colorOptions.map((color) => (
          <PresetColorBox
            key={color.id} // Use ID as key
            color={color}
            presetColorId={presetColor} // Pass current ID
            setPresetColorId={handlePresetColorChange} // Pass handler
          />
        ))}
      </Grid>
    </Stack>
  );
};

export default PresetColor; // Export the main component