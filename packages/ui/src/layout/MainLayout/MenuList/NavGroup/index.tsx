/* eslint-disable @typescript-eslint/no-unused-vars */
/* eslint-disable @typescript-eslint/no-explicit-any */
// packages/ui/src/layout/MainLayout/MenuList/NavGroup/index.tsx
import React, { Fragment, useEffect, useState, useContext, JSX, useRef } from 'react';
import { matchPath, useLocation } from 'react-router-dom';

// material-ui
import { useTheme, Theme } from '@mui/material/styles';
import useMediaQuery from '@mui/material/useMediaQuery';
import ClickAwayListener from '@mui/material/ClickAwayListener';
import Divider from '@mui/material/Divider';
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


// project imports
import NavCollapse from '../NavCollapse';
import NavItem, { NavItemType } from '../NavItem'; // Import NavItemType

import { MenuOrientation, HORIZONTAL_MAX_ITEM } from 'config'; // Import HORIZONTAL_MAX_ITEM
import useConfig, { ConfigContext } from 'hooks/useConfig'; // Import ConfigContext
import Transitions from 'ui-component/extended/Transitions';
import { useGetMenuMaster } from 'api/menu'; // Uses our refactored hook

// third party
import { FormattedMessage } from 'react-intl';

// assets
import { IconChevronDown, IconChevronRight, IconChevronUp, IconMinusVertical, TablerIconsProps } from '@tabler/icons-react';

// Define the NavGroupType structure (children can be NavCollapse or NavItem)
interface NavGroupType {
  id: string;
  title: string; // Message ID
  type: 'group';
  icon?: (props: TablerIconsProps) => JSX.Element;
  children?: (NavItemType | /* NavCollapseType should be imported here */ any)[]; // Use imported types
  caption?: string; // Message ID
  url?: string; // Optional URL for the group itself (used in horizontal)
}

// Define the type for remaining items in horizontal mode
interface RemItemType {
    title?: string; // Optional title for the "More" section sub-group
    elements: (NavItemType | /* NavCollapseType */ any)[];
    icon?: (props: TablerIconsProps) => JSX.Element;
    url?: string;
}


// Define component props
interface NavGroupProps {
  item: NavGroupType;
  lastItem?: number; // Index of the last item shown directly in horizontal mode
  remItems?: RemItemType[]; // Items to be shown in the "More" dropdown
  lastItemId?: string; // ID of the last item shown directly
    selectedID: string | null; // ID of the currently selected item/group
    setSelectedID: (id: string | null) => void; // Function to set selected ID
}


