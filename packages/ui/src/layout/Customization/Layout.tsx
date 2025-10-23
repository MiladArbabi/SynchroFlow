// packages/ui/src/layout/Customization/Layout.tsx
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
import { ThemeDirection } from 'config'; // Use our config enum
import Avatar from 'ui-component/extended/Avatar'; // Use our converted Avatar
import useConfig from 'hooks/useConfig'; // Use our hook
import { ConfigContext } from 'contexts/ConfigContext'; // Import context for dispatch

// assets
import ltr from 'assets/images/customization/ltr.svg'; // Use direct import
import rtl from 'assets/images/customization/rtl.svg'; // Use direct import

// ==============================|| CUSTOMIZATION - LAYOUT ||============================== //

const Layout: React.FC = () => {
    const theme = useTheme(); // Get theme for styling
    const {
        state: { themeDirection }, // Read state from our context
        // setField // REMOVED
    } = useConfig();
    const { dispatch } = useContext(ConfigContext); // Get dispatch

    // Type the event handler
    const changeLayout = (event: React.ChangeEvent<HTMLInputElement>) => {
        const newDirection = event.target.value as ThemeDirection; // Cast value to enum
        if (newDirection !== themeDirection) {
            // setField('themeDirection', newDirection); // REMOVED
            dispatch({ type: 'SET_THEME_DIRECTION', payload: newDirection }); // Use dispatch
        }
    };

    // Helper for Avatar SX - LTR Option
    const ltrAvatarSx: SxProps<Theme> = {
        mr: 1.25,
        width: 48,
        height: 48,
        // Apply border based on selection state
        border: `2px solid ${themeDirection === ThemeDirection.LTR ? theme.palette.primary.main : theme.palette.divider}`,
    };

    // Helper for Avatar SX - RTL Option
    const rtlAvatarSx: SxProps<Theme> = {
        width: 48,
        height: 48,
         // Apply border based on selection state
        border: `2px solid ${themeDirection === ThemeDirection.RTL ? theme.palette.primary.main : theme.palette.divider}`,
    };

    return (
        <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ p: 2 }}>
            <Typography variant="h5">Layout Direction</Typography> {/* Updated Title */}
            <RadioGroup
                row
                aria-label="layout-direction"
                value={themeDirection} // Bind value directly to state
                onChange={changeLayout}
                name="layout-direction-radio-group"
                sx={{ gap: 1 }} // Add gap
            >
                {/* LTR Option */}
                <Tooltip title="Left-to-Right Layout" arrow>
                    <FormControlLabel
                        control={<Radio value={ThemeDirection.LTR} sx={{ display: 'none' }} />}
                        label={
                            <Avatar
                                size="md"
                                variant="rounded"
                                outline // Use outline prop
                                sx={ltrAvatarSx}
                            >
                                <CardMedia component="img" src={ltr} alt="LTR layout icon" sx={{ width: 34, height: 34 }} />
                            </Avatar>
                        }
                    />
                </Tooltip>

                {/* RTL Option */}
                <Tooltip title="Right-to-Left Layout" arrow>
                    <FormControlLabel
                        control={<Radio value={ThemeDirection.RTL} sx={{ display: 'none' }} />}
                        label={
                            <Avatar
                                size="md"
                                variant="rounded"
                                outline // Use outline prop
                                sx={rtlAvatarSx}
                            >
                                <CardMedia component="img" src={rtl} alt="RTL layout icon" sx={{ width: 34, height: 34 }} />
                            </Avatar>
                        }
                    />
                </Tooltip>
            </RadioGroup>
        </Stack>
    );
};

export default Layout;