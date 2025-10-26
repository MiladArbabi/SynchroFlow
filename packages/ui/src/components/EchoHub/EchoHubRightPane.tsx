// packages/ui/src/components/EchoHub/EchoHubRightPane.tsx
import React, { useState } from 'react';
import {
  Box,
  Tabs,
  Tab,
  Typography,
  Divider,
  TextField,
  Button,
  Stack,
  Paper,
} from '@mui/material';
import { Send } from 'lucide-react'; // Example Icon

// Helper TabPanel component (can be reused or defined locally if preferred)
interface TabPanelProps {
  children?: React.ReactNode;
  index: number;
  value: number;
}
const TabPanel: React.FC<TabPanelProps> = ({ children, value, index }) => (
  <div role="tabpanel" hidden={value !== index} id={`right-pane-tabpanel-${index}`} aria-labelledby={`right-pane-tab-${index}`}>
    {value === index && <Box sx={{ p: 2, height: '100%', overflowY: 'auto' }}>{children}</Box>}
  </div>
);

interface EchoHubRightPaneProps {
  selectedId: string | null;
}

/**
 * EchoHubRightPane: Displays the selected conversation, context tabs, and composer.
 */
const EchoHubRightPane: React.FC<EchoHubRightPaneProps> = ({ selectedId }) => {
  const [tabValue, setTabValue] = useState(0); // Default to 'Conversation' tab

  const handleTabChange = (event: React.SyntheticEvent, newValue: number) => {
    setTabValue(newValue);
  };

  // Mock conversation content
  const MockConversationThread = ({ id }: { id: string | null }) => (
    <Stack spacing={1} sx={{ p: 1 }}>
      <Typography variant="subtitle2">Details for Conversation: {id ?? 'None Selected'}</Typography>
      <Divider sx={{ my: 1 }} />
      {id === 'conv1' && <>
        <Typography variant="body2">**Alice Johnson** - 10m ago</Typography>
        <Typography variant="body1">Regarding Order #12345...</Typography>
      </>}
      {id === 'conv2' && <>
        <Typography variant="body2">**Bob Williams** - 1h ago</Typography>
        <Typography variant="body1">Question about Shipping...</Typography>
      </>}
      {id === 'conv3' && <Typography variant="body1">Charlie's return request...</Typography>}
      {id === 'conv4' && <Typography variant="body1">Diana - Urgent: Wrong Item...</Typography>}
    </Stack>
  );

  return (
    // Use Paper for background and structure, flex column layout
    <Paper sx={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      {/* Context Tabs */}
      <Box sx={{ borderBottom: 1, borderColor: 'divider' }}>
        <Tabs value={tabValue} onChange={handleTabChange} aria-label="Echo Hub context tabs">
          <Tab label="Conversation" id="right-pane-tab-0" aria-controls="right-pane-tabpanel-0" />
          <Tab label="Customer 360" id="right-pane-tab-1" aria-controls="right-pane-tabpanel-1" />
          <Tab label="Order 360" id="right-pane-tab-2" aria-controls="right-pane-tabpanel-2" />
        </Tabs>
      </Box>

      {/* Tab Content Area (Scrollable) */}
      <Box sx={{ flexGrow: 1, overflowY: 'auto' }}>
        <TabPanel value={tabValue} index={0}>
          {/* Conversation Thread */}
          <MockConversationThread id={selectedId} />
        </TabPanel>
        <TabPanel value={tabValue} index={1}>
          <Typography>Customer 360 Placeholder Content</Typography>
          {/* Future: Embed Customer 360 component */}
        </TabPanel>
        <TabPanel value={tabValue} index={2}>
          <Typography>Order 360 Placeholder Content</Typography>
          {/* Future: Embed Order 360 component */}
        </TabPanel>
      </Box>

      <Divider />

      {/* Response Composer */}
      <Box sx={{ p: 2, borderTop: 1, borderColor: 'divider' }}>
        <Stack direction="row" spacing={1} alignItems="center">
          <TextField
            label="Reply..."
            multiline
            rows={2}
            fullWidth
            variant="outlined"
            size="small"
            InputLabelProps={{ shrink: true }} // Keep label floated
          />
          <Button variant="contained" endIcon={<Send size={16} />} aria-label="Send Reply">
            Send
          </Button>
        </Stack>
      </Box>
    </Paper>
  );
};

export default EchoHubRightPane;