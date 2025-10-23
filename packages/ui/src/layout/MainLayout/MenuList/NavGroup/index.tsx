/* eslint-disable @typescript-eslint/no-unused-vars */
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
import NavItem from '../NavItem';
import { NavItemType } from '../NavItem';
import { 
  NavGroupType as MenuNavGroupType,
  NavItemType as MenuNavItemType, 
  NavCollapseType,
  MenuItem } from 'menu-items/types';

import { MenuOrientation, HORIZONTAL_MAX_ITEM } from 'config';
import useConfig from 'hooks/useConfig';
import {ConfigContext} from 'contexts/ConfigContext';
import Transitions from 'ui-component/extended/Transitions';
import { useGetMenuMaster } from 'api/menu';

// third party
import { FormattedMessage } from 'react-intl';

// assets
import { IconChevronDown, IconMinusVertical, IconChevronUp } from '@tabler/icons-react';
import { LucideProps } from 'lucide-react';

// Define the type for remaining items in horizontal mode
interface RemItemType {
  title?: string;
  elements?: MenuItem[];
  icon?: React.FC<LucideProps>;
  url?: string;
  id?: string;
  type?: 'item' | 'group' | 'collapse';
  target?: boolean;
  disabled?: boolean;
}

// Define component props
interface NavGroupProps {
  item: MenuNavGroupType;
  lastItem?: number | null;
  remItems?: RemItemType[];
  lastItemId?: string;
  selectedID: string | null;
  setSelectedID: (id: string | null) => void;
}

