// apps/frontend/src/components/SidenavCollapse/index.tsx
import React from "react";
import ListItemIcon from "@mui/material/ListItemIcon";
import ListItemText from "@mui/material/ListItemText";
import { Box } from "@mui/material";
import { useTheme } from "@mui/material/styles";

interface SidenavCollapseProps {
  icon: React.ReactNode;
  name: string;
  active?: boolean;
}

const SidenavCollapse: React.FC<SidenavCollapseProps> = ({ icon, name, active = false }) => {
  const theme = useTheme();

  return (
    <Box
      sx={{
        display: "flex",
        alignItems: "center",
        width: "100%",
        padding: "0.75rem 1rem",
        margin: "0.125rem 1rem",
        borderRadius: theme.shape.borderRadius,
        cursor: "pointer",
        userSelect: "none",
        backgroundColor: active ? theme.palette.action.selected : "transparent",
        color: active ? "inherit" : theme.palette.text.secondary,
        transition: "background-color 200ms ease-in-out, color 200ms ease-in-out",

        "&:hover": {
          backgroundColor: !active && theme.palette.action.hover,
        },
      }}
    >
      <ListItemIcon sx={{ minWidth: "auto", marginRight: "1rem", color: "inherit", fontSize: '1.25rem' }}>
        {icon}
      </ListItemIcon>
      <ListItemText
        primary={name}
        primaryTypographyProps={{
          variant: "button",
          fontWeight: "medium",
          color: "inherit",
          sx: { opacity: 1 }
        }}
      />
    </Box>
  );
};

export default SidenavCollapse;