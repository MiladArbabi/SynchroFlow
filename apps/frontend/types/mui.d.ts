// eslint-disable-next-line @typescript-eslint/no-unused-vars
import { PaletteColor } from "@mui/material/styles";

declare module "@mui/material/styles" {
  interface Theme {
    functions: {
      linearGradient: (main: string, state: string) => string;
    };
  }

  interface PaletteColor {
    main: string;
    state?: string; // Add state property
  }

  interface Palette {
    gradients?: {
      [key: string]: PaletteColor;
      dark?: PaletteColor;
    };
    transparent?: PaletteColor;
    white?: PaletteColor;
  }
}