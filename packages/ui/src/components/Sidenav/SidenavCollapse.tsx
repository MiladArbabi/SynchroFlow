// packages/ui/src/components/Sidenav/SidenavCollapse.tsx
import React from 'react';
import { Theme } from "@mui/material/styles";
import ListItem from "@mui/material/ListItem";
import ListItemIcon from "@mui/material/ListItemIcon";
import ListItemText from "@mui/material/ListItemText";
import MDBox from '../MDBox';
import {
  collapseItem,
  collapseIconBox,
  collapseText,
} from "../Sidenav/styles/sidenavCollapse";

// Define the props for the component
interface SidenavCollapseProps {
  icon: React.ReactNode;
  name: string;
  active?: boolean;
  [key: string]: unknown;
}

export const SidenavCollapse: React.FC<SidenavCollapseProps> = ({ icon, name, active = false, ...rest }) => {
  return (
    <ListItem component="li">
      <MDBox
        {...rest}
        sx={(theme: Theme) =>
          collapseItem(theme, {
            active
          })
        }
      >
        <ListItemIcon
          sx={(theme: unknown) => ({
            ...collapseIconBox(theme, {
              active,
            }),
          })}
        >
          {icon}
        </ListItemIcon>
        <ListItemText
          primary={name}
          sx={(theme: Theme) => collapseText(theme, { active })}
        />
      </MDBox>
    </ListItem>
  );
}

export default SidenavCollapse;