/* eslint-disable @typescript-eslint/no-unused-vars */
// packages/ui/src/components/EchoHub/EchoHubMiddlePane.tsx
import React from 'react';
import {
  Avatar,
  Badge,
  Box,
  Chip,
  List,
  ListItem,
  ListItemAvatar,
  ListItemButton,
  ListItemText,
  Typography,
} from '@mui/material';

// Define a type for conversation status and map colors
type ConversationStatus = 'Open' | 'Pending' | 'Resolved';
const statusColors: Record<ConversationStatus, 'success' | 'warning' | 'default'> = {
  Open: 'success',
  Pending: 'warning',
  Resolved: 'default',
};

// Define the structure for mock data
interface MockConversation {
  id: string;
  customerName: string;
  avatarInitial: string; // For Avatar
  subject: string;
  timestamp: string; // e.g., "10m ago", "Yesterday"
  status: ConversationStatus;
  unread: boolean;
}

// Static mock data for v1
const mockConversations: MockConversation[] = [
  { id: 'conv1', customerName: 'Alice Johnson', avatarInitial: 'A', subject: 'Regarding Order #12345', timestamp: '10m ago', status: 'Open', unread: true },
  { id: 'conv2', customerName: 'Bob Williams', avatarInitial: 'B', subject: 'Question about Shipping', timestamp: '1h ago', status: 'Pending', unread: false },
  { id: 'conv3', customerName: 'Charlie Davis', avatarInitial: 'C', subject: 'Return Request - SF-TS-BLK-M', timestamp: 'Yesterday', status: 'Resolved', unread: false },
  { id: 'conv4', customerName: 'Diana Miller', avatarInitial: 'D', subject: 'Urgent: Wrong Item Received', timestamp: '2d ago', status: 'Open', unread: true },
];

/**
 * EchoHubMiddlePane: Displays a list of conversations.
 */
const EchoHubMiddlePane: React.FC = () => {
  // We'll add selected state later
  const [selectedConversationId, setSelectedConversationId] = React.useState<string | null>(mockConversations[0]?.id ?? null); // Select first by default

  return (
    <List dense sx={{ width: '100%', height: '100%', bgcolor: 'background.paper', overflowY: 'auto', p: 0 }}>
      {mockConversations.map((conv) => (
        <ListItem
          key={conv.id}
          disablePadding
          secondaryAction={ // Display timestamp on the right
            <Typography variant="caption" color="text.secondary">
              {conv.timestamp}
            </Typography>
          }
        >
          <ListItemButton
            selected={selectedConversationId === conv.id}
            // onClick={() => setSelectedConversationId(conv.id)} // Add functionality later
            sx={{ alignItems: 'flex-start' }} // Align items nicely
          >
            <ListItemAvatar sx={{ mt: 0.5 }}>
              <Badge color="primary" variant="dot" invisible={!conv.unread}>
                <Avatar sx={{ width: 32, height: 32, fontSize: '0.875rem' }}>{conv.avatarInitial}</Avatar>
              </Badge>
            </ListItemAvatar>
            <ListItemText
              primary={ // Customer Name and Status Chip inline
                <Box component="span" sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <Typography component="span" variant="subtitle2" color="text.primary">
                    {conv.customerName}
                  </Typography>
                  <Chip
                    label={conv.status}
                    size="small"
                    color={statusColors[conv.status]}
                    sx={{ ml: 1, height: '18px', fontSize: '0.65rem' }}
                  />
                </Box>
              }
              secondary={ // Subject line
                <Typography
                  component="span"
                  variant="body2"
                  color="text.secondary"
                  sx={{
                    display: 'block', // Ensure it takes full width
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                  }}
                >
                  {conv.subject}
                </Typography>
              }
              sx={{ mr: 2 }} // Margin to prevent overlap with timestamp
            />
          </ListItemButton>
        </ListItem>
      ))}
    </List>
  );
};

export default EchoHubMiddlePane;