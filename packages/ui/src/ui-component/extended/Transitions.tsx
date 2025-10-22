/* eslint-disable @typescript-eslint/no-unused-vars */
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

// Define types
type TransitionType = 'grow' | 'fade' | 'collapse' | 'slide' | 'zoom';
type TransformOriginPosition = 'top-left' | 'top-right' | 'top' | 'bottom-left' | 'bottom-right' | 'bottom';
type TransitionDirection = 'up' | 'down' | 'left' | 'right';
type MuiTimeout = number | { appear?: number, enter?: number, exit?: number };
type CollapseTimeout = MuiTimeout | 'auto';

// Base props needed by Transitions logic
type CoreTransitionProps = {
    in?: boolean;
    timeout?: MuiTimeout | CollapseTimeout;
};

// All possible MUI Transition component props
type AnyMuiTransitionProps = GrowProps | FadeProps | CollapseProps | SlideProps | ZoomProps;

// Define the component props interface
// Use Omit to exclude Box props handled internally or potentially conflicting
type ExcludedBoxProps = 'position' | 'timeout' | 'in';
interface TransitionsProps extends Omit<BoxProps, ExcludedBoxProps>, CoreTransitionProps {
  children: React.ReactNode; // Children are required
  transformOriginPosition?: TransformOriginPosition;
  sx?: SxProps<Theme>; // SX for the inner Box
  type?: TransitionType;
  direction?: TransitionDirection;
  // Extra props specifically for the underlying MUI component
  // --- FIX 1: REMOVE Omit --- Allow 'timeout', 'in', 'children' to be passed via muiTransitionProps if needed, although direct props take precedence
  muiTransitionProps?: AnyMuiTransitionProps;
}

// Helper function remains the same
const pickTransitionHandlers = (props: AnyMuiTransitionProps | undefined): Partial<AnyMuiTransitionProps> => {
    // ... (implementation from previous step)
    if (!props) return {};
    const handlers: Partial<AnyMuiTransitionProps> = {};
    if (typeof props.onEnter === 'function') handlers.onEnter = props.onEnter;
    if (typeof props.onEntering === 'function') handlers.onEntering = props.onEntering;
    if (typeof props.onEntered === 'function') handlers.onEntered = props.onEntered;
    if (typeof props.onExit === 'function') handlers.onExit = props.onExit;
    if (typeof props.onExiting === 'function') handlers.onExiting = props.onExiting;
    if (typeof props.onExited === 'function') handlers.onExited = props.onExited;
    if (typeof props.addEndListener === 'function') handlers.addEndListener = props.addEndListener;
    if ('mountOnEnter' in props) handlers.mountOnEnter = props.mountOnEnter;
    if ('unmountOnExit' in props) handlers.unmountOnExit = props.unmountOnExit;
    if ('appear' in props) handlers.appear = props.appear;
    return handlers;
};


