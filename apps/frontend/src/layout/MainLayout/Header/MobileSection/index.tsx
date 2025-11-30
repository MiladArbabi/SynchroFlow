// apps/frontend/src/layout/MainLayout/Header/MobileSection/index.tsx
import React, { useEffect, useRef, useState } from 'react';

// material-ui
import AppBar from '@mui/material/AppBar';
import IconButton from '@mui/material/IconButton';
import ClickAwayListener from '@mui/material/ClickAwayListener';
import Paper from '@mui/material/Paper';
import Popper, { PopperPlacementType } from '@mui/material/Popper';
import Toolbar from '@mui/material/Toolbar';
import Box from '@mui/material/Box';
import { useTheme } from '@mui/material/styles'; // Import useTheme

// project imports
import Transitions from 'ui-component/extended/Transitions'; // Use converted component

// assets
import { IconDotsVertical } from '@tabler/icons-react';

// ==============================|| MOBILE HEADER ||============================== //

const MobileSection: React.FC = () => {
  const theme = useTheme(); // Get theme
  const [open, setOpen] = useState(false);

  // Type anchorRef for IconButton compatibility (use Element)
  const anchorRef = useRef<Element | null>(null);
  const prevOpen = useRef(open);

  const handleToggle = () => {
    setOpen((prevOpen) => !prevOpen);
  };

  // Type event for ClickAwayListener
  const handleClose = (event: MouseEvent | TouchEvent) => {
    if (anchorRef.current && anchorRef.current.contains(event.target as Node)) {
      return;
    }
    setOpen(false);
  };


  useEffect(() => {
    if (prevOpen.current === true && open === false) {
       if (anchorRef.current instanceof HTMLElement) { // Check focusable
           anchorRef.current.focus();
       }
    }
    prevOpen.current = open;
  }, [open]);

  const popperPlacement: PopperPlacementType = 'bottom-end'; // Define placement

  return (
    <>
      {/* --- Anchor Element: Box containing IconButton --- */}
      {/* Assign ref to the Box which Popper will anchor to */}
      <Box component="span" ref={anchorRef as React.Ref<HTMLSpanElement>} sx={{ mt: 1, ml: 1 }}>
        <IconButton
            sx={{
                color: 'text.primary', // Use theme standard text color
                ml: 0.5,
                cursor: 'pointer',
                // Add hover/focus styles if desired
                 '&:hover': {
                     bgcolor: theme.palette.action.hover // Example hover
                 }
            }}
            onClick={handleToggle}
            aria-controls={open ? 'menu-list-grow' : undefined}
            aria-haspopup="true" // Indicate it opens a menu/popper
            aria-label="Open mobile menu" // Add aria-label
        >
          <IconDotsVertical
            stroke={1.5}
            style={{ fontSize: '1.5rem' }} // Use style for size
          />
        </IconButton>
      </Box>
      {/* --- End Anchor --- */}

      <Popper
        placement={popperPlacement}
        open={open}
        anchorEl={anchorRef.current} // Use ref
        role={undefined}
        transition
        disablePortal // Keep disablePortal for potential stacking issues
        style={{ width: '100%', zIndex: 1300 }} // Ensure high z-index
        popperOptions={{ // Use popperOptions
            modifiers: [ { name: 'offset', options: { offset: [0, 10] } } ] // Adjusted offset
        }}
      >
        {({ TransitionProps }) => (
          <ClickAwayListener onClickAway={handleClose}>
             {/* Adjust transformOriginPosition */}
            <Transitions
                type="fade" // Use fade or zoom
                in={open}
                {...TransitionProps}
                 transformOriginPosition={'top-right'} // Match placement
            >
              <Paper sx={{ boxShadow: theme.shadows[16] }}> {/* Add shadow */}
                {open && (
                  // Use AppBar for structure and background
                  <AppBar color="inherit" position="static" elevation={0}>
                    <Toolbar sx={{ py: 1, justifyContent: 'flex-end' }}> {/* Align content */}
                      {/* Add other sections here if needed for mobile */}
                    </Toolbar>
                  </AppBar>
                )}
              </Paper>
            </Transitions>
          </ClickAwayListener>
        )}
      </Popper>
    </>
  );
};

export default MobileSection;