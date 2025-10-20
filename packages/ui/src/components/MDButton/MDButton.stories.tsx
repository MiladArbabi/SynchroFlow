// packages/ui/src/components/MDButton/MDButton.stories.tsx
import type { Meta, StoryObj } from "@storybook/react";
import MDButton from "."; // Assuming the default export is the component

// This meta object configures the story in the Storybook UI
const meta: Meta<typeof MDButton> = {
  title: "Components/MDButton", // This creates the folder structure in the Storybook sidebar
  component: MDButton,
  tags: ["autodocs"], // Enables automatic documentation generation
  argTypes: {
    color: {
      control: "select",
      options: ["primary", "secondary", "info", "success", "warning", "error", "light", "dark"],
    },
    variant: {
      control: "select",
      options: ["text", "contained", "outlined", "gradient"],
    },
    size: {
      control: "select",
      options: ["small", "medium", "large"],
    },
  },
};

export default meta;
type Story = StoryObj<typeof MDButton>;

// This is our first "story," or a specific state of the component
export const Primary: Story = {
  args: {
    variant: "contained",
    color: "primary",
    children: "Primary Button",
  },
};

export const Outlined: Story = {
  args: {
    variant: "outlined",
    color: "info",
    children: "Outlined Button",
  },
};