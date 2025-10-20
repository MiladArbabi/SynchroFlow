// packages/ui/src/components/MDButton/index.tsx
import { forwardRef } from "react";

// prop-types is a library for typechecking of props
import PropTypes from "prop-types";

// Custom styles for MDButton
import MDButtonRoot from "./MDButtonRoot";

const MDButton = forwardRef(
  ({ color, variant, size, circular, iconOnly, children, ...rest }, ref) => {

    return (
      <MDButtonRoot
        {...rest}
        ref={ref}
        color={color === "white" ? "primary" : color}
        variant={variant === "gradient" ? "contained" : variant}
        size={size}
      >
        {children}
      </MDButtonRoot>
    );
  }
);

// Setting default values for the props of MDButton
MDButton.defaultProps = {
  size: "medium",
  variant: "contained",
  color: "white",
  circular: false,
  iconOnly: false,
};

// Typechecking props for the MDButton
MDButton.propTypes = {
  size: PropTypes.oneOf(["small", "medium", "large"]),
  variant: PropTypes.oneOf(["text", "contained", "outlined", "gradient"]),
  color: PropTypes.oneOf([
    "white",
    "primary",
    "secondary",
    "info",
    "success",
    "warning",
    "error",
    "light",
    "dark",
  ]),
  circular: PropTypes.bool,
  iconOnly: PropTypes.bool,
  children: PropTypes.node.isRequired,
};

export default MDButton;
