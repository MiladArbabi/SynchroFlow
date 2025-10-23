// packages/ui/src/layout/Customization/BorderRadius.tsx
import React, { useContext } from 'react'; // Import React, useContext

// material-ui
import Grid from '@mui/material/Grid'; // Use v2 Grid
import Slider from '@mui/material/Slider';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import { useTheme, Theme } from '@mui/material/styles'; // Import Theme, useTheme
import { SxProps } from '@mui/system';


// project imports
import useConfig from 'hooks/useConfig'; // Use our hook
import { ConfigContext } from 'contexts/ConfigContext'; // Import context for dispatch

// Helper function for Slider label
function valueText(value: number): string {
  return `${value}px`;
}

// ==============================|| CUSTOMIZATION - BORDER RADIUS ||============================== //

const BorderRadius: React.FC = () => {
    const theme = useTheme(); // Get theme for styling
    const {
        state: { borderRadius }, // Read state from our context
        // setField // REMOVED
    } = useConfig();
    const { dispatch } = useContext(ConfigContext); // Get dispatch

    // Type the event handler (Slider onChange provides Event | number | number[])
    // We expect a number here based on the Slider props
    const handleChange = (_event: Event, newValue: number | number[]) => {
        // Ensure newValue is a number before dispatching
        const newBorderRadius = Array.isArray(newValue) ? newValue[0] : newValue;
        if (newBorderRadius !== borderRadius) {
            // setField('borderRadius', newBorderRadius); // REMOVED
            dispatch({ type: 'SET_BORDER_RADIUS', payload: newBorderRadius }); // Use dispatch
        }
    };

    // Define Slider SX
    const sliderSx: SxProps<Theme> = {
        // Style the value label popover
        '& .MuiSlider-valueLabel': {
            // Use standard theme access
            color: theme.palette.mode === 'dark'
                ? theme.palette.primary.dark // Dark mode label color
                : theme.palette.primary.light // Light mode label color
        },
         // Style track/thumb if needed
         // '& .MuiSlider-track': { ... }
         // '& .MuiSlider-thumb': { ... }
    };

    return (
        <Stack spacing={2.5} sx={{ p: 2, pr: 4 }}> {/* Adjust padding/spacing */}
            <Typography variant="h5">Border Radius</Typography>
            {/* Use Grid container for layout */}
            <Grid container spacing={1.25} alignItems="center" justifyContent="center">
                <Grid item> {/* Use item prop */}
                    <Typography variant="h6">4px</Typography>
                </Grid>
                {/* Use item prop with xs='auto' or flexible sizing */}
                <Grid item xs> {/* Use xs for flexible grow */}
                    <Slider
                        size="small"
                        value={borderRadius}
                        onChange={handleChange}
                        getAriaValueText={valueText} // Keep accessibility helper
                        valueLabelDisplay="auto" // Use 'auto' or 'on'
                        aria-labelledby="border-radius-slider" // Add accessible label ID
                        min={4}
                        max={24}
                        step={2} // Optional: Add step for discrete values
                        color="primary"
                        sx={sliderSx} // Apply SX
                    />
                </Grid>
                <Grid item> {/* Use item prop */}
                    <Typography variant="h6">24px</Typography>
                </Grid>
            </Grid>
        </Stack>
    );
};

export default BorderRadius; // Rename export if needed