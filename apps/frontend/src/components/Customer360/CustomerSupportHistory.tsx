/* eslint-disable @typescript-eslint/no-unused-vars */
// apps/frontend/src/components/Customer360/CustomerSupportHistory.tsx
import React from 'react';
import {
  Box,
  Chip,
  CircularProgress,
  Divider,
  List,
  ListItem,
  ListItemText,
  Typography,
} from '@mui/material';

// Define the structure for a single support ticket
export interface SupportTicket {
  id: string; // Ticket ID like TKT-501
  subject: string;
  date: string; // Expecting ISO string date
  status: 'Open' | 'Pending' | 'Resolved' | 'Closed'; // Example statuses
}

interface CustomerSupportHistoryProps {
  tickets: SupportTicket[] | undefined | null; // Allow undefined for loading
  isLoading?: boolean;
}

// Define colors for status chips
const statusColors: Record<SupportTicket['status'], 'success' | 'warning' | 'default' | 'info'> = {
  Open: 'success',
  Pending: 'warning',
  Resolved: 'default',
  Closed: 'info', // Example color
};

/**
 * Formats an ISO date string into a simple format (e.g., Oct 25, 2025).
 */
const formatDate = (dateString: string | undefined | null): string => {
  if (!dateString) return '--';
  try {
    return new Intl.DateTimeFormat('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    }).format(new Date(dateString));
  } catch (e) {
    return '--';
  }
};

/**
 * A component displaying a customer's support ticket history.
 */
const CustomerSupportHistory: React.FC<CustomerSupportHistoryProps> = ({ tickets, isLoading }) => {
  if (isLoading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: 100 }}>
        <CircularProgress />
      </Box>
    );
  }

  if (!tickets || tickets.length === 0) {
    return (
      <Typography variant="body2" color="textSecondary" sx={{ p: 2 }}>
        No support history available.
      </Typography>
    );
  }

  return (
    // Use List for structured display
    <List dense disablePadding>
      {tickets.map((ticket, index) => (
        <React.Fragment key={ticket.id}>
          <ListItem
            alignItems="flex-start"
            secondaryAction={ // Display Date and Status Chip
              <Box sx={{ textAlign: 'right' }}>
                <Typography variant="caption" color="textSecondary" display="block">
                  {formatDate(ticket.date)}
                </Typography>
                <Chip
                  label={ticket.status}
                  size="small"
                  color={statusColors[ticket.status] || 'default'}
                  sx={{ mt: 0.5, height: '18px', fontSize: '0.65rem' }}
                />
              </Box>
            }
            sx={{ pr: 12 }} // Add paddingRight to avoid overlap with secondaryAction
          >
            <ListItemText
              primary={ // Ticket ID
                <Typography variant="subtitle2" component="span" color="text.secondary">
                  {ticket.id}
                </Typography>
              }
              secondary={ // Subject
                <Typography
                  variant="body2"
                  color="text.primary"
                  sx={{
                    display: 'block', // Ensure it takes full width below ID
                    mt: 0.25
                  }}
                >
                  {ticket.subject}
                </Typography>
              }
            />
          </ListItem>
          {index < tickets.length - 1 && <Divider component="li" />}
        </React.Fragment>
      ))}
    </List>
  );
};

export default CustomerSupportHistory;