function NavGroup ({ item, lastItem, remItems = [], lastItemId, selectedID, setSelectedID }: NavGroupProps) {
  const theme = useTheme();
  const downMD = useMediaQuery(theme.breakpoints.down('md'));
  const ref = useRef<HTMLDivElement>(null);

  const { pathname } = useLocation();

  const {
    state: { menuOrientation, borderRadius }
  } = useConfig();
  const { dispatch } = useContext(ConfigContext);

  const { menuMaster } = useGetMenuMaster();
  const drawerOpen = menuMaster.isDashboardDrawerOpened;
  const isHorizontal = menuOrientation === MenuOrientation.HORIZONTAL && !downMD;

  const [anchorEl, setAnchorEl] = useState<null | HTMLElement>(null);
  const [currentItem, setCurrentItem] = useState<MenuNavGroupType>(item);

  const openMini = Boolean(anchorEl);

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

  useEffect(() => {
    if (isHorizontal && lastItem && item.id === lastItemId) {
      const localItem = { ...item };
      const elements = remItems.flatMap((ele) => ele.elements || []);
      localItem.children = elements;
      setCurrentItem(localItem);
    } else {
      setCurrentItem(item);
    }
  }, [item, lastItem, isHorizontal, remItems, lastItemId]);

  const checkOpenForParent = (child: MenuItem[], id: string) => {
    child.forEach((ele) => {
      if (ele.type === 'collapse' && ele.children?.length) {
        checkOpenForParent(ele.children, id);
      }
      if (ele.type === 'item' && ele.url && matchPath({ path: ele.url, end: false }, pathname)) {
        setSelectedID(id);
      }
    });
  };

  useEffect(() => {
    let isChildSelected = false;
    const childrens: MenuItem[] = currentItem.children || [];
    childrens.forEach((itemCheck) => {
      if (itemCheck.type === 'item' && itemCheck.url && matchPath({ path: itemCheck.url, end: false }, pathname)) {
        isChildSelected = true;
      }
      if (itemCheck.type === 'collapse' && itemCheck.children) { // Ensure children exist
        const checkCollapse = (items: MenuItem[]): boolean => {
          for (const subItem of items) {
            if (subItem.type === 'item' && subItem.url && matchPath({ path: subItem.url, end: false }, pathname)) return true;
            if (subItem.type === 'collapse' && subItem.children && checkCollapse(subItem.children)) return true;
          }
          return false;
        };
        if (checkCollapse(itemCheck.children)) isChildSelected = true;
      }
    });

    if (isChildSelected) {
      setSelectedID(currentItem.id);
    }

    if (openMini) setAnchorEl(null);
  }, [pathname, currentItem, openMini, setSelectedID]);

  const handleClick = (event: React.MouseEvent<HTMLElement>) => {
    if (!openMini) {
      setAnchorEl(event.currentTarget);
    }
  };

  const handleHover = (event: React.MouseEvent<HTMLElement>) => {
    if (isHorizontal) {
      setAnchorEl(event.currentTarget);
    }
  };

  const handleClosePopper = () => {
    setAnchorEl(null);
  };

  const handleCloseMini = (event: MouseEvent | TouchEvent) => {
    if (anchorEl && anchorEl.contains(event.target as Node)) {
      return;
    }
    handleClosePopper();
  };

  const Icon = currentItem?.icon;
  const itemIcon = currentItem?.icon ? <Icon stroke="1.5" size="20px" /> : null;

  const items = currentItem.children?.map((menu: MenuItem) => {
    switch (menu.type) {
      case 'collapse':
        return <NavCollapse key={menu.id} menu={menu as NavCollapseType} level={1} parentId={currentItem.id} />;
      case 'item':
        return <NavItem key={menu.id} item={menu as MenuNavItemType} level={1} setSelectedID={() => setSelectedID(null)} />; 
      default: {
        return (
          <Typography key={menu.id} variant="h6" align="center" sx={{ color: 'error.main' }}>
            Menu Items Error
          </Typography>
        );
      }
    }
  });

  const moreItems = remItems?.map((itemRem: RemItemType, i: number) => (
    <Fragment key={i}>
      {itemRem.url ? (
       <NavItem item={itemRem as MenuNavItemType} level={1} setSelectedID={() => setSelectedID(null)} /> // Use MenuNavItemType
      ) : (
        itemRem.title && (
          <Typography variant="caption" sx={{ pl: 2, pt: 1, pb: 0.5, display: 'block' }} color="textSecondary">
            <FormattedMessage id={itemRem.title} defaultMessage={itemRem.title} />
          </Typography>
        )
      )}
        {itemRem?.elements?.map((menu: MenuItem) => {
        switch (menu.type) {
          case 'collapse':
            return <NavCollapse key={menu.id} menu={menu as NavCollapseType} level={1} parentId={currentItem.id} />;
          case 'item':
            return <NavItem key={menu.id} item={menu as MenuNavItemType} level={1} setSelectedID={() => setSelectedID(null)} />;
          default: {
            return (
              <Typography key={menu.id} variant="h6" align="center" sx={{ color: 'error.main' }}>
                Menu Items Error
              </Typography>
            );
          }
        }
      })}
    </Fragment>
  ));

  const popperId = openMini ? `group-pop-${item.id}` : undefined;
  const isSelected = selectedID === currentItem.id;

  const subheaderSx: SxProps<Theme> = {
    display: 'block',
    fontSize: '0.875rem',
    fontWeight: 500,
    color: 'text.secondary',
    padding: '6px 16px',
    textTransform: 'uppercase',
    marginTop: 1.5,
    opacity: drawerOpen ? 1 : 0,
    transition: 'opacity 0.3s ease-in-out',
    width: drawerOpen ? 'auto' : 0,
    overflow: 'hidden',
    whiteSpace: 'nowrap'
  };

  return (
    <>
      {!isHorizontal ? (
        <>
          <List
            disablePadding={!drawerOpen}
            subheader={
              currentItem.title &&
              drawerOpen && (
                <Typography variant="caption" sx={subheaderSx}>
                  <FormattedMessage id={currentItem.title} defaultMessage={currentItem.title} />
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

          {drawerOpen && <Divider sx={{ mt: 0.25, mb: 1.25 }} />}
        </>
      ) : (
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
              '&.Mui-selected': {
                bgcolor: 'secondary.light',
                color: 'secondary.dark',
                '&:hover': {
                  bgcolor: 'secondary.light',
                  color: 'secondary.dark',
                }
              },
              ...(openMini && {
                bgcolor: 'secondary.light',
                color: 'secondary.dark',
              })
            }}
            onMouseEnter={handleHover}
            onClick={handleClick}
            onMouseLeave={handleClosePopper}
            aria-describedby={popperId}
          >
            {itemIcon && (
              <ListItemIcon sx={{ minWidth: 36 }}>
                {currentItem.id === lastItemId ? <IconMinusVertical stroke="1.5" size="20px" /> : itemIcon}
              </ListItemIcon>
            )}
            <ListItemText
              sx={{ mr: 1, mb: 0 }}
              primary={
                <Typography ref={ref} variant={isSelected || openMini ? 'h5' : 'body1'} color="inherit" sx={{ whiteSpace: 'nowrap' }}>
                  {currentItem.id === lastItemId ? <FormattedMessage id="more-items" defaultMessage="More" /> : <FormattedMessage id={currentItem.title} defaultMessage={currentItem.title} />}
                </Typography>
              }
            />
            {hoverStatus && (
              <Tooltip title={<FormattedMessage id={currentItem.title} defaultMessage={currentItem.title} />} placement="bottom-start">
                <Box sx={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: '100%' }} />
              </Tooltip>
            )}

            {openMini ? <IconChevronUp stroke="1.5" size="16px" /> : <IconChevronDown stroke="1.5" size="16px" />}

            {anchorEl && (
              <Popper
                id={popperId}
                open={openMini}
                anchorEl={anchorEl}
                placement="bottom-start"
                sx={{
                  zIndex: 2001,
                  minWidth: 180,
                }}
                modifiers={[{ name: 'offset', options: { offset: [0, 5] } }]}
              >
                {({ TransitionProps }) => (
                  <Transitions type="fade" in={openMini} {...TransitionProps}>
                    <Paper sx={{ mt: 0.5, py: 1, boxShadow: theme.shadows[8], backgroundImage: 'none' }}>
                      <ClickAwayListener onClickAway={handleCloseMini}>
                        <Box
                          sx={{
                            maxHeight: 'calc(100vh - 170px)',
                            overflowY: 'auto',
                            '&::-webkit-scrollbar': { width: 4, opacity: 0, '&:hover': { opacity: 0.7 } },
                            '&::-webkit-scrollbar-track': { bgcolor: 'transparent' },
                            '&::-webkit-scrollbar-thumb': { bgcolor: 'divider', borderRadius: 4 }
                          }}
                        >
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