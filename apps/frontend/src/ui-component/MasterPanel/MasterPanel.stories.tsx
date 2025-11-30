// apps/frontend/src/ui-component/MasterPanel/MasterPanel.stories.tsx
import type { Meta, StoryObj } from '@storybook/react';
import MasterPanel from '.'; // Import the new component

const meta: Meta<typeof MasterPanel> = {
  title: 'SynchroFlow/MasterPanel',
  component: MasterPanel,
  parameters: {
    layout: 'fullscreen',
  },
  tags: ['autodocs'],
  argTypes: {
    title: { control: 'text' },
  },
};

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    title: 'Master Panel Title',
    children: (
      <div style={{ padding: '16px', height: '400px', background: '#f5f5f5' }}>
        This is the children prop. A DataGrid or List would go here.
      </div>
    ),
  },
};

export const WithStringTitle: Story = {
  args: {
    title: 'Just a String Title',
    children: <div style={{ padding: '16px' }}>Child content</div>,
  },
};