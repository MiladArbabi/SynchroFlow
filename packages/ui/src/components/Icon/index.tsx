// packages/ui/src/components/Icon/index.tsx
import React from 'react';
import { useTheme } from '@mui/material/styles';
import { icons } from 'lucide-react';

// Define Prop Types
type IconSize = 'xs' | 'small' | 'medium' | 'large' | 'xl';
type IconColor =
  | 'inherit'
  | 'primary'
  | 'secondary'
  | 'info'
  | 'success'
  | 'warning'
  | 'error'
  | 'light'
  | 'dark'
  | 'text'
  | 'white';

interface IconProps {
  name: keyof typeof icons; // Use Lucide icon names as keys
  color?: IconColor;
  size?: IconSize;
  sx?: object; // Allow passing sx prop for custom styling
}

// Map size prop to pixel dimensions
const sizeMap: Record<IconSize, number> = {
  xs: 16,
  small: 20,
  medium: 24, // Default size
  large: 28,
  xl: 32,
};

const IconComponent: React.FC<IconProps> = ({
  name,
  color = 'inherit',
  size = 'medium'
}) => {
  const theme = useTheme();
  const LucideIcon = icons[name];

  if (!LucideIcon) {
    console.warn(`Icon "${name}" not found in lucide-react. Rendering fallback.`);
    // Render a fallback or null
    return null; // Or a default fallback icon
  }

  // Map color prop to theme palette
  const getThemeColor = () => {
    if (color === 'inherit' || color === 'text' || color === 'white') {
        // Handle special cases or direct mapping if theme structure matches
        if (color === 'text') return theme.palette.text.primary;
        if (color === 'white') return theme.palette.common.white;
        return undefined; // Default inherit
    }
    // Access theme palette safely
    return theme.palette[color]?.main || theme.palette.text.primary;
  };

  const finalSize = sizeMap[size];
  const finalColor = getThemeColor();

  return (
    // FIX: Render the LucideIcon directly and pass expected props
    <LucideIcon
      size={finalSize}
      color={finalColor}
      // Add style for vertical alignment if needed, and allow sx passthrough
      style={{ verticalAlign: 'middle' }}
     />
  );
};

export default IconComponent;