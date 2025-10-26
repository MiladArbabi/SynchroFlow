/* eslint-disable @typescript-eslint/no-unused-vars */
// packages/ui/src/components/Customer360/CustomerProfile.tsx
import React from 'react';
import { Box, Typography, Grid, Chip, Stack, Paper, Divider } from '@mui/material';
import { Mail, Phone, Home, FileText } from 'lucide-react'; // Example icons

// Define the structure for address (simplified)
interface Address {
  street?: string | null;
  city?: string | null;
  state?: string | null;
  zip?: string | null;
  country?: string | null;
}

// Define the structure for the customer prop
export interface CustomerProfileData {
  name?: string | null;
  email?: string | null;
  phone?: string | null;
  tags?: string[] | null;
  shippingAddress?: Address | null;
  billingAddress?: Address | null;
  accountCreated?: string | null; // ISO Date string
  source?: string | null;
}

interface CustomerProfileProps {
  customer: CustomerProfileData | null | undefined;
}

// Helper to format an address string
const formatAddress = (address: Address | null | undefined): string => {
  if (!address) return 'N/A';
  const parts = [
    address.street,
    address.city,
    address.state,
    address.zip,
    address.country,
  ].filter(Boolean); // Filter out null/undefined/empty strings
  return parts.join(', ') || 'N/A';
};

/**
 * CustomerProfile: Displays detailed profile information for a customer.
 */
const CustomerProfile: React.FC<CustomerProfileProps> = ({ customer }) => {
  if (!customer) {
    return (
      <Paper sx={{ p: 2, height: '100%' }}>
        <Typography variant="h6" gutterBottom>Profile</Typography>
        <Typography variant="body2" color="textSecondary">
          Profile data unavailable.
        </Typography>
      </Paper>
    );
  }

  const isBillingSameAsShipping = customer.shippingAddress && customer.billingAddress &&
    formatAddress(customer.shippingAddress) === formatAddress(customer.billingAddress);

  return (
    <Paper sx={{ p: 2, height: '100%' }}>
      <Typography variant="h6" gutterBottom>{customer.name || 'Unnamed Customer'}</Typography>
      <Divider sx={{ mb: 2 }} />

      <Stack spacing={2}>
        {/* Contact Info */}
        <Stack direction="row" spacing={1} alignItems="center">
          <Mail size={16} />
          <Typography variant="body2">{customer.email || 'N/A'}</Typography>
        </Stack>
        <Stack direction="row" spacing={1} alignItems="center">
          <Phone size={16} />
          <Typography variant="body2">{customer.phone || 'N/A'}</Typography>
        </Stack>

        {/* Tags */}
        {customer.tags && customer.tags.length > 0 && (
          <Box>
            <Typography variant="caption" color="textSecondary" display="block" mb={0.5}>Tags</Typography>
            <Stack direction="row" spacing={1} flexWrap="wrap">
              {customer.tags.map(tag => (
                <Chip key={tag} label={tag} size="small" sx={{ mb: 0.5 }}/>
              ))}
            </Stack>
          </Box>
        )}

        <Divider />

        {/* Shipping Address */}
        <Box>
          <Typography variant="caption" color="textSecondary" display="block" mb={0.5}>Shipping Address</Typography>
          <Stack direction="row" spacing={1} alignItems="flex-start">
            <Home size={16} style={{ marginTop: '4px' }}/>
            <Typography variant="body2">{formatAddress(customer.shippingAddress)}</Typography>
          </Stack>
        </Box>

        {/* Billing Address */}
        <Box>
           <Typography variant="caption" color="textSecondary" display="block" mb={0.5}>Billing Address</Typography>
           <Stack direction="row" spacing={1} alignItems="flex-start">
             <FileText size={16} style={{ marginTop: '4px' }}/>
             <Typography variant="body2">
               {isBillingSameAsShipping ? 'Same as Shipping' : formatAddress(customer.billingAddress)}
             </Typography>
           </Stack>
        </Box>

        {/* TODO: Add Account Created / Source if needed */}

      </Stack>
    </Paper>
  );
};

export default CustomerProfile;