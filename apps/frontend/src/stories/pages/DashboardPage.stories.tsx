/* eslint-disable @typescript-eslint/no-explicit-any */
// apps/frontend/src/stories/pages/DashboardPage.stories.tsx
import React from 'react';
import { DashboardPage } from 'pages/DashboardPage';

export default {
  title: 'Pages/DashboardPage',
  component: DashboardPage,
};

const Template = (args: any) => <DashboardPage {...args} />;

export const Default = Template.bind({});
Default.args = {
  children: <div>Test Children</div>,
  handleSidenavToggle: () => console.log('Toggle sidenav'),
};