// assets
import { IconHelp, IconSitemap } from '@tabler/icons-react';

// constant
const icons = {
  IconHelp,
  IconSitemap
};

// ==============================|| SAMPLE PAGE & DOCUMENTATION MENU ITEMS ||============================== //

const other = {
  id: 'sample-docs-roadmap',
  icon: IconHelp,
  type: 'group',
  children: [
    {
      id: 'documentation',
      title: 'documentation',
      type: 'item',
      url: 'https://codedthemes.gitbook.io/berry/',
      icon: icons.IconHelp,
      external: true,
      target: true
    }
  ]
};

export default other;
