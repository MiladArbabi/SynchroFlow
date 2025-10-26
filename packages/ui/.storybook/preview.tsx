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

    a11y: {
      // 'todo' - show a11y violations in the test UI only
      // 'error' - fail CI on a11y violations
      // 'off' - skip a11y checks entirely
      test: "todo"
    }
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