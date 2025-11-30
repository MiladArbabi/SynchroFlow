/* eslint-disable @typescript-eslint/no-unused-vars */
// apps/frontend/src/layout/MainLayout/Header/NotificationSection/index.tsx
import React, { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';

// material-ui
import { useTheme, Theme } from '@mui/material/styles';
import useMediaQuery from '@mui/material/useMediaQuery';

import Badge from '@mui/material/Badge';
import IconButton from '@mui/material/IconButton';
import Tooltip from '@mui/material/Tooltip';

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
import MenuItem from '@mui/material/MenuItem';
import { SxProps } from '@mui/system';

// project imports
import MainCard from 'ui-component/cards/MainCard';
import Transitions from 'ui-component/extended/Transitions';
import NotificationList, { INotification } from './NotificationList';

// assets
import { IconBell, IconBuildingStore, IconMailbox, IconPhoto, IconBrandTelegram } from '@tabler/icons-react';
import User1 from 'assets/images/users/user-round.svg';

// --- 2. CREATE MOCK DATA ARRAY ---
const mockNotifications: INotification[] = [
  {
    id: '1',
    avatar: User1,
    title: 'John Doe',
    message: 'It is a long established fact that a reader will be distracted',
    timestamp: '2 min ago',
    tags: [
      { label: 'Unread', color: 'error' },
      { label: 'New', color: 'warning' },
    ]
  },
  {
    id: '2',
    avatar: <IconBuildingStore stroke={1.5} size="20px" />,
    title: 'Store Verification Done',
    message: 'We have successfully received your request.',
    timestamp: '5 min ago',
    tags: [{ label: 'Unread', color: 'error' }]
  },
  {
    id: '3',
    avatar: <IconMailbox stroke={1.5} size="20px" />,
    title: 'Check Your Mail.',
    message: "All done! Now check your inbox as you're in for a sweet treat!",
    timestamp: '10 min ago',
    actions: (
      <Button variant="contained" endIcon={<IconBrandTelegram stroke={1.5} size={20} />} sx={{ width: 'min-content' }}>
        Mail
      </Button>
    )
  },
  {
    id: '4',
    avatar: User1,
    title: 'Jane Smith',
    message: (
      <>
        Uploaded two file on &nbsp;
        <Typography component="span" variant="subtitle1" sx={{ fontWeight: 600 }}>
            21 Oct 2025
        </Typography>
      </>
    ),
    timestamp: '1 hour ago',
  },
];

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
 const [value, setValue] = useState('all');
  // --- ADDED STATE ---
  // Mock state to show the badge. This would come from an API.
  const [hasNewNotifications, setHasNewNotifications] = useState(true);
  // --- END ADDED STATE ---

 // --- MODIFIED REF ---
 // The ref now points to the HTMLButtonElement
 const anchorRef = useRef<HTMLButtonElement | null>(null);
  // --- END MODIFIED REF ---
 const prevOpen = useRef(open);

 const handleToggle = () => {
  setOpen((prevOpen) => !prevOpen);
 };

 const handleClose = (event: MouseEvent | TouchEvent) => {
  if (anchorRef.current && anchorRef.current.contains(event.target as Node)) {
   return;
  }
  setOpen(false);
 };

 useEffect(() => {
  if (prevOpen.current === true && open === false) {
   if (anchorRef.current instanceof HTMLElement) {
     anchorRef.current.focus();
   }
  }
  prevOpen.current = open;
 }, [open]);

 const handleChange = (event: React.ChangeEvent<HTMLInputElement>) => {
  if (event.target.value) {
   setValue(event.target.value);
  }
 };

 const popperPlacement: PopperPlacementType = downMD ? 'bottom' : 'bottom-end';

return (
    <>
      <Box sx={{ ml: { xs: 0, md: 1 }, mr: { xs: 0, md: 1 } }}>
        {/* --- BADGE & ICONBUTTON --- */}
        <Tooltip title="Notifications">
          <IconButton
            ref={anchorRef}
            aria-controls={open ? 'menu-list-grow' : undefined}
            aria-haspopup="true"
            onClick={handleToggle}
            color="inherit" // <-- This makes the icon theme-aware
            size="large"
          >
            <Badge
              variant="dot"
              color="error"
              invisible={!hasNewNotifications} // This controls the red dot
            >
              <IconBell stroke={1.5} size="20px" />
            </Badge>
          </IconButton>
        </Tooltip>
        {/* --- END REPLACEMENT --- */}
      </Box>

      <Popper
        placement={popperPlacement}
        open={open}
        anchorEl={anchorRef.current} // Anchor is now the button
        role={undefined}
        transition
        disablePortal={true}
        popperOptions={{
          modifiers: [{ name: 'offset', options: { offset: [downMD ? 5 : 0, 20] } }]
        }}
        sx={{ zIndex: 1300, width: '100%', maxWidth: 350, minWidth: 300 }}
      >
        {({ TransitionProps }) => (
          <ClickAwayListener onClickAway={handleClose}>
            <Transitions
              type="fade"
              in={open}
              {...TransitionProps}
              transformOriginPosition={popperPlacement.includes('top') ? 'bottom' : 'top'}
            >
              <Paper sx={{ boxShadow: theme.shadows[16] }}>
                {open && (
                  <MainCard border={false} elevation={16} content={false}>
                    {/* --- FIXED STACK LAYOUT --- */}
                    <Stack spacing={2} sx={{ p: 2 }}>
                      {/* Header Row */}
                      <Stack direction="row" alignItems="center" justifyContent="space-between">
                        <Stack direction="row" spacing={1} alignItems="center">
                          <Typography variant="subtitle1">All Notification</Typography>
                          {/* Chip is tied to the same state as the badge */}
                          {hasNewNotifications && (
                            <Chip
                              size="small"
                              label="01"
                              variant="filled"
                              sx={{ color: 'common.white', bgcolor: 'warning.dark' }}
                            />
                          )}
                        </Stack>
                        <Typography
                          component={Link}
                          to="#"
                          variant="subtitle2"
                          sx={{ color: 'primary.main', textDecoration: 'none' }}
                        >
                          Mark as all read
                        </Typography>
                      </Stack>
                      
                      {/* TextField was outside the Stack, it's now correctly placed */}
                      <TextField
                        id="outlined-select-status"
                        select
                        fullWidth
                        value={value}
                        onChange={handleChange}
                        size="small"
                        variant="outlined"
                      >
                        {status.map((option) => (
                          <MenuItem key={option.value} value={option.value}>
                            {option.label}
                          </MenuItem>
                        ))}
                      </TextField>
                    </Stack>
                    {/* --- END FIXED STACK LAYOUT --- */}

                    <Divider />

                    {/* Scrollable Notification List */}
                    <Box
                      sx={{
                        height: '100%',
                        maxHeight: 'calc(100vh - 250px)',
                        overflowY: 'auto',
                        overflowX: 'hidden',
                        '&::-webkit-scrollbar': { width: 5 }
                      }}
                    >
                      <NotificationList notifications={mockNotifications} />
                    </Box>

                    <Divider />

                    <CardActions sx={{ p: 1.25, justifyContent: 'center' }}>
                      <Button size="small" disableElevation component={Link} to="#">
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