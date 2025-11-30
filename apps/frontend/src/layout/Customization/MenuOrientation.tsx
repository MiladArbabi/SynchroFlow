// apps/frontend/src/layout/Customization/MenuOrientation.tsx
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
import { MenuOrientation } from 'config'; // Use our config enum
import Avatar from 'ui-component/extended/Avatar'; // Use our converted Avatar
import useConfig from 'hooks/useConfig'; // Use our hook
import { ConfigContext } from 'contexts/ConfigContext'; // Import context for dispatch

// assets
import vertical from 'assets/images/customization/vertical.svg'; // Use direct import
import horizontal from 'assets/images/customization/horizontal.svg'; // Use direct import

// ==============================|| CUSTOMIZATION - MENU ORIENTATION ||============================== //

const MenuOrientationPage: React.FC = () => { // Consider renaming export to MenuOrientation
    const theme = useTheme(); // Get theme for styling
    const {
        state: { menuOrientation }, // Read state from our context
        // setField // REMOVED
    } = useConfig();
    const { dispatch } = useContext(ConfigContext); // Get dispatch

    // Determine if horizontal is selected
    const isHorizontal = menuOrientation === MenuOrientation.HORIZONTAL;

    // Type the event handler
    const handleOrientationChange = (event: React.ChangeEvent<HTMLInputElement>) => {
        const newOrientation = event.target.value as MenuOrientation; // Cast value to enum
        if (newOrientation !== menuOrientation) {
            // setField('menuOrientation', newOrientation); // REMOVED
            dispatch({ type: 'SET_MENU_ORIENTATION', payload: newOrientation }); // Use dispatch
        }
    };

    // Helper for Avatar SX - Vertical Option
    const verticalAvatarSx: SxProps<Theme> = {
        mr: 1.25,
        width: 48,
        height: 48,
        // Apply border based on selection state
        border: `2px solid ${!isHorizontal ? theme.palette.primary.main : theme.palette.divider}`,
    };

    // Helper for Avatar SX - Horizontal Option
    const horizontalAvatarSx: SxProps<Theme> = {
        width: 48,
        height: 48,
         // Apply border based on selection state
        border: `2px solid ${isHorizontal ? theme.palette.primary.main : theme.palette.divider}`,
    };

    return (
        <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ p: 2 }}>
            <Typography variant="h5">Menu Orientation</Typography> {/* Updated Title */}
            <RadioGroup
                row
                aria-label="menu-orientation"
                value={menuOrientation} // Bind value directly to state
                onChange={handleOrientationChange}
                name="menu-orientation-radio-group"
                sx={{ gap: 1 }} // Add gap
            >
                {/* Vertical Option */}
                <Tooltip title="Vertical Menu Layout" arrow>
                    <FormControlLabel
                        control={<Radio value={MenuOrientation.VERTICAL} sx={{ display: 'none' }} />}
                        label={
                            <Avatar
                                size="md"
                                variant="rounded"
                                outline // Use outline prop
                                sx={verticalAvatarSx}
                            >
                                <CardMedia component="img" src={vertical} alt="Vertical menu layout icon" sx={{ width: 34, height: 34 }} />
                            </Avatar>
                        }
                    />
                </Tooltip>

                {/* Horizontal Option */}
                <Tooltip title="Horizontal Menu Layout" arrow>
                    <FormControlLabel
                        control={<Radio value={MenuOrientation.HORIZONTAL} sx={{ display: 'none' }} />}
                        label={
                            <Avatar
                                size="md"
                                variant="rounded"
                                outline // Use outline prop
                                sx={horizontalAvatarSx}
                            >
                                <CardMedia component="img" src={horizontal} alt="Horizontal menu layout icon" sx={{ width: 34, height: 34 }} />
                            </Avatar>
                        }
                    />
                </Tooltip>
            </RadioGroup>
        </Stack>
    );
};

// Consider renaming default export if file is MenuOrientation.tsx
export default MenuOrientationPage;