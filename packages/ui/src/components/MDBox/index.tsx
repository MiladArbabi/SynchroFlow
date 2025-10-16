import React, { forwardRef } from "react";
import { MDBoxRoot } from "./MDBoxRoot";

interface MDBoxProps {
  variant?: "contained" | "gradient";
  bgColor?: string;
  color?: string;
  opacity?: number;
  borderRadius?: string;
  shadow?: string;
  coloredShadow?: string;
  [key: string]: any; // Allow any other standard HTML/MUI props
}

export const MDBox = forwardRef<HTMLDivElement, MDBoxProps>(
  ({ variant = "contained", bgColor = "transparent", color = "dark", opacity = 1, borderRadius = "none", shadow = "none", coloredShadow = "none", ...rest }, ref) => (
    <MDBoxRoot
      {...rest}
      ref={ref}
      ownerState={{ variant, bgColor, color, opacity, borderRadius, shadow, coloredShadow }}
    />
  )
);

export default MDBox;