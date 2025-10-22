// packages/ui/src/layout/MainLayout/Header/ProfileSection/index.tsx
import React, { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';

// material-ui
import { useTheme, Theme } from '@mui/material/styles';
import Avatar from '@mui/material/Avatar';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import Chip from '@mui/material/Chip';
import ClickAwayListener from '@mui/material/ClickAwayListener';
import Divider from '@mui/material/Divider';
import InputAdornment from '@mui/material/InputAdornment';
import List from '@mui/material/List';
import ListItemButton from '@mui/material/ListItemButton';
import ListItemIcon from '@mui/material/ListItemIcon';
import ListItemText from '@mui/material/ListItemText';
import OutlinedInput from '@mui/material/OutlinedInput';
import Paper from '@mui/material/Paper';
import Popper from '@mui/material/Popper';
import Stack from '@mui/material/Stack';
import Switch from '@mui/material/Switch';
import Typography from '@mui/material/Typography';
import Box from '@mui/material/Box';
import { PopperPlacementType } from '@mui/material'; // Import Popper placement type
import { SxProps } from '@mui/system';


// third party
import { FormattedMessage } from 'react-intl';

// project imports
import UpgradePlanCard from './UpgradePlanCard'; // Use converted component
import MainCard from 'ui-component/cards/MainCard';
import Transitions from 'ui-component/extended/Transitions';
// import useAuth from 'hooks/useAuth'; // --- REMOVE BERRY AUTH ---
import { UserContext } from 'contexts/UserContext'; // <-- IMPORT OUR UserContext

// assets
import User1 from 'assets/images/users/user-round.svg'; // Use imported asset
import { IconLogout, IconSearch, IconSettings, IconUser } from '@tabler/icons-react';
import useConfig from 'hooks/useConfig';

// ==============================|| PROFILE MENU ||============================== //

const ProfileSection: React.FC = () => {
  const theme = useTheme();
  const {
    state: { borderRadius }
  } = useConfig();
  const navigate = useNavigate();

  // --- STATE ---
  const [sdm, setSdm] = useState(true); // DND mode state
  const [value, setValue] = useState(''); // Search input state
  const [notification, setNotification] = useState(false); // Notification toggle state
  const [selectedIndex, setSelectedIndex] = useState(-1); // List item selection state
  const [open, setOpen] = useState(false); // Popper open state

  // --- OUR AUTH CONTEXT ---
  const { user, logout: contextLogout } = React.useContext(UserContext); // Use our context
  // --- END OUR AUTH ---

  // --- REFS ---
  // Type the anchorRef for Chip and Avatar compatibility (use Element for broader type)
  const anchorRef = useRef<Element | null>(null);
  const prevOpen = useRef(open);

  // --- HANDLERS ---
  const handleLogout = async () => {
    try {
      // await logout(); // --- REPLACE BERRY LOGIC ---
      if (contextLogout) {
          console.log("Logging out...");
          contextLogout(); // Call our context logout
          navigate('/authentication/sign-in'); // Redirect after logout
      } else {
           console.error("Logout function not available in context");
      }
      // --- END REPLACE ---
    } catch (err) {
      console.error(err);
    }
  };

  // Type the event as React.MouseEvent
  const handleListItemClick = (event: React.MouseEvent<HTMLDivElement>, index: number, route = '') => {
    setSelectedIndex(index);
    handleClose(event);

    if (route && route !== '') {
      navigate(route);
    }
  };

  const handleToggle = () => {
    setOpen((prevOpen) => !prevOpen);
  };

  // Type event based on ClickAwayListener usage (MouseEvent | TouchEvent)
  const handleClose = (event: MouseEvent | TouchEvent) => {
    // Check if the click target is the anchor element itself
    if (anchorRef.current && anchorRef.current.contains(event.target as Node)) {
      return;
    }
    setOpen(false);
  };

  // --- EFFECT ---
  useEffect(() => {
    if (prevOpen.current === true && open === false) {
       // Check if anchorRef.current is focusable (HTML element)
       if (anchorRef.current instanceof HTMLElement) {
            anchorRef.current.focus();
       }
    }
    prevOpen.current = open;
  }, [open]);

  // Popper placement adjustment
  const popperPlacement: PopperPlacementType = 'bottom-end'; // More common placement


  return (
    <>
      <Chip
        // slotProps={{ label: { sx: { lineHeight: 0 } } }} // This might cause issues, check MUI docs if needed
        sx={{
            ml: 2,
            height: '48px',
            alignItems: 'center',
            borderRadius: '27px',
            transition: 'all .2s ease-in-out',
            bgcolor: theme.palette.mode === 'dark' ? theme.palette.grey[800] : theme.palette.primary.light,
            backgroundColor: theme.palette.mode === 'dark' ? theme.palette.grey[800] : theme.palette.primary.light,
            '&[aria-controls="menu-list-grow"], &:hover': {
                borderColor: theme.palette.primary.main,
                background: `${theme.palette.primary.main}!important`,
                color: theme.palette.primary.light,
                '& svg': {
                    stroke: theme.palette.primary.light
                }
            },
            '& .MuiChip-label': {
                lineHeight: 0
            }
        }}
        icon={
          <Avatar
            src={User1} // Use imported SVG
            alt="User Avatar" // Add alt text
            sx={{
              // Use theme typography helper if available, otherwise direct values
              width: 34, height: 34, // Example size, adjust as needed
              margin: '8px 0 8px 8px !important',
              cursor: 'pointer'
            }}
            ref={anchorRef as React.Ref<HTMLDivElement>} // Cast ref type if needed for Avatar
            aria-controls={open ? 'menu-list-grow' : undefined}
            aria-haspopup="true"
            color="inherit" // Inherit color from Chip
            onClick={handleToggle} // Move onClick here for clarity
          />
        }
        label={<IconSettings stroke={1.5} size="24px" color={theme.palette.primary.main} />} // Adjust icon color if needed
        variant="outlined" // Use outlined variant for better styling control
        // ref={anchorRef as React.Ref<HTMLDivElement>} // Assign ref to Chip, potentially needs casting
        aria-controls={open ? 'menu-list-grow' : undefined}
        aria-haspopup="true"
        onClick={handleToggle}
        color="primary"
        aria-label="user-account"
      />
      <Popper
        placement={popperPlacement}
        open={open}
        anchorEl={anchorRef.current as Element} // Anchor to the ref, cast if needed
        role={undefined}
        transition
        disablePortal
        popperOptions={{ // Use popperOptions instead of modifiers
            modifiers: [ { name: 'offset', options: { offset: [0, 14] } } ]
        }}
        sx={{ zIndex: 1300 }} // Ensure popper is above other elements
      >
        {({ TransitionProps }) => (
          <ClickAwayListener onClickAway={handleClose}>
            {/* Use transformOriginPosition based on placement */}
            <Transitions
                type="fade" // Use fade, simpler than 'in' prop directly
                in={open} {...TransitionProps}
                transformOriginPosition={popperPlacement.includes('top') ? 'bottom' : 'top'}
            >
              <Paper sx={{ boxShadow: theme.shadows[16], width: '100%', maxWidth: 350, minWidth: 300 }}>
                {open && ( // Conditionally render content based on open state
                  <MainCard border={false} elevation={16} content={false} >
                    <Box sx={{ p: 2, pb: 0 }}>
                      <Stack spacing={0.5}> {/* Adjust spacing */}
                        <Stack direction="row" spacing={0.5} alignItems="center"> {/* Use spacing */}
                          <Typography variant="h4">Good Morning,</Typography>
                          <Typography component="span" variant="h4" sx={{ fontWeight: 400 }}>
                             {/* Use our context user name */}
                             {user?.username || 'User'}
                          </Typography>
                        </Stack>
                         {/* Replace with actual user role from context if available */}
                        <Typography variant="subtitle2">Project Admin</Typography>
                      </Stack>
                      <OutlinedInput
                        sx={{ width: '100%', pr: 1, pl: 2, my: 2 }}
                        id="input-search-profile"
                        value={value}
                        onChange={(e) => setValue(e.target.value)}
                        placeholder="Search profile options"
                        startAdornment={
                          <InputAdornment position="start">
                            <IconSearch stroke={1.5} size="16px" />
                          </InputAdornment>
                        }
                        aria-describedby="search-helper-text"
                         // Remove slotProps, directly use inputProps if needed
                         inputProps={{ 'aria-label': 'Search profile options' }}
                      />
                      <Divider />
                    </Box>
                    <Box
                      sx={{
                        p: 2,
                        pt: 0, // Adjust padding
                        height: '100%',
                        maxHeight: 'calc(100vh - 250px)',
                        overflowY: 'auto', // Use auto for overflow
                        overflowX: 'hidden',
                        '&::-webkit-scrollbar': { width: 5 } // Basic scrollbar styling
                      }}
                    >
                      <UpgradePlanCard />
                      <Divider />
                      {/* Inner Card - Use theme mode check */}
                      <Card sx={{
                          bgcolor: theme.palette.mode === 'dark' ? theme.palette.grey[800] : theme.palette.primary.light,
                          my: 2
                       }}>
                        <CardContent>
                          <Stack spacing={2}> {/* Adjust spacing */}
                            <Stack direction="row" alignItems="center" justifyContent="space-between">
                              <Typography variant="subtitle1">Start DND Mode</Typography>
                              <Switch color="primary" checked={sdm} onChange={(e) => setSdm(e.target.checked)} name="sdm" size="small" />
                            </Stack>
                            <Stack direction="row" alignItems="center" justifyContent="space-between">
                              <Typography variant="subtitle1">Allow Notifications</Typography>
                              <Switch checked={notification} onChange={(e) => setNotification(e.target.checked)} name="notification" size="small" />
                            </Stack>
                          </Stack>
                        </CardContent>
                      </Card>
                      <Divider />
                      <List component="nav" sx={{ '& .MuiListItemButton-root': { mt: 0.5 } }}>
                        <ListItemButton
                          sx={{ borderRadius: `${borderRadius}px` }}
                          selected={selectedIndex === 0}
                          onClick={(event) => handleListItemClick(event, 0, '#!')} // Example route
                        >
                          <ListItemIcon> <IconSettings stroke={1.5} size="20px" /> </ListItemIcon>
                          <ListItemText primary={<Typography variant="body2"><FormattedMessage id="account-settings" defaultMessage="Account Settings" /></Typography>} />
                        </ListItemButton>
                        <ListItemButton
                          sx={{ borderRadius: `${borderRadius}px` }}
                          selected={selectedIndex === 1}
                          onClick={(event) => handleListItemClick(event, 1, '#!')} // Example route
                        >
                          <ListItemIcon> <IconUser stroke={1.5} size="20px" /> </ListItemIcon>
                          <ListItemText
                            primary={
                              <Stack direction="row" alignItems="center" justifyContent="space-between">
                                <Typography variant="body2"><FormattedMessage id="social-profile" defaultMessage="Social Profile" /></Typography>
                                <Chip label="02" variant="filled" size="small" color="warning" />
                              </Stack>
                            }
                          />
                        </ListItemButton>
                        <ListItemButton
                            sx={{ borderRadius: `${borderRadius}px` }}
                            selected={selectedIndex === 4} // Index adjusted?
                            onClick={handleLogout} // Use updated handler
                        >
                          <ListItemIcon> <IconLogout stroke={1.5} size="20px" /> </ListItemIcon>
                          <ListItemText primary={<Typography variant="body2"><FormattedMessage id="logout" defaultMessage="Logout" /></Typography>} />
                        </ListItemButton>
                      </List>
                    </Box>
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

export default ProfileSection;