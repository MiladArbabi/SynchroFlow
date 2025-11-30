// apps/frontend/src/themes/overrides/ListItemButton.ts
import { Theme } from '@mui/material/styles';
import { Components } from '@mui/material/styles';
import { withAlpha } from 'utils/colorUtils'; // Ensure typed later

// Type for the config entry
type ListItemButtonComponentConfig = Components<Theme>['MuiListItemButton'];

// ==============================|| OVERRIDES - LIST ITEM BUTTON ||============================== //

export default function ListItemButton(theme: Theme): ListItemButtonComponentConfig {
    const isDark = theme.palette.mode === 'dark';

    return {
        styleOverrides: {
            root: {
                color: theme.palette.text.primary,
                paddingTop: '10px', // Keep padding overrides
                paddingBottom: '10px',

                '&.Mui-selected': {
                    color: isDark ? theme.palette.secondary.main : theme.palette.secondary.dark,
                    backgroundColor: isDark
                        ? withAlpha(theme.palette.secondary.main, 0.15)
                        : theme.palette.secondary.light,
                    '&:hover': {
                        backgroundColor: isDark
                            ? withAlpha(theme.palette.secondary.main, 0.15) // Keep same on hover when selected
                            : theme.palette.secondary.light,
                    },
                    // Target nested ListItemIcon within selected button
                    '& .MuiListItemIcon-root': {
                        color: isDark ? theme.palette.secondary.main : theme.palette.secondary.dark,
                    }
                },

                '&:hover': {
                     // Apply hover styles only if NOT selected
                     // Note: This might conflict with selected hover style depending on CSS specificity.
                     // Consider adjusting selectors if needed.
                    color: isDark ? theme.palette.secondary.main : theme.palette.secondary.dark,
                    backgroundColor: isDark
                        ? withAlpha(theme.palette.secondary.main, 0.15)
                        : theme.palette.secondary.light,
                    '& .MuiListItemIcon-root': {
                        color: isDark ? theme.palette.secondary.main : theme.palette.secondary.dark,
                    }
                }
            }
            // Add overrides for specific class keys like 'dense' if needed
        }
    };
}