// packages/ui/src/components/MDTypography/styles.ts

import { Theme } from "@mui/material/styles";
import { MDTypographyProps } from "./types";

export function getTypographyStyles(theme: Theme, ownerState: MDTypographyProps['ownerState']) {
  const { palette, typography } = theme;
  const { color, textTransform, verticalAlign, fontWeight, opacity } = ownerState;
  const { fontWeightLight, fontWeightRegular, fontWeightMedium, fontWeightBold } = typography;

  // fontWeight styles
  const fontWeights: { [key: string]: any } = {
    light: fontWeightLight,
    regular: fontWeightRegular,
    medium: fontWeightMedium,
    bold: fontWeightBold,
  };

  // color styles
  let colorValue = color;
  if (palette[color as keyof typeof palette]) {
    colorValue = palette[color as keyof typeof palette].main;
  }

  return {
    opacity,
    textTransform,
    verticalAlign,
    color: colorValue,
    fontWeight: fontWeight && fontWeights[fontWeight] ? fontWeights[fontWeight] : undefined,
  };
}