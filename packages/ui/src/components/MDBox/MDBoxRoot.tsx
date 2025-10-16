import { styled, Theme } from "@mui/material/styles";

export const MDBoxRoot = styled("div")<{ ownerState: any }>(({ theme, ownerState }) => {
  const { palette, functions, borders, boxShadows } = theme as Theme & { functions: any; borders: any; boxShadows: any; };
  const { variant, bgColor, color, opacity, borderRadius, shadow, coloredShadow } = ownerState;

  const { black, white, transparent, gradients, grey } = palette;
  const { linearGradient, rgba } = functions;
  const { borderRadius: radius } = borders;
  const { colored } = boxShadows;

  let backgroundValue = bgColor;

  if (variant === "gradient") {
    backgroundValue = gradients[bgColor]
      ? linearGradient(gradients[bgColor].main, gradients[bgColor].state)
      : linearGradient(gradients.info.main, gradients.info.state);
  } else if (palette[bgColor]) {
    backgroundValue = palette[bgColor].main;
  }

  let colorValue = color;
  if (palette[color]) {
    colorValue = palette[color].main;
  } else if (color === "light") {
    colorValue = grey[100];
  }

  return {
    opacity,
    background: backgroundValue,
    color: colorValue,
    borderRadius: radius[borderRadius],
    boxShadow: colored[coloredShadow] || shadow,
  };
});