// packages/ui/src/components/ConnectStoreCard.tsx
import React from 'react';
import { Button, Typography, Box } from '@mui/material';
import MainCard from 'ui-component/cards/MainCard';
import IconComponent from 'components/Icon';

interface ConnectStoreCardProps {
  onOpenModal: () => void;
}

export const ConnectStoreCard: React.FC<ConnectStoreCardProps> = ({ onOpenModal }) => {
  return (
    <MainCard 
      sx={{ 
        backgroundColor: (theme) => 
          theme.palette.mode === 'dark' ? theme.palette.grey[800] : theme.palette.primary.light,
        borderColor: (theme) => 
          theme.palette.mode === 'dark' ? theme.palette.grey[700] : theme.palette.primary.dark,
        borderWidth: '1px',
        borderStyle: 'solid',
      }}
    >
      <Box sx={{ textAlign: 'center' }}>
        <Typography variant="h5" gutterBottom>
          Connect Store
        </Typography>
        <Typography variant="body2" sx={{ mb: 2 }}>
          Your data sources aren't connected. Get started now.
        </Typography>
        <Button
          variant="contained"
          color="primary"
          size="small"
          onClick={onOpenModal}
          startIcon={<IconComponent name="Plus" size="small" />}
        >
          Connect
        </Button>
      </Box>
    </MainCard>
  );
};

export default ConnectStoreCard;