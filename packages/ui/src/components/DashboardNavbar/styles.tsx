// packages/ui/src/components/DashboardNavbar/styles.ts

import { Theme } from "@mui/material/styles";
import { alpha } from "@mui/material/styles";

function navbar(theme: Theme, ownerState: { absolute?: boolean; light?: boolean; }) {
  const { palette, shadows } = theme;
  const { background, common } = palette;
  const { absolute } = ownerState;

  return {
    boxShadow: shadows[2],
    backdropFilter: `saturate(200%) blur(30px)`,
    backgroundColor: alpha(common.white, 0.8),
    color: background.default,
    top: absolute ? 0 : "1rem",
    minHeight: "75px",
    display: "grid",
    alignItems: "center",
    borderRadius: "0.75rem",
    padding: "0.5rem 1rem",
    "&.MuiToolbar-root": {
      display: "flex",
      justifyContent: "space-between",
      alignItems: "center",
    },
  };
}

const navbarContainer = (theme: Theme) => ({
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  width: "100%",
});

const navbarRow = (theme: Theme) => ({
  display: "flex",
  alignItems: "center",
});

// FIX: Simplified the theme access to be compatible with the default theme.
const navbarIconButton = (theme: Theme) => ({
  padding: `0.25rem 0.5rem`,
  "& .MuiIcon-root": {
    fontSize: "1.5rem", // Use a static size
  },
});

export {
  navbar,
  navbarContainer,
  navbarRow,
  navbarIconButton,
};