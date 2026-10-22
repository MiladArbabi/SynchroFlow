// apps/frontend/src/themes/overrides/Tabs.ts
import { Theme } from '@mui/material/styles';
import { Components } from '@mui/material/styles';

type TabsComponentConfig = Components<Theme>['MuiTabs'];

// CSS vars (themes/tokens.ts) so both colour schemes resolve.
export default function Tabs(): TabsComponentConfig {

    return {
        styleOverrides: {
            flexContainer: { // Target the flexContainer class key
                borderBottom: '1px solid',
                borderColor: 'var(--rule)'
            }
        }
    };
}