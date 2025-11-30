// apps/frontend/src/layout/MainLayout/Header/FullScreenSection/index.tsx
import React, { useCallback, useEffect, useState } from 'react';

// material-ui
import { useTheme, Theme } from '@mui/material/styles';
import Avatar from '@mui/material/Avatar';
import Tooltip from '@mui/material/Tooltip';
import Box from '@mui/material/Box';
import { SxProps } from '@mui/system';

// assets
import { IconArrowsMaximize, IconArrowsMinimize } from '@tabler/icons-react';

// ==============================|| HEADER CONTENT - FULLSCREEN ||============================== //

const FullScreenSection: React.FC = () => {
  const theme = useTheme();

  const [open, setOpen] = useState(false); // State to track fullscreen status

  // --- Fullscreen API Interaction ---
  const handleToggle = useCallback(() => {
    // Check if fullscreen is currently active
    if (document && !document.fullscreenElement) {
      // Request fullscreen if not active
      document.documentElement.requestFullscreen()
        .catch((err) => console.error(`Error attempting to enable full-screen mode: ${err.message} (${err.name})`));
      setOpen(true); // Assume success initially, listener will correct if needed
    } else if (document.exitFullscreen) {
      // Exit fullscreen if active and API is supported
      document.exitFullscreen();
      setOpen(false); // Assume success
    }
  }, []);

  // Effect to listen for native fullscreen changes
  useEffect(() => {
    const handleFullscreenChange = () => {
      setOpen(!!document.fullscreenElement); // Update state based on actual browser status
    };

    // Add event listener
    document.addEventListener('fullscreenchange', handleFullscreenChange);

    // Cleanup listener on unmount
    return () => {
      document.removeEventListener('fullscreenchange', handleFullscreenChange);
    };
  }, []); // Empty dependency array, run once on mount


  // Define Avatar SX with type safety and theme mode checks
  const avatarSx: SxProps<Theme> = {
    // Basic styles (adjust sizes as needed)
    width: 34, height: 34, borderRadius: '6px', fontSize: '1rem',
    transition: 'all .2s ease-in-out',
    // Theme mode specific colors (provide fallbacks)
    color: theme.palette.mode === 'dark' ? theme.palette.primary.light : theme.palette.primary.dark,
    background: theme.palette.mode === 'dark' ? theme.palette.dark?.main || '#212946' : theme.palette.primary.light,
    '&:hover': {
        color: theme.palette.primary.light,
        background: theme.palette.primary.main,
    },
  };


  return (
    <Box sx={{ ml: { xs: 0, md: 1 }, mr: { xs: 0, md: 1 } }}>
      <Tooltip title={open ? 'Exit Fullscreen' : 'Fullscreen'} arrow>
        {/* --- FIX: Wrap Avatar in a span --- */}
        <span>
          <Avatar
            variant="rounded"
            sx={avatarSx}
            aria-controls={open ? 'fullscreen-expanded' : 'fullscreen-collapsed'}
            aria-haspopup="false" // Not a popup menu
            onClick={handleToggle}
            color="inherit" // Remove or set as needed
            // If Avatar uses forwardRef, Tooltip might need the ref forwarded through the span
            // ref={ref} // Example if Avatar needed a ref passed through
          >
            {/* Render icon based on state */}
            {open ? <IconArrowsMinimize stroke={1.5} size="20px"/> : <IconArrowsMaximize stroke={1.5} size="20px"/>}
          </Avatar>
        </span>
        {/* --- END FIX --- */}
      </Tooltip>
    </Box>
  );
}

export default FullScreenSection;