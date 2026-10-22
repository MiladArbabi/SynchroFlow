// apps/frontend/src/themes/overrides/ListItemButton.ts
import { Theme } from '@mui/material/styles';
import { Components } from '@mui/material/styles';

// Type for the config entry
type ListItemButtonComponentConfig = Components<Theme>['MuiListItemButton'];

// ==============================|| OVERRIDES - LIST ITEM BUTTON ||============================== //

export default function ListItemButton(): ListItemButtonComponentConfig {
    // CSS vars (themes/tokens.ts) so both colour schemes resolve correctly —
    // overrides are built once, so palette.mode branches never see dark.
    return {
        styleOverrides: {
            root: {
                color: 'var(--ink)',
                paddingTop: '10px',
                paddingBottom: '10px',

                '&.Mui-selected': {
                    color: 'var(--accent-text)',
                    backgroundColor: 'var(--accent-ghost)',
                    '&:hover': { backgroundColor: 'var(--accent-ghost)' },
                    '& .MuiListItemIcon-root': { color: 'var(--accent-text)' },
                },

                '&:hover': {
                    backgroundColor: 'var(--bg-2)',
                },
            },
        },
    };
}