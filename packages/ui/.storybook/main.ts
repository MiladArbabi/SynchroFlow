// packages/ui/.storybook/main.ts
import type { StorybookConfig } from "@storybook/react-vite";
import path from "path";

const config: StorybookConfig = {
  stories: ["../src/**/*.mdx", "../src/**/*.stories.@(js|jsx|mjs|ts|tsx)"],
  addons: [
    "@storybook/addon-links",
    "@storybook/addon-essentials",
    "@storybook/addon-onboarding",
    "@storybook/addon-interactions",
    "@storybook/addon-a11y",
    "@storybook/addon-vitest",
  ],
  framework: {
    name: "@storybook/react-vite",
    options: {},
  },
  // FIX 2: This viteFinal config correctly maps all aliases found in your project's code.
  // This is the root cause of the "Failed to resolve import" errors.
  async viteFinal(config) {
// THIS IS THE ROBUST FIX:
    // 1. Ensure config.resolve exists
    if (!config.resolve) {
      config.resolve = {};
    }
    // 2. Ensure config.resolve.alias exists
    if (!config.resolve.alias) {
      config.resolve.alias = {};
    }
    // 3. Now, we can safely assign our aliases
    Object.assign(config.resolve.alias, {
      assets: path.resolve(__dirname, "../src/assets"),
      components: path.resolve(__dirname, "../src/components"),
      context: path.resolve(__dirname, "../src/contexts/UserContext.tsx"),
      layouts: path.resolve(__dirname, "../src/layouts"),
      pages: path.resolve(__dirname, "../src/pages"),
    });

    return config;
  },
};
export default config;