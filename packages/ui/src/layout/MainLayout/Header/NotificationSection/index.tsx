// packages/ui/src/layout/MainLayout/Header/NotificationSection/index.tsx
import React, { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom'; // Use react-router-dom Link

// material-ui
import { useTheme, Theme } from '@mui/material/styles';
import useMediaQuery from '@mui/material/useMediaQuery';
import Avatar from '@mui/material/Avatar';
import Button from '@mui/material/Button';
import CardActions from '@mui/material/CardActions';
import Chip from '@mui/material/Chip';
import ClickAwayListener from '@mui/material/ClickAwayListener';
import Divider from '@mui/material/Divider';
import Paper from '@mui/material/Paper';
import Popper, { PopperPlacementType } from '@mui/material/Popper';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import Box from '@mui/material/Box';
import MenuItem from '@mui/material/MenuItem'; // For TextField select options
import { SxProps } from '@mui/system';


// project imports
import MainCard from 'ui-component/cards/MainCard';
import Transitions from 'ui-component/extended/Transitions';
import NotificationList from './NotificationList'; // Use converted component

// assets
import { IconBell } from '@tabler/icons-react';

// notification status options
const status = [
  { value: 'all', label: 'All Notification' },
  { value: 'new', label: 'New' },
  { value: 'unread', label: 'Unread' },
  { value: 'other', label: 'Other' }
];

// ==============================|| NOTIFICATION ||============================== //

const NotificationSection: React.FC = () => {
  const theme = useTheme();
  const downMD = useMediaQuery(theme.breakpoints.down('md'));

  const [open, setOpen] = useState(false);
  const [value, setValue] = useState('all'); // Default to 'all'

  // Type the anchorRef for Avatar compatibility (use Element)
  const anchorRef = useRef<Element | null>(null);
  const prevOpen = useRef(open);

  const handleToggle = () => {
    setOpen((prevOpen) => !prevOpen);
  };

  // Type event based on ClickAwayListener usage
  const handleClose = (event: MouseEvent | TouchEvent) => {
    if (anchorRef.current && anchorRef.current.contains(event.target as Node)) {
      return;
    }
    setOpen(false);
  };

  useEffect(() => {
    if (prevOpen.current === true && open === false) {
      if (anchorRef.current instanceof HTMLElement) { // Check if focusable
           anchorRef.current.focus();
      }
    }
    prevOpen.current = open;
  }, [open]);

  // Type the event for TextField onChange
  const handleChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    // Check if target value exists before setting state
    if (event.target.value) {
      setValue(event.target.value);
    }
  };

  // Define Avatar SX with type safety and theme mode checks
  const avatarSx: SxProps<Theme> = {
      // Use theme typography helpers or manual values
       width: 34, height: 34, borderRadius: '6px', fontSize: '1rem',
      transition: 'all .2s ease-in-out',
      color: theme.palette.mode === 'dark' ? theme.palette.warning.dark : theme.palette.warning.dark, // Keep dark color in both modes for contrast?
      background: theme.palette.mode === 'dark' ? theme.palette.dark.main : theme.palette.warning.light,
      '&:hover, &[aria-controls="menu-list-grow"]': {
          color: theme.palette.mode === 'dark' ? theme.palette.grey[800] : theme.palette.warning.light, // Adjust hover text color
          background: theme.palette.warning.dark, // Keep hover background consistent
      },
  };

  const popperPlacement: PopperPlacementType = downMD ? 'bottom' : 'bottom-end';

  return (
    <>
      <Box sx={{ ml: { xs: 0, md: 1 }, mr: { xs: 0, md: 1 } }}> {/* Adjust margins */}
        <Avatar
          variant="rounded"
          sx={avatarSx}
          ref={anchorRef as React.Ref<HTMLDivElement>} // Cast ref type if needed
          aria-controls={open ? 'menu-list-grow' : undefined}
          aria-haspopup="true"
          onClick={handleToggle}
          color="inherit" // Inherit from Box or parent if needed, or remove
        >
          <IconBell stroke={1.5} size="20px" />
        </Avatar>
      </Box>
      <Popper
        placement={popperPlacement}
        open={open}
        anchorEl={anchorRef.current as Element} // Cast if needed
        role={undefined}
        transition
        disablePortal={true}
        popperOptions={{ // Use popperOptions
            modifiers: [{ name: 'offset', options: { offset: [downMD ? 5 : 0, 20] } }]
        }}
         sx={{ zIndex: 1300, width: '100%', maxWidth: 350, minWidth: 300 }} // Set width constraints on Popper
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
              <Paper sx={{ boxShadow: theme.shadows[16] }}>
                {open && ( // Conditionally render content
                  <MainCard border={false} elevation={16} content={false} >
                    <Stack spacing={2} sx={{ p: 2 }}> {/* Add padding via Stack */}
                      <Stack direction="row" alignItems="center" justifyContent="space-between">
                        <Stack direction="row" spacing={1} alignItems="center"> {/* Adjust spacing */}
                          <Typography variant="subtitle1">All Notification</Typography>
                          <Chip size="small" label="01" variant="filled" sx={{ color: 'common.white', bgcolor: 'warning.dark' }} />
                        </Stack>
                         {/* Use react-router-dom Link */}
                        <Typography component={Link} to="#" variant="subtitle2" sx={{ color: 'primary.main', textDecoration: 'none' }}>
                          Mark as all read
                        </Typography>
                      </Stack>
                      {/* Select Field */}
                        <TextField
                           id="outlined-select-status" // Unique ID
                           select
                           fullWidth
                           value={value}
                           onChange={handleChange}
                           size="small" // Use small size for header context
                           variant="outlined" // Use standard variant
                           // SelectProps={{ native: true }} // Use native select for simplicity
                        >
                            {status.map((option) => (
                                <MenuItem key={option.value} value={option.value}>
                                    {option.label}
                                </MenuItem>
                            ))}
                       </TextField>
                     </Stack> {/* Close initial Stack */}

                      <Divider />

                      {/* Scrollable Notification List */}
                      <Box sx={{
                           height: '100%', // Adjust height logic if needed
                           maxHeight: 'calc(100vh - 250px)', // Example max height, adjust
                           overflowY: 'auto',
                           overflowX: 'hidden',
                           '&::-webkit-scrollbar': { width: 5 } // Basic scrollbar
                        }}>
                           <NotificationList />
                      </Box>

                      <Divider />

                      <CardActions sx={{ p: 1.25, justifyContent: 'center' }}>
                        <Button size="small" disableElevation component={Link} to="#"> {/* Link Button */}
                          View All
                        </Button>
                      </CardActions>
                  </MainCard>
                )}
              </Paper>
            </Transitions>
          </ClickAwayListener>
        )}
      </Popper>
    </>
  );
};

export default NotificationSection;