const NavGroup: React.FC<NavGroupProps> = ({ item, lastItem, remItems = [], lastItemId, selectedID, setSelectedID }) => {
  const theme = useTheme();
  const downMD = useMediaQuery(theme.breakpoints.down('md'));
    const ref = useRef<HTMLDivElement>(null); // Ref for text overflow check

  const { pathname } = useLocation();

  const {
    state: { menuOrientation, borderRadius }
  } = useConfig();
   const { dispatch } = useContext(ConfigContext); // Get dispatch

  const { menuMaster } = useGetMenuMaster();
  const drawerOpen = menuMaster.isDashboardDrawerOpened;
  const isHorizontal = menuOrientation === MenuOrientation.HORIZONTAL && !downMD;

  const [anchorEl, setAnchorEl] = useState<null | HTMLElement>(null);
  const [currentItem, setCurrentItem] = useState(item); // State to hold potentially modified item for "More"

  const openMini = Boolean(anchorEl);

  // --- State for text overflow tooltip ---
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
    // --- End text overflow ---

    // Update currentItem for "More" dropdown logic in horizontal mode
  useEffect(() => {
    if (isHorizontal && lastItem && item.id === lastItemId) {
      const localItem = { ...item };
      // Flatten children from remItems into the current item's children for the Popper
      const elements = remItems.map((ele) => ele.elements);
      localItem.children = elements.flat(1);
      setCurrentItem(localItem);
    } else {
      setCurrentItem(item); // Reset or use original item
    }
  }, [item, lastItem, isHorizontal, remItems, lastItemId]);

  // Check if any child item is currently selected to highlight the group
   const checkOpenForParent = (child: (NavItemType | /* NavCollapseType */ any)[], id: string) => {
     child.forEach((ele) => {
       if (ele.type === 'collapse' && ele.children?.length) {
         checkOpenForParent(ele.children, id);
       }
       // Check URL match for items
       if (ele.type === 'item' && ele.url && matchPath({ path: ele.url, end: false }, pathname)) {
         setSelectedID(id); // Select the group if a child matches
       }
     });
   };

    // Run check on load and path change
    useEffect(() => {
        let isChildSelected = false;
        const childrens = currentItem.children || [];
        childrens.forEach((itemCheck) => {
            if (itemCheck.type === 'item' && itemCheck.url && matchPath({ path: itemCheck.url, end: false }, pathname)) {
                isChildSelected = true;
            }
            if (itemCheck.type === 'collapse' && itemCheck.children) {
                 // Recursively check collapse children
                 const checkCollapse = (items: any[]): boolean => {
                     for (const subItem of items) {
                         if (subItem.type === 'item' && subItem.url && matchPath({ path: subItem.url, end: false }, pathname)) return true;
                         if (subItem.type === 'collapse' && subItem.children && checkCollapse(subItem.children)) return true;
                     }
                     return false;
                 }
                 if(checkCollapse(itemCheck.children)) isChildSelected = true;
            }
        });

        if (isChildSelected) {
            setSelectedID(currentItem.id);
        } else if (selectedID === currentItem.id) {
             // If no child is selected anymore, but the group was, deselect it
             // This logic might need refinement depending on desired behavior
             // setSelectedID(null);
        }

        // Close horizontal popper on path change
        if (openMini) setAnchorEl(null);

    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [pathname, currentItem]); // Re-run when path or item changes


  const handleClick = (event: React.MouseEvent<HTMLElement>) => {
    if (!openMini) {
      setAnchorEl(event.currentTarget);
    }
  };

   const handleHover = (event: React.MouseEvent<HTMLElement>) => {
       if (isHorizontal) { // Only use hover for horizontal
           setAnchorEl(event.currentTarget);
       }
   };

   const handleClosePopper = () => {
       setAnchorEl(null);
   };

    // Close popper on click away
    const handleCloseMini = (event: MouseEvent | TouchEvent) => {
        if (anchorEl && anchorEl.contains(event.target as Node)) {
            return;
        }
        handleClosePopper();
    };

  const Icon = currentItem?.icon;
  const itemIcon = currentItem?.icon ? <Icon stroke={1.5} size="20px" /> : null;

  // menu list collapse & items
  const items = currentItem.children?.map((menu) => {
    switch (menu?.type) {
      case 'collapse':
        // Pass selectedID and setSelectedID down to NavCollapse
        return <NavCollapse key={menu.id} menu={menu} level={1} parentId={currentItem.id} />;
      case 'item':
        // Pass setSelectedID down to NavItem (used for clearing selection in horizontal)
        return <NavItem key={menu.id} item={menu} level={1} setSelectedID={setSelectedID} />;
      default:
        return (
          <Typography key={menu?.id} variant="h6" align="center" sx={{ color: 'error.main' }}>
            Menu Items Error
          </Typography>
        );
    }
  });

   // Items for the "More" dropdown in horizontal mode
   const moreItems = remItems.map((itemRem, i) => (
     <Fragment key={i}>
       {/* Render NavItem if the remItem itself has a URL */}
       {itemRem.url ? (
         <NavItem item={itemRem as unknown as NavItemType} level={1} setSelectedID={setSelectedID} />
       ) : (
         // Render a title Typography if it exists (for sub-sections in "More")
         itemRem.title && (
           <Typography variant="caption" sx={{ pl: 2, pt: 1, pb: 0.5, display: 'block' }} color="textSecondary">
              <FormattedMessage id={itemRem.title} defaultMessage={itemRem.title} />
           </Typography>
         )
       )}
       {/* Render the elements (children) of this remItem */}
       {itemRem?.elements?.map((menu) => {
         switch (menu?.type) {
           case 'collapse':
             return <NavCollapse key={menu.id} menu={menu} level={1} parentId={currentItem.id} />;
           case 'item':
             return <NavItem key={menu.id} item={menu} level={1} setSelectedID={setSelectedID} />;
           default:
             return (
               <Typography key={menu.id} variant="h6" align="center" sx={{ color: 'error.main' }}>
                 Menu Items Error
               </Typography>
             );
         }
       })}
     </Fragment>
   ));


  const popperId = openMini ? `group-pop-${item.id}` : undefined;
  const isSelected = selectedID === currentItem.id;

  // Common SX for vertical group subheader
    const subheaderSx: SxProps<Theme> = {
        display: 'block',
        fontSize: '0.875rem',
        fontWeight: 500,
        color: 'text.secondary', // Use secondary for less emphasis
        padding: '6px 16px', // Adjust padding
        textTransform: 'uppercase', // Keep uppercase
        marginTop: 1.5,
        // Hide when drawer is closed
        opacity: drawerOpen ? 1 : 0,
        transition: 'opacity 0.3s ease-in-out',
        width: drawerOpen ? 'auto' : 0,
        overflow: 'hidden',
        whiteSpace: 'nowrap'
    };


  return (
    <>
      {!isHorizontal ? (
        // --- Vertical Group ---
        <>
          <List
            disablePadding={!drawerOpen}
            subheader={
              currentItem.title &&
              drawerOpen && ( // Only show subheader when drawer is open
                 <Typography variant="caption" sx={subheaderSx} >
                    <FormattedMessage id={currentItem.title} defaultMessage={currentItem.title} />
                      {/* Optional Caption below title */}
                      {currentItem.caption && drawerOpen && (
                          <Typography variant="caption" display="block" sx={{ fontSize: '0.6875rem', fontWeight: 400, color: 'text.disabled', lineHeight: 1.66 }}>
                              <FormattedMessage id={currentItem.caption} defaultMessage={currentItem.caption} />
                          </Typography>
                      )}
                 </Typography>
              )
            }
          >
            {items}
          </List>

          {/* group divider */}
          {drawerOpen && <Divider sx={{ mt: 0.25, mb: 1.25 }} />}
        </>
      ) : (
          // --- Horizontal Group Trigger ---
        <List>
          <ListItemButton
            selected={isSelected}
            sx={{
              borderRadius: `${borderRadius}px`,
              p: 1,
              my: 0.5,
              mr: 1,
              display: 'flex',
              alignItems: 'center',
              backgroundColor: 'inherit',
               '&.Mui-selected': { // Styles for selected horizontal group item
                   bgcolor: 'secondary.light',
                   color: 'secondary.dark',
                    '&:hover': {
                        bgcolor: 'secondary.light',
                        color: 'secondary.dark',
                    }
               },
                ...(openMini && { // Style when popper is open
                    bgcolor: 'secondary.light',
                    color: 'secondary.dark',
                })
            }}
             onMouseEnter={handleHover}
             onClick={handleClick} // Keep click for touch devices
             onMouseLeave={handleClosePopper}
            aria-describedby={popperId}
            //className={openMini ? 'Mui-selected' : ''} // Use openMini to drive selected style
          >
            {itemIcon && (
              <ListItemIcon sx={{ minWidth: 36 }}>
                {/* Render "More" icon or normal icon */}
                {currentItem.id === lastItemId ? <IconMinusVertical stroke={1.5} size="20px" /> : itemIcon}
              </ListItemIcon>
            )}
            <ListItemText
              sx={{ mr: 1, mb: 0 }}
              primary={
                 <Typography ref={ref} variant={isSelected || openMini ? 'h5' : 'body1'} color="inherit" sx={{ whiteSpace: 'nowrap' }}>
                     {/* Render "More Items" or normal title */}
                     {currentItem.id === lastItemId ? <FormattedMessage id="more-items" defaultMessage="More" /> : <FormattedMessage id={currentItem.title} defaultMessage={currentItem.title} />}
                 </Typography>
              }
            />
             {/* Use Tooltip only if text overflows */}
            {hoverStatus && (
                <Tooltip title={<FormattedMessage id={currentItem.title} defaultMessage={currentItem.title}/>} placement="bottom-start">
                     <Box sx={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: '100%' }} />
                 </Tooltip>
            )}

            {/* Popper open/close icon */}
            {openMini ? <IconChevronUp stroke={1.5} size="16px" /> : <IconChevronDown stroke={1.5} size="16px" />}

             {/* Popper for Horizontal Menu */}
             {anchorEl && (
                <Popper
                    id={popperId}
                    open={openMini}
                    anchorEl={anchorEl}
                    placement="bottom-start" // Or 'bottom' if preferred
                    sx={{
                        zIndex: 2001,
                        minWidth: 180,
                        // Arrow style (optional, can be complex)
                        // '&:before': { ... }
                    }}
                     modifiers={[ { name: 'offset', options: { offset: [0, 5] } } ]} // Offset slightly below button
                >
                    {({ TransitionProps }) => (
                        <Transitions type="fade" // Or 'grow'
                         in={openMini} {...TransitionProps}>
                            <Paper sx={{ mt: 0.5, py: 1, boxShadow: theme.shadows[8], backgroundImage: 'none' }}>
                                <ClickAwayListener onClickAway={handleCloseMini}>
                                    <Box
                                        sx={{
                                            maxHeight: 'calc(100vh - 170px)',
                                            overflowY: 'auto',
                                            // Scrollbar styling (optional)
                                            '&::-webkit-scrollbar': { width: 4, opacity: 0, '&:hover': { opacity: 0.7 } },
                                            '&::-webkit-scrollbar-track': { bgcolor: 'transparent' },
                                            '&::-webkit-scrollbar-thumb': { bgcolor: 'divider', borderRadius: 4 }
                                        }}
                                    >
                                        {/* Render normal items or "More" items */}
                                        {currentItem.id === lastItemId ? moreItems : items}
                                    </Box>
                                </ClickAwayListener>
                            </Paper>
                        </Transitions>
                    )}
                </Popper>
            )}
          </ListItemButton>
        </List>
      )}
    </>
  );
};

export default NavGroup;