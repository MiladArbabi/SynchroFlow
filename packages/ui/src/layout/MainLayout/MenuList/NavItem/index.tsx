/* eslint-disable @typescript-eslint/no-unused-vars */
// packages/ui/src/layout/MainLayout/MenuList/NavItem/index.tsx
import React, { useEffect, useRef, useState, useContext, JSX } from 'react';
import { Link, matchPath, useLocation } from 'react-router-dom';

// material-ui
import { useTheme, Theme } from '@mui/material/styles';
import useMediaQuery from '@mui/material/useMediaQuery';
import Avatar from '@mui/material/Avatar';
import ButtonBase from '@mui/material/ButtonBase';
import Chip from '@mui/material/Chip';
import ListItemButton from '@mui/material/ListItemButton';
import ListItemIcon from '@mui/material/ListItemIcon';
import ListItemText from '@mui/material/ListItemText';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import { SxProps } from '@mui/system';

// project imports
import { handlerDrawerOpen, useGetMenuMaster } from 'api/menu'; // We might adjust handlerDrawerOpen usage
import { MenuOrientation, ThemeDirection } from 'config';
import useConfig from 'hooks/useConfig';
import { ConfigContext } from 'contexts/ConfigContext'; // Adjust the import path according to your project structure
import { withAlpha } from 'utils/colorUtils'; // Ensure this is typed later

// third party
import { FormattedMessage } from 'react-intl';

// assets
import FiberManualRecordIcon from '@mui/icons-material/FiberManualRecord';
import { LucideProps } from 'lucide-react';
import Box from '@mui/material/Box';

// Define the NavItemType structure (adjust based on your actual menu-items files)
interface ChipProps {
  color?: 'default' | 'primary' | 'secondary' | 'error' | 'info' | 'success' | 'warning';
  variant?: 'filled' | 'outlined';
  size?: 'small' | 'medium';
  label?: string;
  avatar?: React.ReactNode;
}

export interface NavItemType {
  id: string;
  title: string; // Message ID for react-intl
  type: 'item';
  url: string;
  link?: string; // Optional alternative to url
  icon?: React.FC<LucideProps>;
  target?: boolean;
  disabled?: boolean;
  caption?: string; // Message ID for react-intl
  chip?: ChipProps;
  breadcrumbs?: boolean;
  external?: boolean; // Added based on Berry's structure
}


// Define component props
interface NavItemProps {
  item: NavItemType;
  level: number;
  isParents?: boolean;
  setSelectedID?: () => void; // Optional function from parent
}

