// packages/ui/src/components/MDTypography/index.tsx
import { forwardRef } from "react";
import MDTypographyRoot from "./MDTypographyRoot";
import { MDTypographyProps } from "./types";

const MDTypography = forwardRef<HTMLElement, MDTypographyProps>(
  (
    {
      color = "dark",
      fontWeight = false,
      textTransform = "none",
      verticalAlign = "unset",
      opacity = 1,
      variant = "inherit",
      children,
      ...rest
    },
    ref
  ) => {

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
        }}
      >
        {children}
      </MDTypographyRoot>
    );
  }
);

export default MDTypography;