// packages/ui/src/components/Sidenav/SidenavRoot.tsx
import Drawer from "@mui/material/Drawer";
import { styled } from "@mui/material/styles";

const SidenavRoot = styled(Drawer, {
  shouldForwardProp: (prop) => prop !== "ownerState",
})<{ ownerState: { miniSidenav: boolean } }>(({ theme, ownerState }) => {
  const { transitions, breakpoints, palette } = theme;
  const { miniSidenav } = ownerState;

  const sidebarWidth = 250;
  const backgroundValue = palette.grey[900];

  // styles for the sidenav when miniSidenav={false}
  const drawerOpenStyles = () => ({
    background: backgroundValue,
    transform: "translateX(0)",
    transition: transitions.create("transform", {
      easing: transitions.easing.sharp,
      duration: transitions.duration.shorter,
    }),

    [breakpoints.up("xl")]: {
      left: "0",
      width: sidebarWidth,
      transform: "translateX(0)",
      transition: transitions.create(["width", "background-color"], {
        easing: transitions.easing.sharp,
        duration: transitions.duration.enteringScreen,
      }),
    },
  });

  // styles for the sidenav when miniSidenav={true}
  const drawerCloseStyles = () => ({
    background: backgroundValue,
    transform: `translateX(-320px)`,
    transition: transitions.create("transform", {
      easing: transitions.easing.sharp,
      duration: transitions.duration.shorter,
    }),

    [breakpoints.up("xl")]: {
      left: "0",
      width: `96px`,
      overflowX: "hidden",
      transform: "translateX(0)",
      transition: transitions.create(["width", "background-color"], {
        easing: transitions.easing.sharp,
        duration: transitions.duration.shorter,
      }),
    },
  });

  return {
    "& .MuiDrawer-paper": {
      boxShadow: theme.shadows[3],
      border: "none",

      ...(miniSidenav ? drawerCloseStyles() : drawerOpenStyles()),
    },
  };
});

export default SidenavRoot;
