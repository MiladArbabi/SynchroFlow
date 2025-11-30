// apps/frontend/src/ui-component/ContextPanel/ContextPanel.stories.tsx
import type { Meta, StoryObj } from '@storybook/react';
import ContextPanel, { ContextPanelTab } from '.';

const meta: Meta<typeof ContextPanel> = {
  title: 'SynchroFlow/ContextPanel',
  component: ContextPanel,
  parameters: {
    layout: 'fullscreen',
  },
  tags: ['autodocs'],
};

export default meta;
type Story = StoryObj<typeof meta>;

const sampleTabs: ContextPanelTab[] = [
  {
    label: 'Summary',
    content: <div>This is the summary content for the entity.</div>
  },
  {
    label: 'Order History',
    content: <div>This panel would contain a data grid of past orders.</div>
  },
  {
    label: 'Actions & Assist',
    content: <div>This panel would contain AI suggestions and manual action buttons.</div>
  }
];

export const Default: Story = {
  args: {
    tabs: sampleTabs,
  },
};

export const TwoTabs: Story = {
  args: {
    tabs: [
      { label: 'Tab One', content: <div>Content 1</div> },
      { label: 'Tab Two', content: <div>Content 2</div> },
    ],
  },
};