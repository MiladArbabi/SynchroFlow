// apps/frontend/src/themes/overrides/OutlinedInput.ts
import { Theme } from '@mui/material/styles';
import { Components } from '@mui/material/styles';
import { outlinedInputClasses } from '@mui/material/OutlinedInput';
import { inputBaseClasses } from '@mui/material/InputBase';

type OutlinedInputComponentConfig = Components<Theme>['MuiOutlinedInput'];

export default function OutlinedInput(_theme: Theme, borderRadius: number, outlinedFilled: boolean): OutlinedInputComponentConfig {
    const fieldBackground = outlinedFilled ? 'var(--bg-2)' : 'transparent';

    return {
        styleOverrides: {
            root: {
                background: fieldBackground,
                borderRadius: `${borderRadius}px`,
                color: 'var(--ink)',

                '&:hover': {
                    [`& .${outlinedInputClasses.notchedOutline}`]: {
                        borderColor: 'var(--accent)'
                    }
                },

                [`&.${outlinedInputClasses.focused}`]: {
                    [`& .${outlinedInputClasses.notchedOutline}`]: {
                        borderColor: 'var(--accent)'
                    }
                },

                [`&.${outlinedInputClasses.error}`]: {
                    [`& .${outlinedInputClasses.notchedOutline}`]: {
                        borderColor: 'var(--danger, #EF4444)'
                    }
                },

                [`&.${outlinedInputClasses.disabled}`]: {
                    background: 'var(--bg-2)',
                    opacity: 0.62,
                    [`& .${outlinedInputClasses.notchedOutline}`]: {
                        borderColor: 'var(--rule)'
                    },
                    [`& .${inputBaseClasses.input}`]: {
                        WebkitTextFillColor: 'var(--ink-4)'
                    }
                },

                [`&.${inputBaseClasses.multiline}`]: {
                    padding: 1
                }
            },

            input: {
                fontWeight: 500,
                background: fieldBackground,
                padding: '15.5px 14px',
                borderRadius: `${borderRadius}px`,
                color: 'var(--ink)',

                '&::placeholder': {
                    color: 'var(--ink-4)',
                    fontSize: '0.875rem',
                    opacity: 0.85
                },

                [`&.${inputBaseClasses.inputSizeSmall}`]: {
                    padding: '10px 14px',
                    [`&.${inputBaseClasses.inputAdornedStart}`]: {
                        paddingLeft: 0
                    }
                }
            },

            inputAdornedStart: {
                paddingLeft: 4
            },

            inputAdornedEnd: {},

            notchedOutline: {
                borderRadius: `${borderRadius}px`,
                borderColor: 'var(--rule-2)'
            }
        }
    };
}