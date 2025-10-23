// packages/ui/src/layout/Customization/SidebarDrawer.tsx
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
import mini from 'assets/images/customization/mini.svg'; // Use direct import
import max from 'assets/images/customization/max.svg'; // Use direct import

// --- FIX: Convert to TypeScript Enum ---
enum DrawerType {
  MINI = 'mini',
  DEFAULT = 'default',
}
// --- END FIX ---


// ==============================|| CUSTOMIZATION - SIDEBAR DRAWER ||============================== //

const SidebarDrawer: React.FC = () => {
    const theme = useTheme(); // Get theme for styling
    const {
        state: { miniDrawer }, // Read state from our context
        // setField // REMOVED
    } = useConfig();
    const { dispatch } = useContext(ConfigContext); // Get dispatch

    // Type the event handler
    const handleDrawerChange = (event: React.ChangeEvent<HTMLInputElement>) => {
        const value = event.target.value;
        // Convert string value back to boolean for state
        const newMiniDrawerState = value === DrawerType.MINI;
        if (newMiniDrawerState !== miniDrawer) {
            // setField('miniDrawer', newMiniDrawerState); // REMOVED
            dispatch({ type: 'SET_MINI_DRAWER', payload: newMiniDrawerState }); // Use dispatch
        }
    };

    // Helper for Avatar SX - Mini Option
    const miniAvatarSx: SxProps<Theme> = {
        mr: 1.25,
        width: 48,
        height: 48,
        // Apply border based on selection state
        border: `2px solid ${miniDrawer ? theme.palette.primary.main : theme.palette.divider}`,
    };

    // Helper for Avatar SX - Default/Max Option
    const defaultAvatarSx: SxProps<Theme> = {
        width: 48,
        height: 48,
         // Apply border based on selection state
        border: `2px solid ${!miniDrawer ? theme.palette.primary.main : theme.palette.divider}`,
    };

    return (
        <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ p: 2 }}>
            <Typography variant="h5">Sidebar Drawer</Typography> {/* Updated Title */}
            <RadioGroup
                row
                aria-label="sidebar-drawer-style"
                // --- FIX: Map boolean state to enum string value ---
                value={miniDrawer ? DrawerType.MINI : DrawerType.DEFAULT}
                onChange={handleDrawerChange}
                name="sidebar-drawer-radio-group"
                sx={{ gap: 1 }} // Add gap
            >
                {/* Mini Option */}
                <Tooltip title="Mini Drawer (Collapsed Sidebar)" arrow>
                    <FormControlLabel
                        // --- FIX: Use Enum value ---
                        control={<Radio value={DrawerType.MINI} sx={{ display: 'none' }} />}
                        label={
                            <Avatar
                                size="md"
                                variant="rounded"
                                outline // Use outline prop
                                sx={miniAvatarSx}
                            >
                                <CardMedia component="img" src={mini} alt="Mini drawer layout icon" sx={{ width: 34, height: 34 }} />
                            </Avatar>
                        }
                    />
                </Tooltip>

                {/* Default/Max Option */}
                <Tooltip title="Default Drawer (Expanded Sidebar)" arrow>
                    <FormControlLabel
                        // --- FIX: Use Enum value ---
                        control={<Radio value={DrawerType.DEFAULT} sx={{ display: 'none' }} />}
                        label={
                            <Avatar
                                size="md"
                                variant="rounded"
                                outline // Use outline prop
                                sx={defaultAvatarSx}
                            >
                                <CardMedia component="img" src={max} alt="Default drawer layout icon" sx={{ width: 34, height: 34 }} />
                            </Avatar>
                        }
                    />
                </Tooltip>
            </RadioGroup>
        </Stack>
    );
};

export default SidebarDrawer;