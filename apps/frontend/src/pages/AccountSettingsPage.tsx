// apps/frontend/src/pages/AccountSettingsPage.tsx
import React, { useState } from 'react';

// material-ui
import { Box, Tabs, Tab, Typography } from '@mui/material';
import MainCard from 'ui-component/cards/MainCard';

// project imports
import LocalizationSettings from './account-settings/LocalizationSettings';
import IconComponent from 'components/Icon';

// ==============================|| TAB PANEL HELPER ||============================== //

interface TabPanelProps {
  children?: React.ReactNode;
  index: number;
  value: number;
}

function TabPanel(props: TabPanelProps) {
  const { children, value, index, ...other } = props;

  return (
    <div
      role="tabpanel"
      hidden={value !== index}
      id={`account-settings-tabpanel-${index}`}
      aria-labelledby={`account-settings-tab-${index}`}
      {...other}
    >
      {value === index && (
        <Box sx={{ p: 3 }}>
          {children}
        </Box>
      )}
    </div>
  );
}

function a11yProps(index: number) {
  return {
    id: `account-settings-tab-${index}`,
    'aria-controls': `account-settings-tabpanel-${index}`,
  };
}

// ==============================|| ACCOUNT SETTINGS PAGE ||============================== //

const AccountSettingsPage: React.FC = () => {
  const [value, setValue] = useState(0);

  const handleChange = (event: React.SyntheticEvent, newValue: number) => {
    setValue(newValue);
  };

  return (
    <MainCard title="Account Settings" content={false}>
      <Box sx={{ width: '100%' }}>
        <Box sx={{ borderBottom: 1, borderColor: 'divider' }}>
          <Tabs value={value} onChange={handleChange} aria-label="Account settings tabs">
            <Tab
              label="Localization"
              icon={<IconComponent name="Languages" size="small" />}
              iconPosition="start"
              {...a11yProps(0)}
            />
            <Tab
              label="Profile"
              icon={<IconComponent name="User" size="small" />}
              iconPosition="start"
              {...a11yProps(1)}
            />
            <Tab
              label="Security"
              icon={<IconComponent name="Lock" size="small" />}
              iconPosition="start"
              {...a11yProps(2)}
            />
          </Tabs>
        </Box>
        <TabPanel value={value} index={0}>
          <LocalizationSettings />
        </TabPanel>
        <TabPanel value={value} index={1}>
          <Typography>Profile settings placeholder. (e.g., change name, email)</Typography>
        </TabPanel>
        <TabPanel value={value} index={2}>
          <Typography>Security settings placeholder. (e.g., change password, 2FA)</Typography>
        </TabPanel>
      </Box>
    </MainCard>
  );
};

export default AccountSettingsPage;