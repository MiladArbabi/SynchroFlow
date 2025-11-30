/* eslint-disable @typescript-eslint/no-unused-vars */
// apps/frontend/src/components/Customer360/CustomerSessionHistory.tsx
import React from 'react';
import { Box, Typography, Paper, Chip, List, ListItem, ListItemText } from '@mui/material';
import { useSessionTracking } from 'hooks/useSessionTracking';

interface CustomerSessionHistoryProps {
  customerId: string;
}

export const CustomerSessionHistory: React.FC<CustomerSessionHistoryProps> = ({ customerId }) => {
  const { sessionId, fingerprint, pageViews, isReturningVisitor } = useSessionTracking();

  // Mock session history - in real implementation, this would come from API
  const sessionHistory = [
    { id: '1', timestamp: new Date(Date.now() - 86400000), pageCount: 5, intentScore: 65 },
    { id: '2', timestamp: new Date(Date.now() - 172800000), pageCount: 3, intentScore: 42 },
    { id: '3', timestamp: new Date(Date.now() - 259200000), pageCount: 8, intentScore: 78 },
  ];

  return (
    <Paper sx={{ p: 2 }}>
      <Typography variant="h6" gutterBottom>
        Session History
      </Typography>
      
      <Box sx={{ mb: 2 }}>
        <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', mb: 2 }}>
          <Chip 
            label={isReturningVisitor ? "Returning Visitor" : "New Visitor"} 
            color={isReturningVisitor ? "primary" : "default"}
            size="small"
          />
          <Chip 
            label={`Fingerprint: ${fingerprint?.substring(0, 8)}...`} 
            variant="outlined"
            size="small"
          />
        </Box>
      </Box>

      <List dense>
        {sessionHistory.map((session) => (
          <ListItem key={session.id} divider>
            <ListItemText
              primary={
                <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <Typography variant="body2">
                    {session.timestamp.toLocaleDateString()} - {session.pageCount} pages
                  </Typography>
                  <Chip 
                    label={`Score: ${session.intentScore}`}
                    size="small"
                    color={
                      session.intentScore >= 70 ? "success" : 
                      session.intentScore >= 40 ? "warning" : "default"
                    }
                  />
                </Box>
              }
              secondary={`${session.timestamp.toLocaleTimeString()} - Intent Level: ${
                session.intentScore >= 70 ? "High" : 
                session.intentScore >= 40 ? "Medium" : "Low"
              }`}
            />
          </ListItem>
        ))}
      </List>

      {/* Current Session */}
      {sessionId && (
        <Box sx={{ mt: 2, p: 1, bgcolor: 'success.light', borderRadius: 1 }}>
          <Typography variant="subtitle2" gutterBottom>
            Current Active Session
          </Typography>
          <Typography variant="body2">
            Started: {new Date().toLocaleTimeString()}
          </Typography>
          <Typography variant="body2">
            Pages viewed: {pageViews.length}
          </Typography>
        </Box>
      )}
    </Paper>
  );
};