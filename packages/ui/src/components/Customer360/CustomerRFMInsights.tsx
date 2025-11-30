import React from 'react';
import { Box, Typography, Paper, Chip, Grid, Alert, Stack } from '@mui/material';
import { Psychology, TrendingUp, Warning, Info } from '@mui/icons-material';
import { useRFMScoring } from 'hooks/useRFMScoring';
import type { CustomerApiResponse } from 'api-src/api/customers/customers.service';

interface CustomerRFMInsightsProps {
  customerData: CustomerApiResponse | null;
}

export const CustomerRFMInsights: React.FC<CustomerRFMInsightsProps> = ({ 
  customerData 
}) => {
  const { rfmScores, rfmSegment, insights, nudgeRecommendations } = useRFMScoring(customerData);

  const getSegmentColor = (segment: string) => {
    switch (segment) {
      case 'Champion': return 'success';
      case 'Loyal': return 'primary';
      case 'New': return 'info';
      case 'Potential': return 'secondary';
      case 'At Risk': return 'warning';
      case 'Cannot Lose': return 'error';
      default: return 'default';
    }
  };

  const getScoreColor = (score: number) => {
    if (score >= 4) return 'success';
    if (score >= 3) return 'primary';
    if (score >= 2) return 'warning';
    return 'error';
  };

  return (
    <Paper sx={{ p: 2, height: '100%' }}>
      <Box sx={{ display: 'flex', alignItems: 'center', mb: 2 }}>
        <Psychology sx={{ mr: 1, color: 'primary.main' }} />
        <Typography variant="h6">RFM Customer Segmentation</Typography>
      </Box>

      {/* RFM Scores */}
      <Grid container spacing={2} sx={{ mb: 3 }}>
        <Grid size={{ xs: 12, sm: 3 }}>
          <Box sx={{ textAlign: 'center', p: 1 }}>
            <Typography variant="subtitle2" color="text.secondary">
              Recency
            </Typography>
            <Chip 
              label={rfmScores.recency} 
              color={getScoreColor(rfmScores.recency)}
              variant="filled"
              size="small"
            />
            <Typography variant="caption" display="block" sx={{ mt: 0.5 }}>
              {rfmScores.recency >= 4 ? 'Recent' : rfmScores.recency >= 2 ? 'Moderate' : 'Dormant'}
            </Typography>
          </Box>
        </Grid>
        
        <Grid size={{ xs: 12, sm: 3 }}>
          <Box sx={{ textAlign: 'center', p: 1 }}>
            <Typography variant="subtitle2" color="text.secondary">
              Frequency
            </Typography>
            <Chip 
              label={rfmScores.frequency} 
              color={getScoreColor(rfmScores.frequency)}
              variant="filled"
              size="small"
            />
            <Typography variant="caption" display="block" sx={{ mt: 0.5 }}>
              {rfmScores.frequency >= 4 ? 'Frequent' : rfmScores.frequency >= 2 ? 'Occasional' : 'Rare'}
            </Typography>
          </Box>
        </Grid>
        
        <Grid size={{ xs: 12, sm: 3 }}>
          <Box sx={{ textAlign: 'center', p: 1 }}>
            <Typography variant="subtitle2" color="text.secondary">
              Monetary
            </Typography>
            <Chip 
              label={rfmScores.monetary} 
              color={getScoreColor(rfmScores.monetary)}
              variant="filled"
              size="small"
            />
            <Typography variant="caption" display="block" sx={{ mt: 0.5 }}>
              {rfmScores.monetary >= 4 ? 'High Value' : rfmScores.monetary >= 2 ? 'Medium' : 'Low'}
            </Typography>
          </Box>
        </Grid>

        <Grid size={{ xs: 12, sm: 3 }}>
          <Box sx={{ textAlign: 'center', p: 1 }}>
            <Typography variant="subtitle2" color="text.secondary">
              Segment
            </Typography>
            <Chip 
              label={rfmSegment} 
              color={getSegmentColor(rfmSegment)}
              variant="filled"
              size="small"
            />
            <Typography variant="caption" display="block" sx={{ mt: 0.5 }}>
              Composite: {rfmScores.composite}/5
            </Typography>
          </Box>
        </Grid>
      </Grid>

      {/* Insights */}
      {insights.length > 0 && (
        <Box sx={{ mb: 3 }}>
          <Typography variant="subtitle2" gutterBottom>
            Behavioral Insights
          </Typography>
          <Stack spacing={1}>
            {insights.map((insight, index) => (
              <Alert 
                key={index}
                severity={insight.type}
                icon={
                  insight.type === 'success' ? <TrendingUp /> :
                  insight.type === 'warning' ? <Warning /> :
                  <Info />
                }
                sx={{ fontSize: '0.875rem' }}
              >
                {insight.message}
              </Alert>
            ))}
          </Stack>
        </Box>
      )}

      {/* Nudge Recommendations */}
      {nudgeRecommendations.length > 0 && (
        <Box>
          <Typography variant="subtitle2" gutterBottom>
            Specter Nudge Recommendations
          </Typography>
          <Stack spacing={1}>
            {nudgeRecommendations.map((recommendation, index) => (
              <Paper 
                key={index}
                variant="outlined" 
                sx={{ 
                  p: 1.5, 
                  borderLeft: 4, 
                  borderLeftColor: 
                    recommendation.type === 'discount' ? 'success.main' :
                    recommendation.type === 'upsell' ? 'primary.main' :
                    recommendation.type === 'cross_sell' ? 'secondary.main' :
                    recommendation.type === 'loyalty' ? 'info.main' : 'warning.main'
                }}
              >
                <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                  <Box>
                    <Typography variant="body2" fontWeight="medium">
                      {recommendation.message}
                    </Typography>
                    <Typography variant="caption" color="text.secondary">
                      {recommendation.type.replace('_', ' ').toUpperCase()} • {recommendation.segment} Segment
                    </Typography>
                  </Box>
                  <Chip 
                    label={`${Math.round(recommendation.confidence * 100)}%`}
                    size="small"
                    color={recommendation.confidence >= 0.8 ? 'success' : 'primary'}
                    variant="outlined"
                  />
                </Box>
              </Paper>
            ))}
          </Stack>
        </Box>
      )}
    </Paper>
  );
};