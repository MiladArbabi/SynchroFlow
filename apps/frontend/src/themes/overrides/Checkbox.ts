// apps/frontend/src/themes/overrides/Checkbox.ts
import { Theme } from '@mui/material/styles';
import { Components } from '@mui/material/styles';

// Type for the config entry
type CheckboxComponentConfig = Components<Theme>['MuiCheckbox'];

// ==============================|| OVERRIDES - CHECKBOX ||============================== //

// No theme needed for this specific override
export default function Checkbox(): CheckboxComponentConfig {
    return {
        styleOverrides: {
            root: {
                // Adjust label position slightly when using FormControlLabel
                '& + .MuiFormControlLabel-label': {
                    marginTop: 2, // Keep vertical adjustment
                    marginLeft: 1, // Optional: Add slight horizontal spacing
                }
            },
            // Add overrides for specific states if needed
            // checked: {},
            // disabled: {},
        }
    };
}