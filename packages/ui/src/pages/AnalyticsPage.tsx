// packages/ui/src/pages/AnalyticsPage.tsx
import React from 'react';
import { Box, Typography, Button, Card, CardContent, Grid, Paper, Alert } from '@mui/material';
import { Link as RouterLink } from 'react-router-dom';
import {
  Analytics,
  TrendingUp,
  Timeline,
  BarChart,
  LockOpen
} from '@mui/icons-material';
import MasterPanel from 'ui-component/MasterPanel/index.tsx';

/**
 * AnalyticsPage: Advanced Analytics Teaser - Shows the vision for multi-platform business intelligence
 * and guides users to connect platforms for unified analytics insights.
 */
const AnalyticsPage: React.FC = () => {
  return (
    <MasterPanel title="Advanced Analytics">
      <Box sx={{ p: 3, maxWidth: 1200, margin: '0 auto' }}>
        {/* Header Section */}
        <Box sx={{ textAlign: 'center', mb: 6 }}>
          <Analytics sx={{ fontSize: 64, color: 'primary.main', mb: 2 }} />
          <Typography variant="h3" component="h1" gutterBottom>
            Business Intelligence Platform
          </Typography>
          <Typography variant="h6" color="text.secondary" sx={{ mb: 4 }}>
            Turn data into actionable insights across your entire business
          </Typography>
          
          <Alert severity="info" sx={{ mb: 3, textAlign: 'left' }}>
            <strong>Coming Soon:</strong> We're building advanced analytics that connect data from all your platforms for unified business intelligence.
          </Alert>
        </Box>

        {/* Value Proposition Cards */}
        <Grid container spacing={4} sx={{ mb: 6 }}>
          <Grid >
            <Card sx={{ height: '100%', textAlign: 'center' }}>
              <CardContent>
                <Timeline sx={{ fontSize: 48, color: 'primary.main', mb: 2 }} />
                <Typography variant="h6" gutterBottom>
                  Multi-Platform Funnels
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  Track customer journeys from first touch to conversion across all your marketing channels and platforms.
                </Typography>
              </CardContent>
            </Card>
          </Grid>
          
          <Grid >
            <Card sx={{ height: '100%', textAlign: 'center' }}>
              <CardContent>
                <TrendingUp sx={{ fontSize: 48, color: 'primary.main', mb: 2 }} />
                <Typography variant="h6" gutterBottom>
                  Predictive Forecasting
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  AI-powered sales forecasting, inventory predictions, and customer behavior modeling.
                </Typography>
              </CardContent>
            </Card>
          </Grid>
          
          <Grid >
            <Card sx={{ height: '100%', textAlign: 'center' }}>
              <CardContent>
                <BarChart sx={{ fontSize: 48, color: 'primary.main', mb: 2 }} />
                <Typography variant="h6" gutterBottom>
                  Custom Dashboards
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  Build custom reports and dashboards tailored to your specific business metrics and KPIs.
                </Typography>
              </CardContent>
            </Card>
          </Grid>
        </Grid>

        {/* Current Capabilities vs Future State */}
        <Paper sx={{ p: 4, mb: 4, background: 'linear-gradient(135deg, #f5f7fa 0%, #c3cfe2 100%)' }}>
          <Typography variant="h5" gutterBottom sx={{ textAlign: 'center' }}>
            What You See Now vs. What's Coming
          </Typography>
          <Grid container spacing={3} sx={{ mt: 2 }}>
            <Grid >
              <Box sx={{ p: 2 }}>
                <Typography variant="h6" color="text.secondary" gutterBottom>
                  Current (Basic)
                </Typography>
                <ul style={{ color: 'text.secondary', paddingLeft: '20px' }}>
                  <li>Shopify order analytics</li>
                  <li>Basic revenue tracking</li>
                  <li>Product performance metrics</li>
                </ul>
              </Box>
            </Grid>
            <Grid >
              <Box sx={{ p: 2 }}>
                <Typography variant="h6" color="primary.main" gutterBottom>
                  Future (Intelligent)
                </Typography>
                <ul style={{ color: 'primary.main', paddingLeft: '20px' }}>
                  <li>Cross-platform attribution</li>
                  <li>Predictive analytics</li>
                  <li>Custom KPI dashboards</li>
                  <li>Automated insight generation</li>
                </ul>
              </Box>
            </Grid>
          </Grid>
        </Paper>

        {/* Call to Action */}
        <Box sx={{ textAlign: 'center', mt: 4 }}>
          <Typography variant="h6" gutterBottom>
            Ready to unlock advanced business intelligence?
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
            Connect your platforms to get started with unified analytics
          </Typography>
          <Button
            variant="contained"
            size="large"
            startIcon={<LockOpen />}
            component={RouterLink}
            to="/integrations"
            sx={{ mr: 2 }}
          >
            Connect Platforms
          </Button>
          <Button
            variant="outlined"
            size="large"
            component={RouterLink}
            to="/dashboard"
          >
            Back to Dashboard
          </Button>
        </Box>
      </Box>
    </MasterPanel>
  );
};

export default AnalyticsPage;