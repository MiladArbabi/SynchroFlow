// apps/frontend/src/layouts/SpikeLayout/SpikeLayout.stories.tsx
import type { Meta, StoryObj } from "@storybook/react";
import SpikeResizableLayout from ".";

const meta: Meta<typeof SpikeResizableLayout> = {
  title: "Layouts/SpikeResizableLayout",
  component: SpikeResizableLayout,
  // Tell Storybook to render this component in a full-screen layout
  parameters: {
    layout: 'fullscreen',
  },
};

export default meta;
type Story = StoryObj<typeof SpikeResizableLayout>;

// The layout component doesn't take any props, so its story is very simple
export const Default: Story = {};