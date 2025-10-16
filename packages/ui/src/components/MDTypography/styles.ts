//packages/ui/src/components/MDTypography/styles.ts
import { Theme } from "@mui/material/styles";
import { CSSObject } from "@mui/system";
import { MDTypographyProps } from "./types";

export const getTypographyStyles = (theme: Theme, ownerState: MDTypographyProps["ownerState"]): CSSObject => {
  const { palette, typography } = theme;
  const { color, textTransform, verticalAlign, fontWeight, opacity, textGradient, darkMode } =
    ownerState;

  const { gradients, transparent, white } = palette;
  const { fontWeightLight, fontWeightRegular, fontWeightMedium, fontWeightBold } = typography;
  const { linearGradient } = theme.functions;

  const fontWeights = {
    light: fontWeightLight,
    regular: fontWeightRegular,
    medium: fontWeightMedium,
    bold: fontWeightBold,
  };

  const gradientStyles = (): CSSObject => ({
    backgroundImage:
      color !== "inherit" && color !== "text" && color !== "white" && gradients[color]
        ? linearGradient(gradients[color].main, gradients[color].state)
        : linearGradient(gradients.dark.main, gradients.dark.state),
    display: "inline-block",
    WebkitBackgroundClip: "text",
    WebkitTextFillColor: transparent.main,
    position: "relative" as const,
    zIndex: 1,
  });

  let colorValue = color === "inherit" || !palette[color] ? "inherit" : palette[color].main;

  if (darkMode && (color === "inherit" || !palette[color])) {
    colorValue = "inherit";
  } else if (darkMode && color === "dark") colorValue = white.main;

  return {
    opacity,
    textTransform: textTransform as CSSObject["textTransform"], // Explicitly cast to TextTransform
    verticalAlign,
    textDecoration: "none",
    color: colorValue,
    fontWeight: fontWeight ? fontWeights[fontWeight] : undefined, // Handle false case
    ...(textGradient && gradientStyles()),
  };
};