const NavItem: React.FC<NavItemProps> = ({ item, level, isParents = false, setSelectedID }) => {
  const theme = useTheme();
  const downMD = useMediaQuery(theme.breakpoints.down('md'));
  const ref = useRef<HTMLDivElement>(null); // Type the ref

  const { pathname } = useLocation();
  const {
    state: { menuOrientation, borderRadius, themeDirection }
  } = useConfig();
  const { dispatch } = useContext(ConfigContext); // Get dispatch from context

  const { menuMaster } = useGetMenuMaster(); // Uses our refactored hook
  const isDrawerOpen = !menuMaster.isDashboardDrawerOpened; // Reads from ConfigContext state via hook
  console.log(`[NavItem] Item: ${item.id}, isDrawerOpen (visual):`, isDrawerOpen);

  const isSelected = !!matchPath({ path: item?.link ? item.link : item.url, end: false }, pathname);

  const Icon = item?.icon;
  const itemIcon = item?.icon ? (
    <Icon strokeWidth={1.5} size={isDrawerOpen ? '20px' : '24px'} style={{ stroke: 'currentColor' }} />
  ) : (
    <FiberManualRecordIcon sx={{ width: isSelected ? 8 : 6, height: isSelected ? 8 : 6 }} fontSize={level > 0 ? 'inherit' : 'medium'} />
  );
  // Check if the current item is selected based on the URL

  const [hoverStatus, setHover] = useState(false);

  const compareSize = () => {
    const compare = ref.current && ref.current.scrollWidth > ref.current.clientWidth;
    setHover(!!compare); // Ensure boolean
  };

  useEffect(() => {
    compareSize();
    window.addEventListener('resize', compareSize);
    // Correct cleanup function
    return () => window.removeEventListener('resize', compareSize);
  }, []); // Empty dependency array means this runs once on mount and cleans up on unmount


  let itemTarget = '_self';
  if (item.target) {
    itemTarget = '_blank';
  }

  const itemHandler = () => {
    // FIX: Use dispatch from ConfigContext instead of handlerDrawerOpen
    if (downMD) {
        dispatch({ type: 'SET_MINI_DRAWER', payload: false });
    }

    if (isParents && setSelectedID) {
      setSelectedID();
    }
  };

  // Define common ListItemButton SX properties
  const listItemButtonSx: SxProps<Theme> = {
    zIndex: 1201,
    borderRadius: `${borderRadius}px`,
    mb: 0.5,
    pl: isDrawerOpen ? `${level * 24}px` : 1.5, // Use inverted state
    py: !isDrawerOpen && level === 1 ? 1.25 : 1, // Use inverted state
     ...(isDrawerOpen && level === 1 && { // Use inverted state
         '&:hover': {
             bgcolor: 'secondary.light'
         },
         '&.Mui-selected': {
             bgcolor: 'secondary.light',
             color: 'secondary.dark', // Use dark for better contrast on light background
             '&:hover': {
                 bgcolor: 'secondary.light',
                 color: 'secondary.dark'
             }
         }
     }),
    ...(!isDrawerOpen && {
      '&:hover': { bgcolor: 'transparent' },
      '&.Mui-selected': {
          '&:hover': { bgcolor: 'transparent' },
           bgcolor: 'transparent'
       }
    })
  };

  // Define common ListItemIcon SX properties
  const listItemIconSx: SxProps<Theme> = {
    minWidth: !item?.icon ? 18 : 36,
    color: isSelected ? 'secondary.main' : 'text.primary',
    // Theme-dependent styles for mini variant
    ...(!isDrawerOpen &&
      level === 1 && {
        borderRadius: `${borderRadius}px`,
        width: 46,
        height: 46,
        alignItems: 'center',
        justifyContent: 'center',
        '&:hover': { bgcolor: 'secondary.light' },
        ...(isSelected && {
          bgcolor: 'secondary.light',
          '&:hover': { bgcolor: 'secondary.light' }
        }),
        // Dark mode overrides using theme.applyStyles (assuming it exists or is added)
         ...(theme.palette.mode === 'dark' && { // Direct check if applyStyles isn't available
             color: isSelected ? 'secondary.main' : 'text.primary', // Adjust dark mode selected color if needed
             '&:hover': { bgcolor: withAlpha(theme.palette.secondary.main, 0.25) },
             ...(isSelected && {
                 bgcolor: withAlpha(theme.palette.secondary.main, 0.25),
                 '&:hover': { bgcolor: withAlpha(theme.palette.secondary.main, 0.3) }
             })
         })
      })
  };


  return (
    <>
      {!itemIcon ? (
        <ListItemButton
          component={Link}
          to={item.url}
          target={itemTarget}
          disabled={item.disabled}
          disableRipple={!isDrawerOpen}
          sx={listItemButtonSx}
          selected={isSelected}
          onClick={itemHandler} // Simplified onClick
        >
          <ListItemIcon sx={listItemIconSx}>{itemIcon}</ListItemIcon>

          {(isDrawerOpen || (!isDrawerOpen && level !== 1)) && (
             <ListItemText
                primary={
                    <Typography
                        ref={ref}
                        variant={isSelected ? 'h5' : 'body1'}
                        color="inherit"
                        sx={{
                             whiteSpace: 'nowrap',
                             overflow: 'hidden',
                             textOverflow: 'ellipsis',
                             width: isDrawerOpen ? 'auto' : 0, // Hide text when drawer is closed unless hovered/tooltip
                             opacity: isDrawerOpen ? 1 : 0,
                             transition: 'width 0.3s ease-in-out, opacity 0.3s ease-in-out',
                        }}
                    >
                        <FormattedMessage id={item.title} defaultMessage={item.title} />
                    </Typography>
                }
                secondary={
                    item.caption && isDrawerOpen && ( // Only show caption if drawer is open
                        <Typography variant="caption" display="block" gutterBottom sx={{ color: 'text.secondary'}}>
                           <FormattedMessage id={item.caption} defaultMessage={item.caption} />
                        </Typography>
                    )
                }
             />
          )}

           {/* Tooltip for Mini variant */}
           {!isDrawerOpen && (
               <Tooltip title={<FormattedMessage id={item.title} defaultMessage={item.title} />} placement="right">
                   {/* This Box acts as the anchor for the tooltip */}
                    <Box sx={{
                        position: 'absolute',
                        left: 0,
                        top: 0,
                        bottom: 0,
                        width: '100%',
                        //bgcolor: 'rgba(255,0,0,0.1)' // For debugging tooltip area
                        }} />
                </Tooltip>
           )}


          {isDrawerOpen && item.chip && (
            <Chip
              color={item.chip.color}
              variant={item.chip.variant}
              size={item.chip.size}
              label={item.chip.label}
              avatar={item.chip.avatar && <Avatar>{item.chip.avatar}</Avatar>}
            />
          )}
        </ListItemButton>
      ) : (
        // Horizontal Layout specific rendering (simplified for now)
         <ListItemButton
            component={Link}
            to={item.url}
            target={itemTarget}
            disabled={item.disabled}
            sx={{
              borderRadius: isParents ? `${borderRadius}px` : 0,
              mb: isParents ? 0 : 0.5,
              alignItems: 'center', // Center items vertically
              //backgroundColor: level > 1 ? 'transparent !important' : 'inherit',
              py: 1,
              px: 1.5, // Adjust padding
              mr: isParents ? 1 : 0,
              display: 'flex',
              '&.Mui-selected': {
                    bgcolor: 'secondary.light',
                    color: 'secondary.dark'
               }
            }}
            selected={isSelected}
            onClick={itemHandler} // Simplified onClick
          >
            <ListItemIcon sx={{ my: 'auto', minWidth: !item?.icon ? 18 : 36 }}>
              {itemIcon}
            </ListItemIcon>
             <ListItemText
                primary={
                    <Typography variant={isSelected ? 'h5' : 'body1'} color="inherit">
                         <FormattedMessage id={item.title} defaultMessage={item.title} />
                    </Typography>
                }
             />
             {item.chip && ( /* Chip rendering for horizontal */
                 <Chip
                    color={item.chip.color}
                    variant={item.chip.variant}
                    size={item.chip.size}
                    label={item.chip.label}
                    avatar={item.chip.avatar && <Avatar>{item.chip.avatar}</Avatar>}
                    sx={{ ml: 1 }} // Add margin if needed
                 />
             )}
        </ListItemButton>
      )}
    </>
  );
};

export default NavItem;