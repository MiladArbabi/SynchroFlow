// packages/ui/src/components/Sidenav/styles/sidenavCollapse.tsx

import { Theme } from "@mui/material/styles";

// Define a simple, clean type for the component's state
interface OwnerState {
  active: boolean;
}

// --- REWRITTEN STYLING FUNCTIONS ---

// This function styles the main container of the navigation item
function collapseItem(theme: Theme, { active }: OwnerState) {
  const { palette, shape, transitions, shadows } = theme;

  return {
    display: "flex",
    alignItems: "center",
    width: "100%",
    padding: "0.5rem 1rem",
    margin: "0.1rem 0",
    borderRadius: shape.borderRadius,
    cursor: "pointer",
    userSelect: "none",
    whiteSpace: "nowrap",
    transition: transitions.create(["background-color", "box-shadow"], {
      easing: transitions.easing.easeInOut,
      duration: transitions.duration.shorter,
    }),

    // Apply active styles
    ...(active && {
      backgroundColor: palette.primary.main,
      color: palette.primary.contrastText,
      boxShadow: shadows[3],
    }),

    // Apply hover styles
    "&:hover, &:focus": {
      backgroundColor: active ? undefined : palette.action.hover,
    },
  };
}

// This function styles the box that contains the icon
function collapseIconBox(theme: Theme, { active }: OwnerState) {
  return {
    minWidth: "32px",
    minHeight: "32px",
    color: active ? theme.palette.primary.contrastText : theme.palette.text.secondary,
    borderRadius: theme.shape.borderRadius,
    display: "grid",
    placeItems: "center",
    transition: theme.transitions.create("color", {
      easing: theme.transitions.easing.easeInOut,
      duration: theme.transitions.duration.standard,
    }),
  };
}

// This function styles the icon itself
const collapseIcon = (theme: Theme, { active }: OwnerState) => ({
  color: "inherit", // Inherit color from the parent (collapseIconBox)
});

// This function styles the text label
function collapseText(theme: Theme, { active }: OwnerState) {
  const { typography } = theme;

  return {
    marginLeft: "0.625rem",
    "& span": {
      fontWeight: active ? typography.fontWeightBold : typography.fontWeightRegular,
      fontSize: typography.body2.fontSize,
      lineHeight: 1.5,
    },
  };
}

// Export the newly written, clean styling functions
export { collapseItem, collapseIconBox, collapseIcon, collapseText };