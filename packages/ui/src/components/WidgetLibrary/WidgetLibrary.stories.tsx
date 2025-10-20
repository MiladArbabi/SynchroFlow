// packages/ui/src/components/WidgetLibrary/WidgetLibrary.stories.tsx
import type { Meta, StoryObj } from "@storybook/react";
import WidgetLibrary from ".";

const meta: Meta<typeof WidgetLibrary> = {
  title: "Components/WidgetLibrary",
  component: WidgetLibrary,
};

export default meta;
type Story = StoryObj<typeof WidgetLibrary>;

export const Default: Story = {
  args: {
    open: true,
    onClose: () => console.log("Close clicked"),
  },
};