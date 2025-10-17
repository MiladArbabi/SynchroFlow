//packages/ui/src/components/Sidenav/styles/sidenavCollapse.tsx
import { Theme } from "@mui/material/styles";

interface OwnerState {
  active: boolean;
  transparentSidenav?: boolean;
  whiteSidenav?: boolean;
  darkMode?: boolean;
  sidenavColor?: string;
  miniSidenav?: boolean;
}

function collapseItem(theme: Theme | any, ownerState: OwnerState) {
  const { palette, transitions, breakpoints, boxShadows, borders, functions } = theme;
  const { active, transparentSidenav, whiteSidenav, darkMode, sidenavColor } = ownerState;

  const { white, transparent, dark, grey, gradients } = palette;
  const { md } = boxShadows;
  const { borderRadius } = borders;
  const { pxToRem, rgba, linearGradient } = functions;

  return {
    background: active && sidenavColor ? linearGradient(gradients[sidenavColor].main, gradients[sidenavColor].state) : transparent.main,
    color: (transparentSidenav && !darkMode && !active) || (whiteSidenav && !active) ? dark.main : white.main,
    display: "flex",
    alignItems: "center",
    width: "100%",
    padding: `${pxToRem(8)} ${pxToRem(10)}`,
    margin: `${pxToRem(1.5)} ${pxToRem(16)}`,
    borderRadius: borderRadius.md,
    cursor: "pointer",
    userSelect: "none",
    whiteSpace: "nowrap",
    boxShadow: active && !whiteSidenav && !darkMode && !transparentSidenav ? md : "none",
    [breakpoints.up("xl")]: {
      transition: transitions.create(["box-shadow", "background-color"], {
        easing: transitions.easing.easeInOut,
        duration: transitions.duration.shorter,
      }),
    },
    "&:hover, &:focus": {
      backgroundColor: () => {
        let backgroundValue;
        if (!active) {
          backgroundValue = transparentSidenav && !darkMode ? grey[300] : rgba(whiteSidenav ? grey[400] : white.main, 0.2);
        }
        return backgroundValue;
      },
    },
  };
}

function collapseIconBox(theme: Theme | any, ownerState: OwnerState) {
  const { palette, transitions, borders, functions } = theme;
  const { transparentSidenav, whiteSidenav, darkMode, active } = ownerState;

  const { white, dark } = palette;
  const { borderRadius } = borders;
  const { pxToRem } = functions;

  return {
    minWidth: pxToRem(32),
    minHeight: pxToRem(32),
    color: (transparentSidenav && !darkMode && !active) || (whiteSidenav && !active) ? dark.main : white.main,
    borderRadius: borderRadius.md,
    display: "grid",
    placeItems: "center",
    transition: transitions.create("margin", {
      easing: transitions.easing.easeInOut,
      duration: transitions.duration.standard,
    }),
    "& svg, svg g": {
      color: transparentSidenav || whiteSidenav ? dark.main : white.main,
    },
  };
}

const collapseIcon = (theme: Theme | any, { active }: OwnerState) => ({
  color: active ? theme.palette.white.main : theme.palette.gradients.dark.state,
  // This is the definitive fix: an explicit, high-specificity override.
  fontSize: "1.25rem !important",
});

function collapseText(theme: Theme | any, ownerState: OwnerState) {
  const { typography, transitions, breakpoints, functions } = theme;
  const { miniSidenav, transparentSidenav, active } = ownerState;

  const { size, fontWeightRegular, fontWeightLight } = typography;
  const { pxToRem } = functions;

  return {
    marginLeft: pxToRem(10),
    [breakpoints.up("xl")]: {
      opacity: miniSidenav || (miniSidenav && transparentSidenav) ? 0 : 1,
      maxWidth: miniSidenav || (miniSidenav && transparentSidenav) ? 0 : "100%",
      marginLeft: miniSidenav || (miniSidenav && transparentSidenav) ? 0 : pxToRem(10),
      transition: transitions.create(["opacity", "margin"], {
        easing: transitions.easing.easeInOut,
        duration: transitions.duration.standard,
      }),
    },
    "& span": {
      fontWeight: active ? fontWeightRegular : fontWeightLight,
      fontSize: size.sm,
      lineHeight: 1,
    },
  };
}

export { collapseItem, collapseIconBox, collapseIcon, collapseText };