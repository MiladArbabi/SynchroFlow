/* eslint-disable @typescript-eslint/no-unused-vars */
// packages/ui/src/layout/MainLayout/Header/MegaMenuSection/index.tsx
import React, { useRef, useState, forwardRef } from 'react';
import { Link as RouterLink } from 'react-router-dom'; // Use RouterLink for internal links

// material-ui
import { useTheme, Theme } from '@mui/material/styles';
import Avatar, { AvatarProps } from '@mui/material/Avatar';
import ClickAwayListener from '@mui/material/ClickAwayListener';
import Grid from '@mui/material/Grid'; // Use Grid v2 (no 'size' prop)
import List from '@mui/material/List';
import ListItemButton from '@mui/material/ListItemButton';
import ListItemIcon from '@mui/material/ListItemIcon';
import ListSubheader from '@mui/material/ListSubheader';
import ListItemText from '@mui/material/ListItemText';
import Paper from '@mui/material/Paper';
import Popper, { PopperPlacementType } from '@mui/material/Popper';
import Typography from '@mui/material/Typography';
import Box from '@mui/material/Box';
import Link from '@mui/material/Link'; // Use MUI Link for external links
import { SxProps } from '@mui/system';


// project imports
import { ThemeDirection } from 'config';
import MainCard from 'ui-component/cards/MainCard';
import Transitions from 'ui-component/extended/Transitions';
import { drawerWidth, gridSpacing } from 'config'; // Use our config import
import useConfig from 'hooks/useConfig';

// assets
import Banner from './Banner'; // Use our placeholder
import FiberManualRecordIcon from '@mui/icons-material/FiberManualRecord';
import { IconAccessPoint } from '@tabler/icons-react';

// Define Props for HeaderAvatar, extending AvatarProps
interface HeaderAvatarProps extends AvatarProps {
  children: React.ReactNode;
}

// Internal HeaderAvatar component using forwardRef
const HeaderAvatar = forwardRef<HTMLDivElement, HeaderAvatarProps>(
    ({ children, sx, ...others }, ref) => {
    const theme = useTheme();

    // Define SX with type safety
    const avatarSx: SxProps<Theme> = {
        width: 34, height: 34, borderRadius: '6px', fontSize: '1rem', // Example styles
        transition: 'all .2s ease-in-out',
        display: { xs: 'none', md: 'flex' }, // Keep responsive display
        // Theme mode colors with fallbacks
        color: theme.palette.mode === 'dark' ? theme.palette.secondary.main : theme.palette.secondary.dark,
        background: theme.palette.mode === 'dark' ? theme.palette.dark?.main || '#212946' : theme.palette.secondary.light,
        '&:hover, &[aria-controls="menu-list-grow"]': {
            color: theme.palette.secondary.light,
            background: theme.palette.mode === 'dark' ? theme.palette.secondary.main : theme.palette.secondary.dark,
        },
        ...sx // Allow overriding sx
    };

    return (
      <Avatar
        ref={ref}
        variant="rounded" // Keep variant if needed
        sx={avatarSx}
        {...others}
      >
        {children}
      </Avatar>
    );
});


// Define Link List structure type
interface LinkItem {
    link: string;
    label: string;
    target?: string;
}
interface LinkGroup {
    id: string;
    label: string;
    children: LinkItem[];
}
const linkList: LinkGroup[] = [
  {
    id: 'user-quick',
    label: 'User Quick',
    children: [
      { link: '#!', label: 'Social Profile' },
      { link: '#!', label: 'Account Profile' },
      { link: '#!', label: 'User Cards' },
      { link: '#!', label: 'User List' },
      { link: '#!', label: 'Contact' }
    ]
  },
  {
    id: 'application',
    label: 'Applications',
    children: [
      { link: '#!', label: 'Chat' },
      { link: '#!', label: 'Kanban' },
      { link: '#!', label: 'Mail' },
      { link: '#!', label: 'Calendar' },
      { link: '#!', label: 'E-commerce' }
    ]
  },
  {
    id: 'primitives',
    label: 'Primitives',
    children: [
      { link: '#!', label: 'Colors' },
      { link: '#!', label: 'Typography' },
      { link: '#!', label: 'Shadows' },
      { link: 'https://tabler-icons.io/', label: 'Icons', target: '_blank' },
      { link: '#!', label: 'Elements' }
    ]
  }
];

// ==============================|| SEARCH INPUT - MEGA MENU ||============================== //

