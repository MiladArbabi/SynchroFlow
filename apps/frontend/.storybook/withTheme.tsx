// apps/frontend/.storybook/withTheme.tsx
import React from "react";
import type { Decorator } from "@storybook/react";
import { ThemeProvider, createTheme } from "@mui/material/styles";
import CssBaseline from "@mui/material/CssBaseline";
import { UserProvider } from "context";
const basicTheme = createTheme();


// This is the actual decorator that will be exported
export const withTheme: Decorator = (Story) => {
  return (
    // First, provide the context for the entire story
    <UserProvider>
      <ThemeProvider theme={basicTheme}>
        <CssBaseline />
        <Story/>
      </ThemeProvider>
    </UserProvider>
  );
};