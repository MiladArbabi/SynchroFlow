import React, { useEffect, useRef } from 'react';
import { TextField, InputAdornment } from '@mui/material';
import { KoreIcon } from 'components/KoreIcon';

// Define the component's props
interface OpsCommandInputProps {
  searchQuery: string;
  onSearchChange: (query: string) => void;
  onKeyDown: (event: React.KeyboardEvent) => void;
  isExecuting: boolean;
  isConsoleOpen: boolean; // We need this to trigger auto-focus
}

/**
 * The main input component for the Kore Command Bar.
 * Handles auto-focus, user input, and keyboard events.
 */
export const OpsCommandInput = React.forwardRef<
  HTMLInputElement,
  OpsCommandInputProps
>(
  (
    {
      searchQuery,
      onSearchChange,
      onKeyDown,
      isExecuting,
      isConsoleOpen,
    },
    ref,
  ) => {
    // Use an internal ref if an external one isn't provided
    const internalRef = useRef<HTMLInputElement>(null);
    const inputRef = ref || internalRef;

    // --- Auto-focus Effect ---
    useEffect(() => {
      // When the console opens, focus the input
      if (isConsoleOpen && inputRef && typeof inputRef === 'object' && inputRef.current) {
        // Use a small delay to ensure the panel animation is complete
        const timer = setTimeout(() => {
          inputRef.current?.focus();
        }, 100); // 100ms should be enough for the panel to slide open
        
        return () => clearTimeout(timer);
      }
    }, [isConsoleOpen, inputRef]);

    return (
      <TextField
        fullWidth
        variant="standard" // Use standard for a clean, borderless look
        placeholder="Ask Kore..."
        value={searchQuery}
        onChange={(e) => onSearchChange(e.target.value)}
        onKeyDown={onKeyDown}
        disabled={isExecuting}
        // --- Wire up the ref and data-testid ---
        inputRef={inputRef}
        inputProps={{ // <-- Correct (lowercase i) for HTML input attributes
          'data-testid': 'kore-command-input',
        }}
        // --- Styling & Kore Icon ---
        InputProps={{ // <-- Correct (uppercase I) for MUI Input wrapper
          disableUnderline: true, // Remove the bottom border
          startAdornment: (
            <InputAdornment position="start" sx={{ pl: 1, pr: 0.5 }}>
              <KoreIcon
                isActive={isExecuting} // Pass isExecuting to the animation prop
                size={18} />
            </InputAdornment>
          ),
        }}
        sx={{
          // Container box styling
          p: 1.5,
          borderBottom: '1px solid',
          borderColor: 'divider',
          '& .MuiInputBase-input': {
            fontSize: '1 rem',
            padding: 0,
          },
        }}
      />
    );
  },
);