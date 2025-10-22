/* eslint-disable @typescript-eslint/no-explicit-any */
// packages/ui/src/themes/overrides/TreeItem.ts
import { Theme } from '@mui/material/styles';
import { Components } from '@mui/material/styles';

// Use specific type if augmented in mui.d.ts, otherwise 'any'
type TreeItemComponentConfig = Components<Theme>['MuiTreeItem'] | any;

// ==============================|| OVERRIDES - TREE ITEM ||============================== //

export default function TreeItem(): TreeItemComponentConfig {
    return {
        MuiTreeItem: { // Ensure the component key is present
            styleOverrides: {
                // Target the 'label' class key
                label: {
                    marginTop: 14, // Consider theme.spacing(1.75)?
                    marginBottom: 14,
                }
                // Add overrides for 'root', 'content', 'iconContainer', 'group' if needed
            }
        }
    };
}