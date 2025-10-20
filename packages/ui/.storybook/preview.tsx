// packages/ui/.storybook/preview.tsx
import type { Preview } from "@storybook/react";
import { MemoryRouter } from "react-router-dom";
import { withTheme } from "./withTheme"; // Import our corrected decorator

const preview: Preview = {
  parameters: {
    controls: {
      matchers: {
        color: /(background|color)$/i,
        date: /Date$/i,
      },
    },
  },
  decorators: [
    withTheme,
    // This decorator wraps all stories in a MemoryRouter
    (Story) => (
      <MemoryRouter>
        <Story />
      </MemoryRouter>
    ),
  ],
};

export default preview;