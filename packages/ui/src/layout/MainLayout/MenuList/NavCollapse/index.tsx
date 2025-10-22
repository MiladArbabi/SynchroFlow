/* eslint-disable @typescript-eslint/no-unused-vars */
// packages/ui/src/layout/MainLayout/MenuList/NavCollapse/index.tsx
import React, { useEffect, useRef, useState, useContext, JSX } from 'react';
import { useLocation } from 'react-router-dom';

// material-ui
import { styled, useTheme, Theme } from '@mui/material/styles';
import useMediaQuery from '@mui/material/useMediaQuery';
import ClickAwayListener from '@mui/material/ClickAwayListener';
import Collapse from '@mui/material/Collapse';
import List from '@mui/material/List';
import ListItemButton from '@mui/material/ListItemButton';
import ListItemIcon from '@mui/material/ListItemIcon';
import ListItemText from '@mui/material/ListItemText';
import Paper from '@mui/material/Paper';
import Popper from '@mui/material/Popper';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import Box from '@mui/material/Box';
import { SxProps } from '@mui/system';
import { matchPath } from 'react-router-dom';

// project imports
import NavItem, { NavItemType } from '../NavItem'; // Import NavItem and its type
import Transitions from 'ui-component/extended/Transitions';
import { withAlpha } from 'utils/colorUtils'; // Ensure this is typed

import { useGetMenuMaster } from 'api/menu'; // Uses our refactored hook
import { MenuOrientation, ThemeDirection } from 'config';
import useConfig from 'hooks/useConfig';
import { ConfigContext } from 'contexts/ConfigContext'; // Import ConfigContext separately
import useMenuCollapse from 'hooks/useMenuCollapse'; // Ensure this hook is copied and typed

// third party
import { FormattedMessage } from 'react-intl';

// assets
import { IconChevronDown, IconChevronRight, IconChevronUp, TablerIconsProps } from '@tabler/icons-react';
import FiberManualRecordIcon from '@mui/icons-material/FiberManualRecord';

// Define the NavCollapseType structure
interface NavCollapseType {
  id: string;
  title: string; // Message ID
  type: 'collapse';
  icon?: (props: TablerIconsProps) => JSX.Element;
  children?: (NavCollapseType | NavItemType)[];
  caption?: string; // Message ID
  disabled?: boolean;
  breadcrumbs?: boolean;
  url?: string; // Optional: Some collapses might link directly
}

// Define component props
interface NavCollapseProps {
  menu: NavCollapseType;
  level: number;
  parentId: string; // ID of the parent NavGroup or NavCollapse
}


// horizontal-menu - wrapper styles (ensure variables like $primaryLight are defined or replaced)
const PopperStyled = styled(Popper)(({ theme }) => ({
  overflow: 'visible',
  zIndex: 1202,
  minWidth: 180,
  '&:before': {
    content: '""',
    display: 'block',
    position: 'absolute',
    top: 5,   // Adjusted for potential vertical alignment issues
    left: -5,
    width: 12,
    height: 12,
    transform: 'translateY(-50%) rotate(45deg)',
    zIndex: 120,
    borderWidth: '6px',
    borderStyle: 'solid',
    // Use theme variables for colors
    borderTopColor: 'transparent',
    borderRightColor: 'transparent',
    borderBottomColor: theme.palette.mode === 'dark' ? theme.palette.grey[800] : theme.palette.background.paper, // Adjust color based on theme
    borderLeftColor: theme.palette.mode === 'dark' ? theme.palette.grey[800] : theme.palette.background.paper, // Adjust color based on theme
    // Adjust arrow position for RTL
    ...(theme.direction === 'rtl' && {
        left: 'auto',
        right: -5,
         borderTopColor: 'transparent',
         borderLeftColor: 'transparent',
         borderBottomColor: theme.palette.mode === 'dark' ? theme.palette.grey[800] : theme.palette.background.paper,
         borderRightColor: theme.palette.mode === 'dark' ? theme.palette.grey[800] : theme.palette.background.paper,
    }),
  },
    // Placement adjustments might be needed based on testing
   '&[data-popper-placement*="right"]': {
     '&:before': {
        left: -5,
        right: 'auto',
         borderTopColor: 'transparent',
         borderRightColor: 'transparent',
         //... other borders
         ...(theme.direction === 'rtl' && {
            left: 'auto',
            right: -5,
             //... other borders for RTL right placement
         }),
     }
   },
    '&[data-popper-placement*="left"]': {
       '&:before': {
          left: 'auto',
          right: -5,
           borderLeftColor: 'transparent',
           borderBottomColor: 'transparent',
           //... other borders
           ...(theme.direction === 'rtl' && {
               left: -5,
               right: 'auto',
                //... other borders for RTL left placement
           }),
       }
   },

}));


