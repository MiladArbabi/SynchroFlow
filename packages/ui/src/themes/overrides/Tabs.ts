// packages/ui/src/themes/overrides/Tabs.ts
import { Theme } from '@mui/material/styles';
import { Components } from '@mui/material/styles';
import { withAlpha } from 'utils/colorUtils'; // Ensure typed later

// Type for the config entry
type TabsComponentConfig = Components<Theme>['MuiTabs'];

// ==============================|| OVERRIDES - TABS ||============================== //

export default function Tabs(theme: Theme): TabsComponentConfig {
    const isDark = theme.palette.mode === 'dark';

    return {
        styleOverrides: {
            // Target the flexContainer class key (the container for Tab items)
            flexContainer: {
                borderBottom: '1px solid',
                borderColor: isDark
                    ? withAlpha(theme.palette.text.primary || '#bdc8f0', 0.2) // Dark mode border
                    : theme.palette.grey[200] || '#e3e8ef' // Light mode border
            }
            // Add overrides for 'root', 'indicator', 'scrollButtons' etc. if needed
        }
    };
}