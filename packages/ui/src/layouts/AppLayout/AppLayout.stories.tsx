// packages/ui/src/layouts/AppLayout/AppLayout.stories.tsx

import type { Meta, StoryObj } from "@storybook/react";
import AppLayout from ".";

const meta: Meta<typeof AppLayout> = {
  title: "Layouts/Production/AppLayout",
  component: AppLayout,
  parameters: {
    layout: 'fullscreen',
  },
};

export default meta;
type Story = StoryObj<typeof AppLayout>;

export const Default: Story = {};