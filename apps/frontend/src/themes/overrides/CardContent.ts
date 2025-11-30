// apps/frontend/src/themes/overrides/CardContent.ts
import { Theme } from '@mui/material/styles';
import { Components } from '@mui/material/styles';

// Type for the config entry
type CardContentComponentConfig = Components<Theme>['MuiCardContent'];

// ==============================|| OVERRIDES - CARD CONTENT ||============================== //

// No theme needed for this specific override, but keep signature consistent if desired
// export default function CardContent(theme: Theme): CardContentComponentConfig {
export default function CardContent(): CardContentComponentConfig { // Simpler signature
    return {
        styleOverrides: {
            root: {
                padding: '24px', // Keep padding override
                // Ensure last child doesn't have extra padding if needed
                '&:last-child': {
                     paddingBottom: '24px'
                }
            }
        }
    };
}