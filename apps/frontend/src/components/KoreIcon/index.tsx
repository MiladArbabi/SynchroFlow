//apps/frontend/src/components/KoreIcon/index.tsx
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
  fill: 'none',
  stroke: isActive ? theme.palette.primary.main : theme.palette.text.primary,
  transition: 'stroke 0.2s ease',

  // Apply animation when 'isActive' prop is true
  ...(isActive && {
    animation: `${elevateSpinLand} 1s ease-in-out`,
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
      viewBox="0 0 199 344" 
      width={size}
      height={size}
      style={style}
    >
    {/* --- KORE SVG Code --- */}
      <path d="M197.155 171.741L99.1547 2L1.1547 171.741L99.1547 341.482L197.155 171.741Z" strokeWidth="15px"/>
        <line x1="1.1547" y1="171.241" x2="197.155" y2="171.241" strokeWidth="5px"/>
        <line x1="99.6359" y1="1.60513" x2="147.636" y2="171.605" strokeWidth="5px"/>
        <line x1="99.6373" y1="1.87159" x2="53.6373" y2="171.872" strokeWidth="5px"/>
        <line x1="53.6373" y1="171.61" x2="99.6373" y2="341.61" strokeWidth="5px"/>
        <line x1="147.636" y1="171.877" x2="99.6359" y2="341.877" strokeWidth="5px"/>
    </StyledSvg>
  );
};