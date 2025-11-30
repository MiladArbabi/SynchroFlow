// apps/frontend/src/ui-component/extended/AnimateButton.tsx
import React from 'react';

// third-party
import { motion, MotionProps, TargetAndTransition } from 'framer-motion'; // Import types

// Define possible animation types
type AnimateButtonProps = {
  children: React.ReactNode;
  type?: 'slide' | 'scale' | 'rotate'; // Add other types if needed
} & MotionProps; // Inherit other framer-motion props

// Animation variants
const scaleVariant: { hover: TargetAndTransition; tap: TargetAndTransition } = {
  hover: { scale: 1.05 },
  tap: { scale: 0.95 }
};

const slideVariant: { hover: TargetAndTransition; tap: TargetAndTransition } = {
    hover: { x: 5 }, // Example slide
    tap: { x: -2 }  // Example tap effect
};

const rotateVariant: { hover: TargetAndTransition; tap: TargetAndTransition } = {
    hover: { rotate: 15 }, // Example rotate
    tap: { rotate: -5 }
};


const AnimateButton: React.FC<AnimateButtonProps> = ({ children, type = 'scale', ...otherProps }) => {

    let variants;
    switch (type) {
        case 'rotate':
            variants = rotateVariant;
            break;
        case 'slide':
            variants = slideVariant;
            break;
        case 'scale':
        default:
            variants = scaleVariant;
            break;
    }

  return (
    <motion.div
      whileHover="hover"
      whileTap="tap"
      variants={variants}
      {...otherProps} // Spread remaining motion props
    >
      {children}
    </motion.div>
  );
};


export default AnimateButton;