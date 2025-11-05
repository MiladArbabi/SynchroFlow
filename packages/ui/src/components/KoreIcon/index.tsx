//packages/ui/src/components/KoreIcon/index.tsx
import React from 'react';
import { styled, keyframes } from '@mui/material/styles';

// --- 1. Define the Animation ---
const elevateSpinLand = keyframes`
  0% {
    transform: translateY(0) rotate(0);
  }
  30% {
    transform: translateY(-4px) rotate(0);
  }
  70% {
    transform: translateY(-4px) rotate(180deg);
  }
  100% {
    transform: translateY(0) rotate(180deg);
  }
`;

// --- 2. Create the Styled SVG Component ---
// We use 'styled' to encapsulate the SVG and its animation logic.
const StyledSvg = styled('svg', {
  shouldForwardProp: (prop) => prop !== 'isActive',
})<{ isActive?: boolean }>(({ theme, isActive }) => ({
  // Base styles
  width: '24px',
  height: '24px',
  stroke: theme.palette.text.primary,
  strokeWidth: 2,
  transition: 'stroke 0.2s ease',

  // Apply animation when 'isActive' prop is true
  ...(isActive && {
    animation: `${elevateSpinLand} 1s ease-in-out`,
    stroke: theme.palette.primary.main, // Change color when active
    // Add the class for our unit test
    '&.kore-icon-active': {},
  }),
}));

// --- 3. Define the KoreIcon Component ---
export interface KoreIconProps {
  isActive?: boolean;
  size?: number | string;
  style?: React.CSSProperties;
}

/**
 * The custom, animated Kore "diamond" icon.
 * It animates when 'isActive' is true.
 */
export const KoreIcon: React.FC<KoreIconProps> = ({
  isActive = false,
  size = 24,
  style,
}) => {
  return (
    <StyledSvg
      isActive={isActive}
      // Apply the active class if 'isActive' is true
      className={isActive ? 'kore-icon-active' : ''}
      data-testid="kore-icon-svg"
      viewBox="0 0 10 40" // Tall 1:4 ratio as requested
      width={size}
      height={size}
      style={style}
      fill="none"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {/* The 3 lines making the diamond shape */}
      {/* Side 1 (Top-Left to Bottom-Left) */}
      <path d="M5 2 L1 20 L5 38" />
      {/* Center Line (Top to Bottom) */}
      <path d="M5 2 L5 38" />
      {/* Side 2 (Top-Right to Bottom-Right) */}
      <path d="M5 2 L9 20 L5 38" />
    </StyledSvg>
  );
};