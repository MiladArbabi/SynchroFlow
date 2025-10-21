/* eslint-disable @typescript-eslint/no-unused-vars */
/* eslint-disable @typescript-eslint/no-explicit-any */
// packages/ui/src/components/MDButton/index.tsx
import { forwardRef, ReactNode } from "react";

// Custom styles for MDButton
import MDButtonRoot from "./MDButtonRoot";
import IconComponent from "../Icon";

// Define Color types based on PropTypes
type ButtonColor = "white" | "primary" | "secondary" | "info" | "success" | "warning" | "error" | "light" | "dark";
type ButtonVariant = "text" | "contained" | "outlined" | "gradient";
type ButtonSize = "small" | "medium" | "large";

interface MDButtonProps {
  color?: ButtonColor;
  variant?: ButtonVariant;
  size?: ButtonSize;
  circular?: boolean;
  iconOnly?: boolean;
  children: ReactNode;
  startIcon?: ReactNode; // Add props for potential icons
  endIcon?: ReactNode;
  [key: string]: any; // Allow other props
}

const MDButton = forwardRef<HTMLButtonElement, MDButtonProps>(
  ({ color = "white", variant = "contained", size = "medium", circular, iconOnly, children, startIcon, endIcon, ...rest }, ref) => (
    <MDButtonRoot
      {...rest}
      ref={ref}
      color={color === "white" ? "primary" : color}
      variant={variant === "gradient" ? "contained" : variant}
      size={size}
      startIcon={
        typeof startIcon === "string" ? (
          <IconComponent name={startIcon as any} size="small" />
        ) : (
          startIcon
        )
      }
      endIcon={
        typeof endIcon === "string" ? (
          <IconComponent name={endIcon as any} size="small" />
        ) : (
          endIcon
        )
      }
    >
      {children}
    </MDButtonRoot>
  )
);

export default MDButton;
