// packages/ui/.storybook/preview.tsx
import type { Preview } from "@storybook/react";
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
  // This applies our theme decorator to all stories in the project.
  decorators: [withTheme],
};

export default preview;