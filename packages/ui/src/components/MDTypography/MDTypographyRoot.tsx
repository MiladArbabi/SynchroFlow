// packages/ui/src/components/MDTypography/MDTypographyRoot.tsx
import Typography, { TypographyProps } from "@mui/material/Typography";
import { styled } from "@mui/material/styles";
import { getTypographyStyles } from "./styles";
import { MDTypographyProps } from "./types";

// Define a type for MDTypographyRoot props
interface MDTypographyRootProps extends TypographyProps {
  ownerState: MDTypographyProps["ownerState"];
}

const MDTypographyRoot = styled(Typography, {
  shouldForwardProp: (prop) =>
    prop !== "ownerState" &&
    prop !== "color" &&
    prop !== "textTransform" &&
    prop !== "verticalAlign" &&
    prop !== "fontWeight" &&
    prop !== "opacity" &&
    prop !== "textGradient" &&
    prop !== "darkMode",
})<MDTypographyRootProps>(({ theme, ownerState }) => getTypographyStyles(theme, ownerState));

MDTypographyRoot.displayName = "MDTypographyRoot";

export default MDTypographyRoot;