const MegaMenuSection: React.FC = () => {
  const theme = useTheme();
  const {
    state: { themeDirection }
  } = useConfig();

  const [open, setOpen] = useState(false);
  // Type anchorRef for Avatar
  const anchorRef = useRef<HTMLDivElement | null>(null);

  const handleToggle = () => {
    setOpen((prevOpen) => !prevOpen);
  };

  // Type event
  const handleClose = (event: MouseEvent | TouchEvent) => {
    if (anchorRef.current && anchorRef.current.contains(event.target as Node)) {
      return;
    }
    setOpen(false);
  };

  const popperPlacement: PopperPlacementType = 'bottom-end'; // Simpler placement


  return (
    <>
      <HeaderAvatar
        // variant="rounded" // Already set in HeaderAvatar component
        ref={anchorRef}
        aria-controls={open ? 'menu-list-grow' : undefined}
        aria-haspopup="true"
        onClick={handleToggle}
      >
        <IconAccessPoint stroke={1.5} size="20px" />
      </HeaderAvatar>
      <Popper
        placement={popperPlacement}
        open={open}
        anchorEl={anchorRef.current}
        role={undefined}
        transition
        // Remove complex RTL SX for now, handle positioning via placement and offset
        // sx={{ ...(themeDirection === ThemeDirection.RTL && { ... }) }}
        disablePortal
        popperOptions={{ // Use popperOptions
            modifiers: [ { name: 'offset', options: { offset: [150, 20] } } ] // Adjust offset as needed
        }}
         sx={{ zIndex: 1300 }} // Ensure high z-index
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
              <Paper sx={{
                  // Responsive width calculation
                  width: {
                      md: `calc(100vw - 100px)`, // Adjust calculation if needed
                      lg: `calc(100vw - ${drawerWidth + 100}px)`,
                      xl: `calc(100vw - ${drawerWidth + 140}px)`
                  },
                  maxWidth: { xl: 900, md: 764 },
                   boxShadow: theme.shadows[16] // Apply shadow here
               }}>
                {open && (
                  <MainCard
                    border={false}
                    elevation={16} // Redundant? Shadow applied to Paper
                    content={false}
                    // boxShadow // Prop might not exist, shadow applied to Paper
                    // shadow={theme.shadows[16]} // Prop might not exist
                    sx={{ overflow: { p: 1, xs: 'visible', md: 'hidden' } }}
                  >
                    {/* Use Grid v2 container/item props */}
                    <Grid container spacing={gridSpacing}>
                       <Grid > {/* Use item prop */}
                        <Banner />
                      </Grid>
                      <Grid > {/* Use item prop */}
                        <Grid
                          container
                          spacing={gridSpacing}
                          sx={{
                            pt: 3,
                            '& .MuiListItemButton-root:hover': {
                              bgcolor: 'transparent',
                              '& .MuiTypography-root': { color: 'secondary.main' }
                            },
                            '& .MuiListItemIcon-root': { minWidth: 16 }
                          }}
                        >
                          {linkList.map((links) => ( // Removed index from map key
                             <Grid size={{ xs: 12, sm: 4 }} key={links.id}> {/* Use item prop, adjust breakpoints */}
                              <List
                                component="nav"
                                aria-labelledby={`list-${links.id}`}
                                subheader={
                                  <ListSubheader id={`list-${links.id}`}>
                                    <Typography variant="subtitle1">{links.label}</Typography>
                                  </ListSubheader>
                                }
                              >
                                {links.children.map((item) => ( // Removed index from map key
                                  <ListItemButton
                                    // Use RouterLink for internal '#' links, MUI Link for external
                                    component={item.target === '_blank' ? Link : RouterLink}
                                    to={item.link}
                                    href={item.target === '_blank' ? item.link : undefined} // href only for external Link
                                    key={item.label} // Use label as key (assuming unique within group)
                                    target={item.target}
                                    sx={{ py: 0.5 }} // Adjust padding
                                  >
                                    <ListItemIcon sx={{ minWidth: 16 }}> {/* Ensure minWidth */}
                                      <FiberManualRecordIcon sx={{ fontSize: '0.5rem' }} />
                                    </ListItemIcon>
                                    <ListItemText primary={item.label} />
                                  </ListItemButton>
                                ))}
                              </List>
                            </Grid>
                          ))}
                        </Grid>
                      </Grid>
                    </Grid>
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

export default MegaMenuSection;