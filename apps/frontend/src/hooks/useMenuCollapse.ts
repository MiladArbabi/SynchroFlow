// apps/frontend/src/hooks/useMenuCollapse.ts
import { useEffect } from 'react';
import { matchPath } from 'react-router-dom';

// Define the structure of a menu item (can be refined)
interface MenuItem {
  id: string;
  type: 'item' | 'collapse';
  url?: string;
  link?: string; // Optional alternative link
  children?: MenuItem[];
}

// ==============================|| SIDEBAR - MENU COLLAPSE HOOKS ||============================== //

/**
 * Hook to manage the collapse state of menu items based on the current route.
 * @param {MenuItem} menu - The menu item configuration (likely a NavCollapseType).
 * @param {string} pathname - The current window location pathname.
 * @param {boolean} openMini - Whether the mini variant popper is currently open.
 * @param {(id: string | null) => void} setSelected - Function to set the selected menu item ID.
 * @param {(open: boolean) => void} setOpen - Function to set the open state of the collapse.
 * @param {(el: HTMLElement | null) => void} setAnchorEl - Function to set the anchor element for the popper.
 */
const useMenuCollapse = (
    selected: string | null,
    menu: MenuItem,
    pathname: string,
    openMini: boolean,
    setSelected: (id: string | null) => void,
    setOpen: (open: boolean) => void,
    setAnchorEl: (el: HTMLElement | null) => void // Assume setAnchorEl comes from NavCollapse state
): void => {

  // Recursive function to check if any child matches the current path
  const checkOpenForParent = (child: MenuItem[], id: string): boolean => {
    let matchFound = false;
    child.forEach((item) => {
      if (item.type === 'item') {
        // Check item URL match
         if (item.url && matchPath({ path: item.link ? item.link : item.url, end: false }, pathname)) {
            setSelected(id); // Select the parent ID
            setOpen(true); // Open the parent collapse
             matchFound = true;
        }
      }
      if (item.type === 'collapse' && item.children) {
        // Recursively check children of collapse
        if (checkOpenForParent(item.children, id)) {
            matchFound = true; // If a deeper child matches, keep parent open
        }
      }
    });
    return matchFound; // Return if a match was found in this branch
  };


  useEffect(() => {
    // Close the main vertical collapse if the mini popper is open
    if (openMini) {
      setOpen(false); // Close vertical collapse
      // setSelected(null); // Optionally deselect when popper opens, depending on desired UX
    } else {
         // If not in mini mode, check if any children match the current path
         let isChildSelected = false;
         if (menu.children) {
             isChildSelected = checkOpenForParent(menu.children, menu.id);
         }

         // If the menu item itself matches the path (e.g., a collapse with its own URL)
         const selfSelected = menu.url && matchPath({ path: menu.link ? menu.link : menu.url, end: false }, pathname);

         if (selfSelected || isChildSelected) {
             // Keep selected and open if self or child is selected
             if (selected !== menu.id) setSelected(menu.id); // Select if not already
             if (!open) setOpen(true); // Open if not already
         } else {
              // If neither self nor child is selected, potentially close and deselect
              // This part depends heavily on the desired UX (e.g., should collapses close automatically?)
              // Maybe only deselect if the selected ID *was* this menu's ID
               if (selected === menu.id) {
                   // Keep it open for now, maybe handle closing elsewhere or based on direct user action
                   // setOpen(false); // Example: Close if no child selected
                   // setSelected(null); // Example: Deselect if no child selected
               }
         }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname, menu, openMini, setSelected, setOpen, setAnchorEl]); // Rerun when dependencies change
};

export default useMenuCollapse;