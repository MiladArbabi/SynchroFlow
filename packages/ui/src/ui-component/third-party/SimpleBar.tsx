// packages/ui/src/ui-component/third-party/SimpleBar.tsx
import React from 'react';

// material-ui
import { styled, useTheme, Theme } from '@mui/material/styles';
import Box, { BoxProps } from '@mui/material/Box';
import { SxProps } from '@mui/system';

// project import
import { ThemeDirection } from 'config';
import { withAlpha } from 'utils/colorUtils'; // Ensure this utility exists and is typed

// third party
import { BrowserView, MobileView } from 'react-device-detect';
import SimpleBar from 'simplebar-react';
import { ComponentProps } from 'react';

// root style
const RootStyle = styled(BrowserView)({
  flexGrow: 1,
  height: '100%',
  overflow: 'hidden'
});

// scroll bar wrapper
const SimpleBarStyle = styled(SimpleBar)(({ theme }: { theme: Theme }) => ({
  maxHeight: '100%',
  '& .simplebar-scrollbar': {
    '&:before': { backgroundColor: withAlpha(theme.vars.palette.grey[500], 0.48) },
    '&.simplebar-visible:before': { opacity: 1 }
  },
  '& .simplebar-track.simplebar-vertical': { width: 10 },
  '& .simplebar-track.simplebar-horizontal .simplebar-scrollbar': { height: 6 },
  '& .simplebar-mask': { zIndex: 'inherit' }
}));

// Define props interface extending SimpleBarProps and BoxProps
interface SimpleBarScrollProps extends 
  Omit<ComponentProps<typeof SimpleBar>, 'children'>, Omit<BoxProps, 'children'> { 
    children: React.ReactNode; sx?: SxProps<Theme>; }

// ==============================|| SIMPLE SCROLL BAR  ||============================== //

const SimpleBarScroll: React.FC<SimpleBarScrollProps> = ({ children, sx, ...other }) => {
  const theme = useTheme();

  return (
    <>
      <RootStyle>
        <SimpleBarStyle
          clickOnTrack={false}
          sx={sx}
          // Add data-simplebar-direction attribute for RTL support
          // The attribute name must be lowercase and hyphenated
          data-simplebar-direction={theme.direction === ThemeDirection.RTL ? 'rtl' : 'ltr'} 
          {...other}
        >
          {children}
        </SimpleBarStyle>
      </RootStyle>
      {/* Mobile view uses native scrolling */}
      <MobileView>
        <Box sx={{ overflowX: 'auto', ...sx }} {...other}>
          {children}
        </Box>
      </MobileView>
    </>
  );
};

export default SimpleBarScroll;