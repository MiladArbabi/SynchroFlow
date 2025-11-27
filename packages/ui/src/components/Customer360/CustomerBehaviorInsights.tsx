/* eslint-disable @typescript-eslint/no-unused-vars */
// packages/ui/src/components/Customer360/CustomerBehaviorInsights.tsx
import React from 'react';
import { Box, Typography, Paper, Chip, Grid, LinearProgress } from '@mui/material';
import { useNudgeEngine } from 'hooks/useNudgeEngine';

interface CustomerBehaviorInsightsProps {
  customerId: string;
}

export const CustomerBehaviorInsights: React.FC<CustomerBehaviorInsightsProps> = ({ customerId }) => {
  const { nudgePerformance, getConversionRate } = useNudgeEngine();

  // Calculate overall nudge performance for this customer
  const customerNudges = Object.entries(nudgePerformance).reduce((acc, [nudgeId, variants]) => {
    const totalImpressions = Object.values(variants).reduce((sum, v) => sum + v.impressions, 0);
    const totalConversions = Object.values(variants).reduce((sum, v) => sum + v.conversions, 0);
    const totalRevenue = Object.values(variants).reduce((sum, v) => sum + v.revenue, 0);
    
    if (totalImpressions > 0) {
      acc.push({
        nudgeId,
        impressions: totalImpressions,
        conversions: totalConversions,
        revenue: totalRevenue,
        conversionRate: totalConversions / totalImpressions
      });
    }
    return acc;
  }, [] as Array<{ nudgeId: string; impressions: number; conversions: number; revenue: number; conversionRate: number }>);

  return (
    <Paper sx={{ p: 2 }}>
      <Typography variant="h6" gutterBottom>
        Behavior & Conversion Insights
      </Typography>
      
      <Grid container spacing={2}>
        {/* Intent Level */}
        <Grid size={{ xs: 12, sm: 6 }}>
          <Box sx={{ mb: 2 }}>
            <Typography variant="body2" color="text.secondary" gutterBottom>
              Current Intent Level
            </Typography>
            <Chip 
              label="High Intent" 
              color="success" 
              variant="filled"
              size="small"
            />
          </Box>
        </Grid>

        {/* Engagement Score */}
        <Grid size={{ xs: 12, sm: 6 }}>
          <Box sx={{ mb: 2 }}>
            <Typography variant="body2" color="text.secondary" gutterBottom>
              Engagement Score
            </Typography>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <LinearProgress 
                variant="determinate" 
                value={75} 
                sx={{ flexGrow: 1, height: 8 }}
                color="success"
              />
              <Typography variant="body2" fontWeight="bold">
                75%
              </Typography>
            </Box>
          </Box>
        </Grid>

        {/* Nudge Performance Summary */}
        <Grid size={{ xs: 12 }}>
          <Typography variant="subtitle2" gutterBottom>
            Conversion Optimization
          </Typography>
          {customerNudges.length > 0 ? (
            customerNudges.map(nudge => (
              <Box key={nudge.nudgeId} sx={{ mb: 1, p: 1, bgcolor: 'background.default', borderRadius: 1 }}>
                <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <Typography variant="body2">
                    {nudge.nudgeId.replace(/-/g, ' ')}
                  </Typography>
                  <Chip 
                    label={`${(nudge.conversionRate * 100).toFixed(1)}%`} 
                    size="small"
                    color={nudge.conversionRate > 0.1 ? "success" : "default"}
                  />
                </Box>
                <Typography variant="caption" color="text.secondary">
                  {nudge.conversions} conversions / {nudge.impressions} impressions
                </Typography>
              </Box>
            ))
          ) : (
            <Typography variant="body2" color="text.secondary" sx={{ fontStyle: 'italic' }}>
              No nudge data available yet
            </Typography>
          )}
        </Grid>

        {/* Recent Activity */}
        <Grid size={{ xs: 12 }}>
          <Typography variant="subtitle2" gutterBottom>
            Recent Behavioral Signals
          </Typography>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
            <Chip label="Viewed product pages" variant="outlined" size="small" />
            <Chip label="High scroll depth" variant="outlined" size="small" color="success" />
            <Chip label="Multiple return visits" variant="outlined" size="small" />
          </Box>
        </Grid>
      </Grid>
    </Paper>
  );
};