// packages/ui/src/components/MDBox/MDBoxRoot.tsx
import { styled, Theme } from "@mui/material/styles";
import { BoxProps } from "@mui/material/Box";

interface MDBoxRootProps extends BoxProps {
  ownerState: {
    variant?: "gradient" | "contained";
    bgColor?: string;
    color?: string;
    opacity?: number;
    borderRadius?: string;
    shadow?: string;
    coloredShadow?: string;
  };
}

export const MDBoxRoot = styled("div")<MDBoxRootProps>(({ theme, ownerState }) => {
  const { palette, shadows, shape } = theme;
  const { variant, bgColor, color, opacity, borderRadiues, shadow, coloredShadow } = ownerState;

  const { gradients, grey, transparent } = palette as unknown; // Cast to access custom gradients if they exist

  let backgroundValue = bgColor;

  if (variant === "gradient") {
    // FIX: Replace custom 'linearGradient' function with standard CSS.
    const gradient = gradients?.[bgColor] || gradients?.info;
    backgroundValue = gradient ? `linear-gradient(195deg, ${gradient.main}, ${gradient.state})` : "none";
  } else if (palette[bgColor as keyof typeof palette]) {
    backgroundValue = palette[bgColor].main;
  }

  return {
    opacity,
    background: backgroundValue,
    color: palette[color as keyof typeof palette]?.main || color,
    borderRadius: shape.borderRadius, // FIX: Use standard 'shape.borderRadius'
    boxShadow: shadows[1] || shadow,
  };
});