const NavCollapse: React.FC<NavCollapseProps> = ({ menu, level, parentId }) => {
  const theme = useTheme();
  const downMD = useMediaQuery(theme.breakpoints.down('md'));
  const ref = useRef<HTMLDivElement>(null); // Type the ref
    const popperRef = useRef<HTMLDivElement>(null); // Ref for Popper Paper


  const {
    state: { menuOrientation, borderRadius, themeDirection }
  } = useConfig();
   const { dispatch } = useContext(ConfigContext); // Get dispatch

  const { menuMaster } = useGetMenuMaster();
  const drawerOpen = menuMaster.isDashboardDrawerOpened;
  const isHorizontal = menuOrientation === MenuOrientation.HORIZONTAL && !downMD;

  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [anchorEl, setAnchorEl] = useState<null | HTMLElement>(null);

    // Custom hook manages collapse state based on route and openMini state
    // Ensure useMenuCollapse is copied and typed correctly
    useMenuCollapse(selected, menu, useLocation().pathname, Boolean(anchorEl), setSelected, setOpen, setAnchorEl);


  const handleClick = (event: React.MouseEvent<HTMLElement>) => {
    setAnchorEl(null); // Close any existing popper first
    if (drawerOpen) { // Standard vertical menu behavior
      setOpen(!open);
      setSelected(!open && menu.id ? menu.id : null);
    } else { // Mini variant behavior (popper)
      setAnchorEl(event.currentTarget);
    }
  };


  const handleHover = (event: React.MouseEvent<HTMLElement>) => {
     if (!drawerOpen) { // Only trigger hover popper in mini variant
        setAnchorEl(event.currentTarget);
     }
  };

  const openMini = Boolean(anchorEl);

   const handleClosePopper = () => {
        setAnchorEl(null);
        // Do not reset 'open' or 'selected' state here for vertical menu
   };

    // Close popper on click away, but only if it's the mini variant popper
    const handleCloseMini = (event: MouseEvent | TouchEvent) => {
        if (anchorEl && anchorEl.contains(event.target as Node)) {
            return;
        }
         // Check if the click is inside the Popper itself
         if (popperRef.current && popperRef.current.contains(event.target as Node)) {
             return;
         }
        handleClosePopper();
    };


  const { pathname } = useLocation();

  const [hoverStatus, setHover] = useState(false);

  const compareSize = () => {
    const compare = ref.current && ref.current.scrollWidth > ref.current.clientWidth;
    setHover(!!compare);
  };

  useEffect(() => {
    compareSize();
    window.addEventListener('resize', compareSize);
    return () => window.removeEventListener('resize', compareSize);
  }, []);

    // Effect to handle initial selection based on URL (runs once)
    useEffect(() => {
        const checkSelected = (items: (NavCollapseType | NavItemType)[], currentPath: string) => {
            for (const item of items) {
                if (item.type === 'item' && matchPath({ path: item.url, end: false }, currentPath)) {
                    setSelected(menu.id); // Select this collapse group
                    setOpen(true); // Open this collapse group
                    return true; // Found a match
                }
                if (item.type === 'collapse' && item.children) {
                    if (checkSelected(item.children, currentPath)) {
                        setSelected(menu.id); // Select this collapse group
                        setOpen(true); // Open this collapse group
                        return true; // Found a match in subgraph
                    }
                }
            }
            return false; // No match found in this branch
        };

        if (menu.children) {
            checkSelected(menu.children, pathname);
        }
    }, [pathname, menu]); // Rerun only if menu or path changes

  // menu collapse & item
  const menus = menu.children?.map((item) => {
    switch (item.type) {
      case 'collapse':
        return <NavCollapse key={item.id} menu={item as NavCollapseType} level={level + 1} parentId={menu.id} />;
      case 'item':
        return <NavItem key={item.id} item={item as NavItemType} level={level + 1} />;
      default:
        return (
          <Typography key={item.id} variant="h6" align="center" sx={{ color: 'error.main' }}>
            Menu Items Error
          </Typography>
        );
    }
  });

  const isSelected = selected === menu.id;

  const Icon = menu.icon;
  const menuIcon = menu.icon ? (
    <Icon strokeWidth={1.5} size={drawerOpen ? '20px' : '24px'} />
  ) : (
    <FiberManualRecordIcon
      sx={{ width: isSelected ? 8 : 6, height: isSelected ? 8 : 6 }}
      fontSize={level > 0 ? 'inherit' : 'medium'}
    />
  );

    // Determine the correct icon based on open state and drawer state
    let collapseIcon;
    if (drawerOpen) { // Full size drawer
        collapseIcon = open ? <IconChevronUp stroke={1.5} size="16px" style={{ marginTop: 'auto', marginBottom: 'auto' }} />
                      : <IconChevronDown stroke={1.5} size="16px" style={{ marginTop: 'auto', marginBottom: 'auto' }} />;
    } else { // Mini drawer
        collapseIcon = <IconChevronRight stroke={1.5} size="16px" style={{ marginTop: 'auto', marginBottom: 'auto' }} />;
    }


  const popperId = openMini ? `collapse-pop-${menu.id}` : undefined;

  // Common SX for ListItemButton
    const listItemButtonSx: SxProps<Theme> = {
        zIndex: 1201,
        borderRadius: `${borderRadius}px`,
        mb: 0.5,
        pl: drawerOpen ? `${level * 24}px` : 1.5,
        py: !drawerOpen && level === 1 ? 1.25 : 1,
        ...(drawerOpen && level === 1 && {
            '&:hover': { bgcolor: 'secondary.light' },
            '&.Mui-selected': {
                bgcolor: 'secondary.light',
                color: 'secondary.dark',
                '&:hover': { bgcolor: 'secondary.light', color: 'secondary.dark' }
            }
        }),
        ...(!drawerOpen && {
            '&:hover': { bgcolor: 'transparent' },
            '&.Mui-selected': {
                '&:hover': { bgcolor: 'transparent' },
                bgcolor: 'transparent'
            }
        }),
         // Indicate selected state even for mini variant hover/popper
         ...(openMini && {
             bgcolor: 'secondary.light', // Or another indicator style
             color: 'secondary.dark',
         })
    };

    // Common SX for ListItemIcon
    const listItemIconSx: SxProps<Theme> = {
        minWidth: !menu.icon ? 18 : 36,
        color: isSelected || openMini ? 'secondary.main' : 'text.primary', // Keep icon colored when popper is open
        ...(!drawerOpen &&
        level === 1 && {
            borderRadius: `${borderRadius}px`,
            width: 46,
            height: 46,
            alignItems: 'center',
            justifyContent: 'center',
            '&:hover': { bgcolor: 'secondary.light' },
            ...( (isSelected || openMini) && { // Keep bg color when popper is open
            bgcolor: 'secondary.light',
            '&:hover': { bgcolor: 'secondary.light' }
            }),
             ...(theme.palette.mode === 'dark' && {
                 color: isSelected || openMini ? 'secondary.main' : 'text.primary', // Adjust dark mode selected color if needed
                 '&:hover': { bgcolor: withAlpha(theme.palette.secondary.main, 0.25) },
                 ...((isSelected || openMini) && {
                     bgcolor: withAlpha(theme.palette.secondary.main, 0.25),
                     '&:hover': { bgcolor: withAlpha(theme.palette.secondary.main, 0.3) }
                 })
             })
        })
    };


  return (
    <>
      {!isHorizontal ? (
        <>
          <ListItemButton
            sx={listItemButtonSx}
            selected={isSelected} // Use isSelected for vertical selected state
            className={openMini ? 'Mui-selected' : ''} // Add selected class when popper is open
            // Attach hover handlers only for mini variant
             {...(!drawerOpen && { onMouseEnter: handleHover, onMouseLeave: handleClosePopper })}
            onClick={handleClick} // Use unified click handler
          >
            {menuIcon && <ListItemIcon sx={listItemIconSx}>{menuIcon}</ListItemIcon>}

            {(drawerOpen || (!drawerOpen && level !== 1)) && (
               <ListItemText
                    primary={
                        <Typography
                            ref={ref}
                            variant={isSelected || openMini ? 'h5' : 'body1'} // Keep text highlighted when popper is open
                            color="inherit"
                             sx={{
                                 whiteSpace: 'nowrap',
                                 overflow: 'hidden',
                                 textOverflow: 'ellipsis',
                                 width: drawerOpen ? 'auto' : 0,
                                 opacity: drawerOpen ? 1 : 0,
                                 transition: 'width 0.3s ease-in-out, opacity 0.3s ease-in-out',
                            }}
                        >
                            <FormattedMessage id={menu.title} defaultMessage={menu.title} />
                        </Typography>
                    }
                    secondary={
                        menu.caption && drawerOpen && (
                            <Typography variant="caption" display="block" gutterBottom sx={{ color: 'text.secondary' }}>
                                <FormattedMessage id={menu.caption} defaultMessage={menu.caption} />
                            </Typography>
                        )
                    }
                />
            )}
            {/* Tooltip for Mini variant */}
             {!drawerOpen && (
                 <Tooltip title={<FormattedMessage id={menu.title} defaultMessage={menu.title} />} placement="right">
                      <Box sx={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: '100%' }} />
                  </Tooltip>
             )}


            {/* Render collapse icon based on state */}
            {collapseIcon}


            {/* Popper for Mini Variant */}
            {!drawerOpen && (
              <Popper
                open={openMini}
                anchorEl={anchorEl}
                placement="right-start"
                style={{ zIndex: 2001 }}
                popperOptions={{
                    modifiers: [
                       { name: 'offset', options: { offset: [-12, 0] } }
                    ]
                 }}

              >
                {({ TransitionProps }) => (
                  <Transitions type="fade" // Use fade or grow
                   {...TransitionProps}>
                    <Paper
                        ref={popperRef} // Add ref to paper
                        sx={{
                            overflow: 'hidden',
                            mt: 0.5, // Adjust margin as needed
                            py: 0.5,
                            boxShadow: theme.shadows[8],
                            backgroundImage: 'none',
                             minWidth: 180,
                            // Add max height and scroll for long menus
                             maxHeight: 'calc(100vh - 100px)', // Example max height
                             overflowY: 'auto',
                      }}
                    >
                      <ClickAwayListener onClickAway={handleCloseMini}>
                        {/* The Box is important for ClickAwayListener */}
                        <Box>{menus}</Box>
                      </ClickAwayListener>
                    </Paper>
                  </Transitions>
                )}
              </Popper>
            )}
          </ListItemButton>

          {/* Vertical Collapse */}
          {drawerOpen && (
            <Collapse in={open} timeout="auto" unmountOnExit>
              {open && (
                <List
                  component="div" // Use div for semantic correctness
                  disablePadding
                  sx={{
                    position: 'relative',
                    '&:after': {
                      content: "''",
                      position: 'absolute',
                      left: '32px', // Adjust based on icon width + padding
                      top: 0,
                      height: '100%',
                      width: '1px',
                      opacity: 1,
                      // Use theme variables for the line color
                      bgcolor: theme.palette.mode === 'dark' ? withAlpha(theme.palette.grey[800], 0.2) : theme.palette.primary.light,
                    }
                  }}
                >
                  {menus}
                </List>
              )}
            </Collapse>
          )}
        </>
      ) : (
          // Horizontal Layout specific rendering (simplified)
            <ListItemButton
                 id={`boundary-${popperId}`}
                 disableRipple
                 selected={isSelected}
                 onMouseEnter={handleHover}
                 onMouseLeave={handleClosePopper}
                 onClick={handleHover} // Open popper on click as well for touch devices?
                 aria-describedby={popperId}
                 className={openMini ? 'Mui-selected' : ''} // Add selected class
                 sx={{ borderRadius: `${borderRadius}px`, pl: 1, pr: 1 }} // Adjust padding
            >
             {menuIcon && <ListItemIcon sx={{ my: 'auto', minWidth: !menu.icon ? 18 : 36 }}>{menuIcon}</ListItemIcon>}
             <ListItemText
                primary={
                    <Typography variant={isSelected ? 'h5' : 'body1'} color="inherit">
                         <FormattedMessage id={menu.title} defaultMessage={menu.title} />
                    </Typography>
                }
             />
             {openMini ? <IconChevronRight stroke={1.5} size="16px" /> : <IconChevronDown stroke={1.5} size="16px" />}

             {anchorEl && (
                 <PopperStyled // Use the styled Popper
                    id={popperId}
                    open={openMini}
                    anchorEl={anchorEl}
                    placement="right-start" // Or adjust as needed
                    modifiers={[ { name: 'offset', options: { offset: [-10, 0] } } ]}
                 >
                    {({ TransitionProps }) => (
                       <Transitions type="fade" // Or 'grow'
                         {...TransitionProps}>
                         <Paper sx={{ overflow: 'hidden', mt: 1.5, py: 0.5, boxShadow: theme.shadows[8], backgroundImage: 'none' }}>
                           <ClickAwayListener onClickAway={handleClosePopper}>
                             <Box sx={{ maxHeight: 'calc(100vh - 170px)', overflowY: 'auto' }}>{menus}</Box>
                           </ClickAwayListener>
                         </Paper>
                       </Transitions>
                    )}
                 </PopperStyled>
              )}
         </ListItemButton>
      )}
    </>
  );
};

export default NavCollapse;