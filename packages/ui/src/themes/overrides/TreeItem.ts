/* eslint-disable @typescript-eslint/no-explicit-any */
// packages/ui/src/themes/overrides/TreeItem.ts
import { Theme } from '@mui/material/styles';
import { Components } from '@mui/material/styles';
// Import TreeItem specific types if needed after installing @mui/lab
// import { TreeItemProps } from '@mui/lab/TreeItem';

// Use a specific type if augmented, otherwise 'any' or check MUI Lab types
type TreeItemComponentConfig = Components<Theme>['MuiTreeItem'] | any;

// ==============================|| OVERRIDES - TREE ITEM ||============================== //

export default function TreeItem(): TreeItemComponentConfig {
    return {
        // Target the MuiTreeItem component key
        MuiTreeItem: {
            styleOverrides: {
                // Target the 'label' class key (the text content)
                label: {
                    marginTop: 14, // Keep margin overrides (consider using theme.spacing if preferred)
                    marginBottom: 14,
                    // Example: Adjust font size
                    // fontSize: '0.875rem',
                },
                // Add overrides for 'root', 'content', 'iconContainer', 'group' if needed
                // content: {
                //    padding: '...',
                // }
            }
        }
    };
}