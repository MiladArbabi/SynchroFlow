// apps/frontend/src/pages/FinancesPage.tsx
import React from 'react';
import { Box, Typography, Button, Card, CardContent, Grid, Paper, Alert } from '@mui/material';
import { Link as RouterLink } from 'react-router-dom';
import {
  AccountBalance,
  ShowChart,
  Receipt,
  Savings,
  LockOpen
} from '@mui/icons-material';
import MasterPanel from 'ui-component/MasterPanel/index.tsx';

/**
 * FinancesPage: Financial Intelligence Teaser - Shows the vision for true profitability tracking
 * and guides users to connect financial platforms for complete financial visibility.
 */
const FinancesPage: React.FC = () => {
  return (
    <MasterPanel title="Financial Intelligence">
      <Box sx={{ p: 3, maxWidth: 1200, margin: '0 auto' }}>
        {/* Header Section */}
        <Box sx={{ textAlign: 'center', mb: 6 }}>
          <AccountBalance sx={{ fontSize: 64, color: 'primary.main', mb: 2 }} />
          <Typography variant="h3" component="h1" gutterBottom>
            True Profitability Tracking
          </Typography>
          <Typography variant="h6" color="text.secondary" sx={{ mb: 4 }}>
            See beyond revenue to actual profit with complete cost visibility
          </Typography>
          
          <Alert severity="info" sx={{ mb: 3, textAlign: 'left' }}>
            <strong>Coming Soon:</strong> We're building financial intelligence that connects your accounting, payment processing, and operational data for true profitability insights.
          </Alert>
        </Box>

        {/* Value Proposition Cards */}
        <Grid container spacing={4} sx={{ mb: 6 }}>
          <Grid >
            <Card sx={{ height: '100%', textAlign: 'center' }}>
              <CardContent>
                <Receipt sx={{ fontSize: 48, color: 'primary.main', mb: 2 }} />
                <Typography variant="h6" gutterBottom>
                  True Cost Accounting
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  Track COGS, shipping costs, payment fees, and overhead to calculate actual product margins.
                </Typography>
              </CardContent>
            </Card>
          </Grid>
          
          <Grid >
            <Card sx={{ height: '100%', textAlign: 'center' }}>
              <CardContent>
                <ShowChart sx={{ fontSize: 48, color: 'primary.main', mb: 2 }} />
                <Typography variant="h6" gutterBottom>
                  Cash Flow Forecasting
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  Predict future cash flow with AI-powered forecasting based on orders, expenses, and payment terms.
                </Typography>
              </CardContent>
            </Card>
          </Grid>
          
          <Grid >
            <Card sx={{ height: '100%', textAlign: 'center' }}>
              <CardContent>
                <Savings sx={{ fontSize: 48, color: 'primary.main', mb: 2 }} />
                <Typography variant="h6" gutterBottom>
                  Financial Health Scoring
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  Get real-time financial health scores and alerts for cash traps, margin compression, and burn rate.
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
                  <li>Shopify revenue tracking</li>
                  <li>Basic order values</li>
                  <li>Estimated metrics only</li>
                </ul>
              </Box>
            </Grid>
            <Grid >
              <Box sx={{ p: 2 }}>
                <Typography variant="h6" color="primary.main" gutterBottom>
                  Future (Intelligent)
                </Typography>
                <ul style={{ color: 'primary.main', paddingLeft: '20px' }}>
                  <li>True profit margins</li>
                  <li>Cash flow predictions</li>
                  <li>Overhead allocation</li>
                  <li>Financial health monitoring</li>
                </ul>
              </Box>
            </Grid>
          </Grid>
        </Paper>

        {/* Call to Action */}
        <Box sx={{ textAlign: 'center', mt: 4 }}>
          <Typography variant="h6" gutterBottom>
            Ready to see your true profitability?
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
            Connect your financial platforms to unlock complete financial intelligence
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

export default FinancesPage;