/* eslint-disable @typescript-eslint/no-unused-vars */
// packages/ui/src/themes/overrides/Alert.ts
import { Theme } from '@mui/material/styles';
import { ComponentsOverrides, Components } from '@mui/material';
import { AlertProps } from '@mui/material/Alert';
import { withAlpha } from 'utils/colorUtils';

// assets
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined';
import React from 'react'; // Import React for JSX

// Define the component override object structure for merging
// Type for the entire MuiAlert entry in the components object
type AlertComponentConfig = Components<Theme>['MuiAlert'];

// Helper type for ownerState within variant styles
type AlertOwnerState = { ownerState: AlertProps };

// ==============================|| OVERRIDES - ALERT ||============================== //

export default function Alert(theme: Theme): AlertComponentConfig { // Return the broader config type

    const getPaletteColor = (severity: AlertProps['severity']) => {
        switch (severity) {
            case 'error': return theme.palette.error;
            case 'warning': return theme.palette.warning;
            case 'success': return theme.palette.success;
            case 'info':
            default: return theme.palette.info;
        }
    };

    const standardVariant = ({ ownerState }: AlertOwnerState) => {
        const paletteColor = getPaletteColor(ownerState.severity);
        const isWarningOrSuccess = ownerState.severity === 'warning' || ownerState.severity === 'success';
        return {
            color: isWarningOrSuccess ? paletteColor.dark : paletteColor.main,
            backgroundColor: withAlpha(paletteColor.main || theme.palette.info.main, 0.075),
            '& .MuiAlert-icon': {
                color: isWarningOrSuccess ? paletteColor.dark : paletteColor.main
            }
        };
    };

    const outlinedVariant = ({ ownerState }: AlertOwnerState) => {
        const paletteColor = getPaletteColor(ownerState.severity);
        const isWarningOrSuccess = ownerState.severity === 'warning' || ownerState.severity === 'success';
        return {
            color: isWarningOrSuccess ? paletteColor.dark : paletteColor.main,
            borderColor: paletteColor.dark || paletteColor.main,
            '& .MuiAlert-icon': {
                color: isWarningOrSuccess ? paletteColor.dark : paletteColor.main
            }
        };
    };

    const filledVariant = ({ ownerState }: AlertOwnerState) => {
        const paletteColor = getPaletteColor(ownerState.severity);
        const isWarningOrSuccess = ownerState.severity === 'warning' || ownerState.severity === 'success';
        return {
            color: isWarningOrSuccess ? theme.palette.common.black : theme.palette.common.white,
            backgroundColor: isWarningOrSuccess ? paletteColor.dark : paletteColor.main,
            '& .MuiAlert-icon': {
                color: isWarningOrSuccess ? theme.palette.common.black : theme.palette.common.white
            }
        };
    };

    // --- FIX: Return object matching Components<Theme>['MuiAlert'] structure ---
    return {
        // defaultProps is a sibling to styleOverrides
        defaultProps: {
            iconMapping: {
                // Use React.createElement instead of JSX in .ts file
                info: React.createElement(InfoOutlinedIcon, { sx: { fontSize: 'inherit' } })
            }
        },
        styleOverrides: {
            // styleOverrides maps class keys or uses a function for root
            root: ({ ownerState }: AlertOwnerState) => ({
                alignItems: 'center',
                // Apply variant styles conditionally
                ...(ownerState.variant === 'standard' && standardVariant({ ownerState })),
                ...(ownerState.variant === 'outlined' && outlinedVariant({ ownerState })),
                ...(ownerState.variant === 'filled' && filledVariant({ ownerState })),
            }),
            outlined: { // Specific class key override
                borderWidth: '1px',
                borderStyle: 'dashed',
            }
            // Add other class key overrides (e.g., 'message', 'icon') here if needed
        }
        // The 'variants' array can also be used here as a sibling to styleOverrides if preferred
        /*
        variants: [
             { props: { variant: 'standard' }, style: standardVariant },
             { props: { variant: 'outlined' }, style: outlinedVariant },
             { props: { variant: 'filled' }, style: filledVariant }
        ]
        */
    };
}