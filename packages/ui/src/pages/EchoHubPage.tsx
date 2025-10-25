// packages/ui/src/pages/EchoHubPage.tsx
import React from 'react';
import { Box, Grid, Paper, Typography } from '@mui/material';

/**
 * EchoHubPage: The main container for the Echo Hub UI.
 * Implements the initial 3-pane layout shell.
 */
const EchoHubPage: React.FC = () => {
  return (
    // Use a Box that fills the available height within the main layout
    <Box sx={{ height: 'calc(100vh - 64px - 32px)', display: 'flex', p: 1 }}> {/* Adjust height based on header/padding */}
      <Grid container spacing={1} sx={{ height: '100%' }}>

        {/* --- Left Pane (Sources/Filters) --- */}
        <Grid
          item
          sx={{ height: { xs: '30%', sm: '100%' } }} // Adjust height when stacked
          xs={12} sm={3} md={2}
        >
          <Paper sx={{ height: '100%', p: 1, overflowY: 'auto' }}>
            <Typography variant="h6">Sources</Typography>
            <Box mt={1}>Sources Pane Placeholder</Box>
            {/* Future: Add List component here */}
          </Paper>
        </Grid>

        {/* --- Middle Pane (Conversations) --- */}
        <Grid
          item
          // Stack on xs, take 5/12 on sm, take 7/12 on md and up
          sx={{ height: { xs: '40%', sm: '100%' } }} // Adjust height when stacked
          xs={12} sm={5} md={7}
        >
          <Paper sx={{ height: '100%', p: 1, overflowY: 'auto' }}>
            <Typography variant="h6">Conversations</Typography>
            <Box mt={1}>Conversations Pane Placeholder</Box>
            {/* Future: Add List component here */}
          </Paper>
        </Grid>

        {/* --- Right Pane (Details/Context) --- */}
        <Grid item xs={12} sm={5} md={7} sx={{ height: '100%' }}>
          <Paper sx={{ height: '100%', p: 1, overflowY: 'auto' }}>
            <Typography variant="h6">Details</Typography>
            <Box mt={1}>Details Pane Placeholder</Box>
            {/* Future: Add Thread, Composer, Tabs here */}
          </Paper>
        </Grid>

      </Grid>
    </Box>
  );
};

export default EchoHubPage;