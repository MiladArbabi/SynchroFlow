// packages/ui/src/themes/overrides/Tabs.ts
import { Theme } from '@mui/material/styles';
import { Components } from '@mui/material/styles';
import { withAlpha } from 'utils/colorUtils';

type TabsComponentConfig = Components<Theme>['MuiTabs'];

export default function Tabs(theme: Theme): TabsComponentConfig {
    const isDark = theme.palette.mode === 'dark';

    return {
        styleOverrides: {
            flexContainer: { // Target the flexContainer class key
                borderBottom: '1px solid',
                borderColor: isDark
                    ? withAlpha(theme.palette.text.primary || '#bdc8f0', 0.2)
                    : theme.palette.grey[200] || '#e3e8ef'
            }
        }
    };
}