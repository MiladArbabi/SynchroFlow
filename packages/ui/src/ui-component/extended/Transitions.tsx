// packages/ui/src/ui-component/extended/Transitions.tsx
import React from 'react';

// material-ui
import Collapse, { CollapseProps } from '@mui/material/Collapse';
import Fade, { FadeProps } from '@mui/material/Fade';
import Grow, { GrowProps } from '@mui/material/Grow';
import Slide, { SlideProps } from '@mui/material/Slide';
import Zoom, { ZoomProps } from '@mui/material/Zoom';
import Box, { BoxProps } from '@mui/material/Box';
import { Theme } from '@mui/material/styles';
import { SxProps } from '@mui/system';

// Define possible transition types and positions
type TransitionType = 'grow' | 'fade' | 'collapse' | 'slide' | 'zoom';
// FIX 1: Rename 'position' to avoid conflict with BoxProps' 'position'
type TransformOriginPosition = 'top-left' | 'top-right' | 'top' | 'bottom-left' | 'bottom-right' | 'bottom';
type TransitionDirection = 'up' | 'down' | 'left' | 'right';

// Define the props interface, explicitly omitting BoxProps['position'] to avoid conflict
interface TransitionsProps extends Omit<BoxProps, 'position'> {
  children: React.ReactNode;
  // FIX 1: Use the new name here
  transformOriginPosition?: TransformOriginPosition;
  sx?: SxProps<Theme>;
  type?: TransitionType;
  direction?: TransitionDirection;
  // Allow passing additional props to the underlying MUI transition component
  TransitionProps?: GrowProps | FadeProps | CollapseProps | SlideProps | ZoomProps;
}

const Transitions: React.FC<TransitionsProps> = ({
  children,
  // FIX 1: Destructure the renamed prop with its default value
  transformOriginPosition = 'top-left',
  sx,
  type = 'grow',
  direction = 'up',
  TransitionProps = {}, // Default empty object for TransitionProps
  ...others // Spread remaining BoxProps (excluding 'position')
}) => {
  let positionSX: SxProps<Theme> = {
    transformOrigin: '0 0 0'
  };

  // FIX 1: Update the switch statement to use the renamed prop
  switch (transformOriginPosition) {
    case 'top-right':
      positionSX = { transformOrigin: 'top right' };
      break;
    case 'top':
      positionSX = { transformOrigin: 'top' };
      break;
    case 'bottom-left':
      positionSX = { transformOrigin: 'bottom left' };
      break;
    case 'bottom-right':
      positionSX = { transformOrigin: 'bottom right' };
      break;
    case 'bottom':
      positionSX = { transformOrigin: 'bottom' };
      break;
    case 'top-left':
    default:
      positionSX = { transformOrigin: '0 0 0' };
      break;
  }

  // Define default timeouts
  const defaultFadeTimeout = { appear: 500, enter: 600, exit: 400 };
  const defaultSlideTimeout = { appear: 0, enter: 400, exit: 200 };

  // Handle timeout more carefully - merge objects if possible
  const fadeTimeout = typeof (TransitionProps as FadeProps)?.timeout === 'object'
    ? { ...defaultFadeTimeout, ...(TransitionProps as FadeProps)?.timeout as object }
    : defaultFadeTimeout;

  const slideTimeout = typeof (TransitionProps as SlideProps)?.timeout === 'object'
    ? { ...defaultSlideTimeout, ...((TransitionProps as SlideProps).timeout as object) }
    : defaultSlideTimeout;


  return (
    <Box {...others}>
      {type === 'grow' && (
        <Grow {...(TransitionProps as GrowProps)}>
          <Box sx={{ ...positionSX, ...sx }}>{children}</Box>
        </Grow>
      )}
      {type === 'collapse' && (
        <Collapse {...(TransitionProps as CollapseProps)} sx={{ ...positionSX, ...sx }}>
          {children}
        </Collapse>
      )}
      {type === 'fade' && (
        <Fade
          {...(TransitionProps as FadeProps)}
          // FIX 2: Use the calculated timeout object
          timeout={fadeTimeout}
        >
          <Box sx={{ ...positionSX, ...sx }}>{children}</Box>
        </Fade>
      )}
      {type === 'slide' && (
        <Slide
          {...(TransitionProps as SlideProps)}
          // FIX 2: Use the calculated timeout object
          timeout={slideTimeout}
          direction={direction}
        >
          <Box sx={{ ...positionSX, ...sx }}>{children}</Box>
        </Slide>
      )}
      {type === 'zoom' && (
        <Zoom {...(TransitionProps as ZoomProps)}>
          <Box sx={{ ...positionSX, ...sx }}>{children}</Box>
        </Zoom>
      )}
    </Box>
  );
};

export default Transitions;