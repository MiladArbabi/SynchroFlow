// packages/ui/src/layout/Customization/FontFamily.tsx
import React, { useContext } from 'react'; // Import React, useContext

// material-ui
import FormControlLabel from '@mui/material/FormControlLabel';
import Grid from '@mui/material/Grid'; // Use v2 Grid
import Radio from '@mui/material/Radio';
import RadioGroup from '@mui/material/RadioGroup';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import { useTheme, Theme } from '@mui/material/styles'; // Import Theme, useTheme
import { SxProps } from '@mui/system';


// project imports
import useConfig from 'hooks/useConfig'; // Use our hook
import { ConfigContext } from 'contexts/ConfigContext'; // Import context for dispatch
import MainCard from 'ui-component/cards/MainCard'; // Use our converted MainCard

// Define font options structure
interface FontOption {
    id: string;
    value: string; // CSS font-family string
    label: string; // Display name
}

// Define available fonts
const fonts: FontOption[] = [
    { id: 'inter', value: `'Inter', sans-serif`, label: 'Inter' },
    { id: 'poppins', value: `'Poppins', sans-serif`, label: 'Poppins' },
    { id: 'roboto', value: `'Roboto', sans-serif`, label: 'Roboto' }
];

// ==============================|| CUSTOMIZATION - FONT FAMILY ||============================== //

const FontFamily: React.FC = () => {
    const theme = useTheme(); // Get theme for styling
    const {
        state: { fontFamily }, // Read state from our context
        // setField // REMOVED
    } = useConfig();
    const { dispatch } = useContext(ConfigContext); // Get dispatch

    // Type the event handler
    const handleFontChange = (event: React.ChangeEvent<HTMLInputElement>) => {
        const newFontFamily = event.target.value;
        if (newFontFamily !== fontFamily) {
            // setField('fontFamily', newFontFamily); // REMOVED
            dispatch({ type: 'SET_FONT_FAMILY', payload: newFontFamily }); // Use dispatch
        }
    };

    // Helper function for outer MainCard SX
    const getOuterCardSx = (itemValue: string): SxProps<Theme> => ({
        p: 0.75, // Keep padding
        cursor: 'pointer', // Indicate clickable
        bgcolor: fontFamily === itemValue
            ? (theme.palette.mode === 'dark' ? theme.palette.primary[800] || '#1565c0' : theme.palette.primary.light)
            : (theme.palette.mode === 'dark' ? theme.palette.dark?.[800] || '#1a223f' : theme.palette.grey[50]), // Background based on selection and mode
        '&:hover': { // Add hover effect
             bgcolor: fontFamily === itemValue
                ? (theme.palette.mode === 'dark' ? theme.palette.primary[700] : theme.palette.primary[200]) // Darken selected slightly
                : (theme.palette.mode === 'dark' ? theme.palette.grey[700] : theme.palette.grey[100]), // Lighten unselected slightly
        }
    });

    // Helper function for inner MainCard SX
     const getInnerCardSx = (itemValue: string): SxProps<Theme> => ({
        p: 1.75,
        borderWidth: 1, // Keep border width
        // Border color based on selection
        borderColor: fontFamily === itemValue ? theme.palette.primary.main : 'transparent', // Use transparent border when not selected
    });


    return (
        <Stack spacing={2.5} sx={{ p: 2 }}> {/* Adjust spacing/padding */}
            <Typography variant="h5">Font Style</Typography>
            <RadioGroup
                aria-label="font-family"
                name="font-family-radio-group"
                value={fontFamily} // Bind value to state
                onChange={handleFontChange}
            >
                <Grid container spacing={1.25}> {/* Use container spacing */}
                    {fonts.map((item) => ( // Use item.id as key
                        <Grid size={{ xs: 1}}  key={item.id}> {/* Use item prop and xs */}
                            <MainCard
                                content={false}
                                sx={getOuterCardSx(item.value)}
                            >
                                <MainCard
                                    content={false}
                                    border // Use border prop
                                    sx={getInnerCardSx(item.value)}
                                >
                                    <FormControlLabel
                                        sx={{ width: 1, m: 0 }} // Ensure full width, remove margin
                                        control={<Radio value={item.value} sx={{ display: 'none' }} />}
                                        label={
                                            <Typography variant="h5" sx={{ pl: 1, fontFamily: item.value }}> {/* Adjust padding */}
                                                {item.label}
                                            </Typography>
                                        }
                                    />
                                </MainCard>
                            </MainCard>
                        </Grid>
                    ))}
                </Grid>
            </RadioGroup>
        </Stack>
    );
};

export default FontFamily; // Rename export if needed