// packages/ui/src/components/Sidenav/SidenavRoot.tsx

import Box from "@mui/material/Box";
import { styled } from "@mui/material/styles";

const SidenavRoot = styled(Box,{
  shouldForwardProp: (prop) => prop !== "ownerState",
})<{ ownerState: { miniSidenav: boolean } }>(({ theme, ownerState }) => {
  const { transitions, palette, spacing } = theme;
  const { miniSidenav } = ownerState;

  const openWidth = spacing(32); // 256px
  const closedWidth = spacing(12); // 96px

  return {
    width: miniSidenav ? closedWidth : openWidth,
    flexShrink: 0, // Prevent the Sidenav from shrinking
    overflowX: 'hidden',
    transition: transitions.create('width', {
      easing: transitions.easing.sharp,
      duration: transitions.duration.enteringScreen,
    }),
    background: palette.grey[900],
  };
});

export default SidenavRoot;