// apps/frontend/src/ui-component/ContextPanel/index.tsx
import React, { useState, ReactNode } from 'react';
import { Box, Tabs, Tab } from '@mui/material';
import MainCard from 'ui-component/cards/MainCard';
import TabPanel from './TabPanel'; // Import the helper

// Define the structure for a tab
export interface ContextPanelTab {
  label: string;
  content: ReactNode;
}

interface ContextPanelProps {
  tabs: ContextPanelTab[];
}

/**
 * ContextPanel: Renders a MainCard with MUI Tabs in the header
 * and manages the active tab state.
 */
const ContextPanel: React.FC<ContextPanelProps> = ({ tabs }) => {
  const [value, setValue] = useState(0);

  const handleChange = (event: React.SyntheticEvent, newValue: number) => {
    setValue(newValue);
  };

  const tabHeader = (
    <Box sx={{ borderBottom: 1, borderColor: 'divider' }}>
      <Tabs 
        value={value} 
        onChange={handleChange} 
        aria-label="context panel tabs"
      >
        {tabs.map((tab, index) => (
          <Tab 
            key={tab.label}
            label={tab.label} 
            id={`context-tab-${index}`}
            aria-controls={`context-tabpanel-${index}`}
          />
        ))}
      </Tabs>
    </Box>
  );

  return (
    <MainCard 
      title={tabHeader}
      content={false}
      sx={{ height: '100%' }}
    >
      <Box sx={{ 
        height: 'calc(100% - 49px)',
         overflowY: 'auto',
         pb: 3
      }}>
      {tabs.map((tab, index) => (
        <TabPanel key={tab.label} value={value} index={index}>
          {tab.content}
        </TabPanel>
      ))}
      </Box>
    </MainCard>
  );
};

export default ContextPanel;