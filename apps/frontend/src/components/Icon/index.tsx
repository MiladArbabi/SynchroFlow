// apps/frontend/src/components/Icon/index.tsx
import React from 'react';
import { useTheme } from '@mui/material/styles';
import type { Theme } from '@mui/material/styles';
import { icons } from 'lucide-react';

type IconSize = 'xs' | 'small' | 'medium' | 'large' | 'xl';

// Palette keys that actually exist on theme.palette
type PaletteColorKey =
  | 'primary'
  | 'secondary'
  | 'info'
  | 'success'
  | 'warning'
  | 'error';

type IconColor =
  | 'inherit'
  | 'light'
  | 'dark'
  | 'text'
  | 'white'
  | PaletteColorKey;

interface IconProps {
  name: keyof typeof icons;
  color?: IconColor;
  size?: IconSize;
}

// Map size prop to pixel dimensions
const sizeMap: Record<IconSize, number> = {
  xs: 16,
  small: 20,
  medium: 24,
  large: 28,
  xl: 32
};

const isPaletteColorKey = (color: IconColor): color is PaletteColorKey => {
  return (
    color === 'primary' ||
    color === 'secondary' ||
    color === 'info' ||
    color === 'success' ||
    color === 'warning' ||
    color === 'error'
  );
};

const resolveColor = (theme: Theme, color: IconColor | undefined) => {
  if (!color || color === 'inherit') return undefined;

  if (color === 'text') return theme.palette.text.primary;
  if (color === 'white') return theme.palette.common.white;
  if (color === 'light') return theme.palette.grey[300];
  if (color === 'dark') return theme.palette.grey[900];

  // At this point TS knows color is one of the real palette keys
  if (isPaletteColorKey(color)) {
    return theme.palette[color].main;
  }

  // Fallback – should never be hit if types stay in sync
  return theme.palette.text.primary;
};

const IconComponent: React.FC<IconProps> = ({
  name,
  color = 'inherit',
  size = 'medium'
}) => {
  const theme = useTheme();
  const LucideIcon = icons[name];

  if (!LucideIcon) {
    console.warn(`Icon "${name}" not found in lucide-react. Rendering null.`);
    return null;
  }

  const finalSize = sizeMap[size];
  const finalColor = resolveColor(theme, color);

  return (
    <LucideIcon
      size={finalSize}
      color={finalColor}
      style={{ verticalAlign: 'middle' }}
    />
  );
};

export default IconComponent;