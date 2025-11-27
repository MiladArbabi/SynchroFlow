// packages/ui/src/pages/CustomersPage.tsx
import React from 'react';
import { Box, Typography, Chip, Grid, Card, CardContent } from '@mui/material';
import {
  Psychology,
  RocketLaunch,
  Analytics,
  ExitToApp
} from '@mui/icons-material';
import MasterPanel from 'ui-component/MasterPanel/index.tsx';

/**
 * CustomersPage: Minimal Specter-focused page showcasing conversion intelligence features
 */

const CustomersPage: React.FC = () => {
  return (
    <MasterPanel title="Customer Intelligence">
      <Box sx={{ p: 3, maxWidth: 800, margin: '0 auto' }}>
        {/* Header Section */}
        <Box sx={{ textAlign: 'center', mb: 4 }}>
          <Psychology sx={{ fontSize: 48, color: 'primary.main', mb: 2 }} />
          <Typography variant="h4" component="h1" gutterBottom>
            Customer Intelligence + Conversion Optimization
          </Typography>
          <Typography variant="h6" color="text.secondary" sx={{ mb: 3 }}>
            Real-time behavioral insights and cross-platform customer intelligence
          </Typography>
          
          <Box sx={{ display: 'flex', gap: 1, justifyContent: 'center', flexWrap: 'wrap' }}>
            <Chip label="Real-time Intent Scoring" color="primary" variant="filled" />
            <Chip label="Exit-Intent Detection" color="primary" variant="filled" />
            <Chip label="A/B Testing" color="primary" variant="filled" />
            <Chip label="Behavioral Analytics" color="primary" variant="filled" />
          </Box>
        </Box>

        {/* Feature Cards */}
        <Grid container spacing={3}>
          <Grid size={{ xs: 12, sm: 6 }}>
            <Card sx={{ height: '100%', textAlign: 'center' }}>
              <CardContent>
                <Psychology sx={{ fontSize: 40, color: 'primary.main', mb: 2 }} />
                <Typography variant="h6" gutterBottom>
                  Real-time Intent Scoring
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  Track visitor behavior and predict conversion probability with AI-powered intent scoring.
                </Typography>
              </CardContent>
            </Card>
          </Grid>
          
          <Grid size={{ xs: 12, sm: 6 }}>
            <Card sx={{ height: '100%', textAlign: 'center' }}>
              <CardContent>
                <ExitToApp sx={{ fontSize: 40, color: 'primary.main', mb: 2 }} />
                <Typography variant="h6" gutterBottom>
                  Exit-Intent Detection
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  Capture abandoning visitors and present targeted offers to recover potential conversions.
                </Typography>
              </CardContent>
            </Card>
          </Grid>
          
          <Grid size={{ xs: 12, sm: 6 }}>
            <Card sx={{ height: '100%', textAlign: 'center' }}>
              <CardContent>
                <RocketLaunch sx={{ fontSize: 40, color: 'primary.main', mb: 2 }} />
                <Typography variant="h6" gutterBottom>
                  A/B Testing
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  Test different offers and interventions with weighted variant selection and performance tracking.
                </Typography>
              </CardContent>
            </Card>
          </Grid>
          
          <Grid size={{ xs: 12, sm: 6 }}>
            <Card sx={{ height: '100%', textAlign: 'center' }}>
              <CardContent>
                <Analytics sx={{ fontSize: 40, color: 'primary.main', mb: 2 }} />
                <Typography variant="h6" gutterBottom>
                  Behavioral Analytics
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  Understand customer engagement patterns, scroll depth, and product affinities in real-time.
                </Typography>
              </CardContent>
            </Card>
          </Grid>
        </Grid>
      </Box>
    </MasterPanel>
  );
};

export default CustomersPage;