const Transitions: React.FC<TransitionsProps> = ({
  children,
  transformOriginPosition = 'top-left',
  sx, // SX for the inner Box
  type = 'grow',
  direction = 'up',
  // Destructure core props
  in: inProp,
  timeout: timeoutProp,
  muiTransitionProps = {}, // Capture all extra props
  ...boxProps // Capture ONLY remaining BoxProps for the OUTER wrapper
}) => {
  let positionSX: SxProps<Theme> = { transformOrigin: '0 0 0' };

  switch (transformOriginPosition) {
    case 'top-right': positionSX = { transformOrigin: 'top right' }; break;
    case 'top': positionSX = { transformOrigin: 'top' }; break;
    case 'bottom-left': positionSX = { transformOrigin: 'bottom left' }; break;
    case 'bottom-right': positionSX = { transformOrigin: 'bottom right' }; break;
    case 'bottom': positionSX = { transformOrigin: 'bottom' }; break;
    case 'top-left': default: positionSX = { transformOrigin: '0 0 0' }; break;
  }

  // Defaults
  const defaultFadeTimeout: MuiTimeout = { appear: 500, enter: 600, exit: 400 };
  const defaultSlideTimeout: MuiTimeout = { appear: 0, enter: 400, exit: 200 };

  // --- Timeout Calculation ---
  // Priority: timeoutProp > muiTransitionProps.timeout > default
  const getTimeoutValue = (defaultTimeout: MuiTimeout | undefined = undefined): MuiTimeout | CollapseTimeout | undefined => {
      const explicitTimeout = timeoutProp ?? muiTransitionProps?.timeout;

      // Handle 'auto' only for Collapse
      if (type === 'collapse' && explicitTimeout === 'auto') {
          return 'auto';
      }
      // If explicit is 'auto' but type is not Collapse, ignore it or use default
      if (explicitTimeout === 'auto') {
          return defaultTimeout;
      }
      // Handle object merging with default (if default exists)
      if (typeof explicitTimeout === 'object' && typeof defaultTimeout === 'object') {
          return { ...defaultTimeout, ...explicitTimeout };
      }
      // Return explicit number/object or default number/object or undefined
      return explicitTimeout ?? defaultTimeout;
  };

  const fadeTimeout = getTimeoutValue(defaultFadeTimeout) as FadeProps['timeout'];
  const slideTimeout = getTimeoutValue(defaultSlideTimeout) as SlideProps['timeout'];
  const otherTimeout = getTimeoutValue(undefined) as GrowProps['timeout'] | ZoomProps['timeout'] | CollapseProps['timeout']; // No specific default for others

  // Pick only valid event handlers and flags from muiTransitionProps
  const validMuiTransitionHandlersAndFlags = pickTransitionHandlers(muiTransitionProps);

  // --- FIX 3: Ensure InnerBox is always defined ---
  const InnerBox = <Box sx={{ ...positionSX, ...sx }}>{children}</Box>;

  // --- FIX 2 & 3: Construct props for each transition type more carefully ---
  // Common props for most transitions
  const commonProps = {
      ...validMuiTransitionHandlersAndFlags, // Handlers and flags
      in: inProp, // 'in' state
  };

  switch (type) {
    case 'collapse': {
      const timeout = getTimeoutValue(undefined) as CollapseTimeout; // Allow 'auto'
      return (
        // --- FIX: Add outer Box to receive boxProps ---
        <Box {...boxProps}>
            <Collapse
              {...commonProps} // Spread common transition props (in, handlers)
              timeout={timeout} // Pass specific timeout, allowing 'auto'
              // --- FIX: Remove sx from Collapse, apply to InnerBox if needed ---
              // sx={sx}
              // --- FIX: DO NOT spread boxProps onto Collapse ---
              // {...boxProps}
              // Spread any *other* specific Collapse props from muiTransitionProps
               {...(muiTransitionProps as CollapseProps)} // Spread safely here AFTER commonProps
            >
              {/* --- FIX: Collapse wraps children directly or InnerBox --- */}
              {/* Option 1: Direct children (simpler if no extra styling needed) */}
               {children}
              {/* Option 2: Use InnerBox if sx or positionSX needed */}
              {/* {InnerBox} */}
            </Collapse>
        </Box>
      );
    }
    case 'fade': {
      const timeout = getTimeoutValue(defaultFadeTimeout) as FadeProps['timeout'];
      return (
        <Box {...boxProps}>
            <Fade
              {...commonProps}
              timeout={timeout}
              {...(muiTransitionProps as FadeProps)}
            >
              {InnerBox}
            </Fade>
         </Box>
      );
    }
    case 'slide': {
      const timeout = getTimeoutValue(defaultSlideTimeout) as SlideProps['timeout'];
      return (
         <Box {...boxProps}>
            <Slide
              {...commonProps}
              timeout={timeout}
              direction={direction}
               {...(muiTransitionProps as SlideProps)}
            >
              {InnerBox}
            </Slide>
        </Box>
      );
    }
    case 'zoom': {
      const timeout = getTimeoutValue(undefined) as MuiTimeout | undefined;
      return (
        <Box {...boxProps}>
            <Zoom
              {...commonProps}
              timeout={timeout}
               {...(muiTransitionProps as ZoomProps)}
            >
              {InnerBox}
            </Zoom>
         </Box>
      );
    }
    case 'grow':
    default: {
      const timeout = getTimeoutValue(undefined) as MuiTimeout | undefined;
      return (
         <Box {...boxProps}>
            <Grow
              {...commonProps}
              timeout={timeout}
               {...(muiTransitionProps as GrowProps)}
            >
              {InnerBox}
            </Grow>
         </Box>
      );
    }
  }
};

export default Transitions;