// packages/ui/src/components/MDTypography/index.tsx
import { forwardRef } from "react";
import { useMaterialUIController } from "../../contexts/MaterialUI";
import MDTypographyRoot from "./MDTypographyRoot";
import { MDTypographyProps } from "./types";

const MDTypography = forwardRef<HTMLElement, MDTypographyProps>(
  (
    {
      color = "dark",
      fontWeight = false,
      textTransform = "none",
      verticalAlign = "unset",
      textGradient = false,
      opacity = 1,
      variant = "inherit",
      children,
      ...rest
    },
    ref
  ) => {
    const [controller] = useMaterialUIController();
    const { darkMode } = controller;

    return (
      <MDTypographyRoot
        {...rest}
        ref={ref}
        variant={variant}
        ownerState={{
          color,
          textTransform,
          verticalAlign,
          fontWeight,
          opacity,
          textGradient,
          darkMode,
        }}
      >
        {children}
      </MDTypographyRoot>
    );
  }
);

export default MDTypography;