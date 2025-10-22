// packages/ui/src/layout/MainLayout/Header/LocalizationSection/index.tsx
import React, { useEffect, useRef, useState, useContext } from 'react';

// material-ui
import { useTheme, Theme } from '@mui/material/styles';
import useMediaQuery from '@mui/material/useMediaQuery';
import Avatar from '@mui/material/Avatar';
import ClickAwayListener from '@mui/material/ClickAwayListener';
import Grid from '@mui/material/Grid';
import List from '@mui/material/List';
import ListItemButton from '@mui/material/ListItemButton';
import ListItemText from '@mui/material/ListItemText';
import Paper from '@mui/material/Paper';
import Popper, { PopperPlacementType } from '@mui/material/Popper';
import Typography from '@mui/material/Typography';
import Box from '@mui/material/Box';
import { SxProps } from '@mui/system';


// project imports
import Transitions from 'ui-component/extended/Transitions'; // Use converted component
import useConfig from 'hooks/useConfig'; // Use our hook
import { ConfigContext } from 'contexts/ConfigContext'; // Import context for dispatch

// assets
import TranslateTwoToneIcon from '@mui/icons-material/TranslateTwoTone';

// ==============================|| LOCALIZATION ||============================== //

const LocalizationSection: React.FC = () => {
  const {
    state: { borderRadius, i18n }, // Read state via useConfig
    // setField // REMOVED setField
  } = useConfig();
  const { dispatch } = useContext(ConfigContext); // Get dispatch from context

  const theme = useTheme();
  const downMD = useMediaQuery(theme.breakpoints.down('md'));

  const [open, setOpen] = useState(false);
  // Type the anchorRef for Avatar
  const anchorRef = useRef<HTMLDivElement | null>(null);
  const prevOpen = useRef(open);

  // --- UPDATED HANDLER ---
  // Type event as React.MouseEvent
  const handleListItemClick = (_event: React.MouseEvent<HTMLDivElement>, lng: string) => {
    // setField('i18n', lng); // REMOVED setField usage
    dispatch({ type: 'SET_I18N', payload: lng }); // Use dispatch
    setOpen(false);
  };
  // --- END UPDATED HANDLER ---

  const handleToggle = () => {
    setOpen((prevOpen) => !prevOpen);
  };

  // Type event based on ClickAwayListener
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

  // Define Avatar SX with type safety and theme mode checks
  const avatarSx: SxProps<Theme> = {
      width: 34, height: 34, borderRadius: '6px', fontSize: '1rem', // Example styles
      transition: 'all .2s ease-in-out',
      // Safely access palette colors, provide fallbacks
      color: theme.palette.mode === 'dark' ? theme.palette.primary.light : theme.palette.primary.dark,
      background: theme.palette.mode === 'dark' ? theme.palette.dark?.main || '#212946' : theme.palette.primary.light,
      '&:hover, &[aria-controls="menu-list-grow"]': {
          color: theme.palette.primary.light,
          background: theme.palette.primary.main
      },
  };

  const popperPlacement: PopperPlacementType = downMD ? 'bottom-start' : 'bottom';


  return (
    <>
      <Box sx={{ ml: { xs: 0, sm: 1 }, mr: {xs: 0, md: 1 } }}> {/* Adjust margins */}
        <Avatar
          variant="rounded"
          sx={avatarSx}
          ref={anchorRef} // Attach ref
          aria-controls={open ? 'menu-list-grow' : undefined}
          aria-haspopup="true"
          alt="language icon" // Add alt text
          onClick={handleToggle}
          color="inherit" // Remove or set based on desired behavior
        >
          {/* Conditionally render language code or icon */}
          {i18n !== 'en' ? (
            <Typography variant="h5" sx={{ textTransform: 'uppercase', color: 'inherit' }}>
              {i18n}
            </Typography>
          ) : (
            <TranslateTwoToneIcon sx={{ fontSize: '1.3rem' }} />
          )}
        </Avatar>
      </Box>

      <Popper
        placement={popperPlacement}
        open={open}
        anchorEl={anchorRef.current} // Use ref
        role={undefined}
        transition
        disablePortal
        popperOptions={{ // Use popperOptions
            modifiers: [ { name: 'offset', options: { offset: [downMD ? 0 : 0, 20] } } ]
        }}
         sx={{ zIndex: 1300, width: '100%', minWidth: 200, maxWidth: 280 }} // Set width constraints
      >
        {({ TransitionProps }) => (
          <ClickAwayListener onClickAway={handleClose}>
            {/* Use transformOriginPosition */}
            <Transitions
                type="fade" // Use fade
                in={open}
                {...TransitionProps}
                 transformOriginPosition={popperPlacement.includes('top') ? 'bottom' : 'top'}
            >
              <Paper elevation={16} sx={{ boxShadow: theme.shadows[16], borderRadius: `${borderRadius}px` }}>
                {open && ( // Conditionally render list
                  <List component="nav" sx={{ p: 1 }}> {/* Add padding to List */}
                    <ListItemButton selected={i18n === 'en'} onClick={(event) => handleListItemClick(event, 'en')}>
                      <ListItemText
                        primary={
                          <Grid container>
                            <Typography color="textPrimary">English</Typography>
                            <Typography variant="caption" color="textSecondary" sx={{ ml: '8px' }}>
                              (UK)
                            </Typography>
                          </Grid>
                        }
                      />
                    </ListItemButton>
                    <ListItemButton selected={i18n === 'fr'} onClick={(event) => handleListItemClick(event, 'fr')}>
                      <ListItemText
                        primary={
                          <Grid container>
                            <Typography color="textPrimary">français</Typography>
                            <Typography variant="caption" color="textSecondary" sx={{ ml: '8px' }}>
                              (French)
                            </Typography>
                          </Grid>
                        }
                      />
                    </ListItemButton>
                    <ListItemButton selected={i18n === 'ro'} onClick={(event) => handleListItemClick(event, 'ro')}>
                      <ListItemText
                        primary={
                          <Grid container>
                            <Typography color="textPrimary">Română</Typography>
                            <Typography variant="caption" color="textSecondary" sx={{ ml: '8px' }}>
                              (Romanian)
                            </Typography>
                          </Grid>
                        }
                      />
                    </ListItemButton>
                    <ListItemButton selected={i18n === 'zh'} onClick={(event) => handleListItemClick(event, 'zh')}>
                      <ListItemText
                        primary={
                          <Grid container>
                            <Typography color="textPrimary">中国人</Typography>
                            <Typography variant="caption" color="textSecondary" sx={{ ml: '8px' }}>
                              (Chinese)
                            </Typography>
                          </Grid>
                        }
                      />
                    </ListItemButton>
                  </List>
                )}
              </Paper>
            </Transitions>
          </ClickAwayListener>
        )}
      </Popper>
    </>
  );
};

export default LocalizationSection;