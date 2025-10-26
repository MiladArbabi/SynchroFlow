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
import CustomerProfile from 'components/Customer360/CustomerProfile.tsx';
import CustomerKeyMetrics from 'components/Customer360/CustomerKeyMetrics.tsx';

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

  // --- ADD MOCK CUSTOMER DATA (Fetch/derive later based on selectedId) ---
  const mockCustomer = {
    // Assuming an order object would contain customer info or an ID to fetch it
    name: `Customer for ${selectedId}`, // Example dynamic name
    email: 'john.doe@example.com',
    phone: '555-1234',
    tags: ['VIP'],
    shippingAddress: { street: '123 Main St', city: 'Anytown', state: 'CA', zip: '12345', country: 'USA' },
    billingAddress: { street: '123 Main St', city: 'Anytown', state: 'CA', zip: '12345', country: 'USA' },
    accountCreated: '2024-01-15T10:00:00Z',
    source: 'Shopify',
  };

  const mockMetrics = {
    ltv: 1204.50,
    aov: 110.40,
    totalOrders: 11,
    totalMargin: 550.25,
    lastOrderDate: '2025-10-15T09:30:00Z',
  };
  // --- END MOCK DATA ---

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
          <Stack spacing={2}> {/* Add spacing between components */}
            <CustomerProfile customer={mockCustomer} />
            <CustomerKeyMetrics metrics={mockMetrics} />
          </Stack>
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