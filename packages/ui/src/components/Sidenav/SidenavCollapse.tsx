// packages/ui/src/components/Sidenav/SidenavCollapse.tsx
import React from 'react';
import ListItem from "@mui/material/ListItem";
import ListItemIcon from "@mui/material/ListItemIcon";
import ListItemText from "@mui/material/ListItemText";
import MDBox from '../MDBox';
import {
  collapseItem,
  collapseIconBox,
  collapseIcon,
  collapseText,
} from "../Sidenav/styles/sidenavCollapse";
import { useMaterialUIController } from '../../contexts/MaterialUI';

// Define the props for the component
interface SidenavCollapseProps {
  icon: React.ReactNode;
  name: string;
  active?: boolean;
  [key: string]: unknown;
}

export const SidenavCollapse: React.FC<SidenavCollapseProps> = ({ icon, name, active = false, ...rest }) => {
  const [controller] = useMaterialUIController();
  const { miniSidenav, transparentSidenav, whiteSidenav, darkMode, sidenavColor } = controller;

  return (
    <ListItem component="li">
      <MDBox
        {...rest}
        sx={(theme: unknown) =>
          collapseItem(theme, {
            active,
            transparentSidenav,
            whiteSidenav,
            darkMode,
            sidenavColor,
          })
        }
      >
        <ListItemIcon
          sx={(theme: unknown) => ({
            ...collapseIconBox(theme, {
              transparentSidenav, whiteSidenav, darkMode, active,
              sidenavColor: 'info'
            }),
            fontSize: "1.375rem",
          })}
        >
          {icon}
          </ListItemIcon>
        <ListItemText
          primary={name}
          sx={(theme: unknown) =>
            collapseText(theme, {
              miniSidenav,
              transparentSidenav,
              whiteSidenav,
              active,
              darkMode: false,
              sidenavColor: 'info'
            })
          }
        />
      </MDBox>
    </ListItem>
  );
}

export default SidenavCollapse;