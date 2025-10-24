// packages/ui/src/ui-component/ContextPanel/TabPanel.tsx
import React, { ReactNode } from 'react';
import { Box } from '@mui/material';

interface TabPanelProps {
  children?: ReactNode;
  index: number;
  value: number;
}

/**
 * Standard MUI TabPanel helper component.
 * It renders its children only when the 'value' matches its 'index'.
 */
const TabPanel: React.FC<TabPanelProps> = ({ children, value, index }) => {
  return (
    <div
      role="tabpanel"
      hidden={value !== index}
      id={`context-tabpanel-${index}`}
      aria-labelledby={`context-tab-${index}`}
    >
      {value === index && (
        <Box sx={{ p: 3 }}>
          {children}
        </Box>
      )}
    </div>
  );
};

export default TabPanel;