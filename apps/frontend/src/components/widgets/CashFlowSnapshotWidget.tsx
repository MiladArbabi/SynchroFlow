// apps/frontend/src/components/widgets/CashFlowSnapshotWidget.tsx
import React from 'react';
import { Box, Typography, Grid, Chip, Skeleton } from '@mui/material';
import { EnhancedWidgetShellProps, WidgetContentProps } from './types';
import TrendingUpIcon from '@mui/icons-material/TrendingUp';
import TrendingDownIcon from '@mui/icons-material/TrendingDown';
import AccountBalanceWalletIcon from '@mui/icons-material/AccountBalanceWallet';
import { useQuery } from '@tanstack/react-query';
import axios from 'axios';
import { useAuth } from 'contexts/AuthContext'; // Import useAuth to get the token
import { CoachTrigger } from 'components/triggers/CoachTrigger';
import { FeedbackHandler } from 'components/triggers/types';

// 1. Define the API response shape (based on our dashboard.controller.ts scan)
interface PulseData {
  totalRevenue: number;
  orderCount: number;
  unfulfilledCount: number;
}

// 4 C's Analysis for Cash Flow Widget
 const getCashFlowInsight = (currentValue: number, previousValue?: number) => {
   if (currentValue < 0) {
     return {
       question: "Why is my cash flow negative?",
       causation: "Negative cash flow indicates expenses exceed revenue. This could be due to high inventory costs, slow sales, or unexpected expenses.",
       actionPlan: "Review recent expenses, optimize inventory levels, and consider short-term financing options.",
       severity: 'critical' as const
     };
   }
   
   if (previousValue && currentValue < previousValue * 0.8) {
     return {
       question: "Why has cash flow decreased significantly?",
       causation: `Cash flow dropped ${((previousValue - currentValue) / previousValue * 100).toFixed(1)}% from previous period. Check for seasonal trends, customer payment delays, or increased operational costs.`,
       actionPlan: "Analyze customer payment terms, review operational expenses, and create cash flow projections.",
       severity: 'warning' as const
     };
   }
   
   if (previousValue && currentValue > previousValue * 1.2) {
     return {
       question: "What's driving the cash flow improvement?",
       causation: `Cash flow increased ${((currentValue - previousValue) / previousValue * 100).toFixed(1)}% from previous period. This could be due to successful marketing campaigns, improved collections, or cost reductions.`,
       actionPlan: "Identify the key drivers and replicate successful strategies across the business.",
       severity: 'positive' as const
     };
   }
   
   return {
     question: "How can I optimize cash flow further?",
     causation: "Cash flow is stable. Consider opportunities for improvement through better inventory management, payment term optimization, or revenue diversification.",
     actionPlan: "Review cash conversion cycle and explore working capital optimization strategies.",
     severity: 'neutral' as const
   };
 };

// 2. Create the internal Presentational Component
// This is the logic copied directly from mock-widgets.tsx
const CashFlowWidgetContent: React.FC<WidgetContentProps> = (props) => {
  const { currentValue, previousValue, format, isLoading, isEmpty, error } = props;

  const formatValue = (value: number, formatType: string) => {
    switch (formatType) {
      case 'currency':
        return new Intl.NumberFormat('en-US', {
          style: 'currency',
          currency: 'USD',
          minimumFractionDigits: 0,
        }).format(value);
      case 'percentage':
        return `${value}%`;
      case 'number':
        return value.toLocaleString();
      default:
        return value.toString();
    }
  };

  const calculateTrend = () => {
    if (!previousValue || previousValue === 0) return null;
    return ((currentValue - previousValue) / Math.abs(previousValue)) * 100;
  };

  const trend = calculateTrend();
  const isPositive = trend !== null && trend >= 0;

  if (isLoading) {
    return (
      <Box data-testid="loading-skeleton">
        <Skeleton variant="rectangular" height={80} />
      </Box>
    );
  }

  if (error) {
    return (
      <Box sx={{ textAlign: 'center', py: 3 }}>
        <Typography variant="body2" color="error">
          Error loading cash flow data
        </Typography>
      </Box>
    );
  }

  if (isEmpty) {
    return (
      <Box sx={{ textAlign: 'center', py: 3 }}>
        <Typography variant="body2" color="text.secondary">
          No cash flow data available
        </Typography>
      </Box>
    );
  }

  return (
    <Box sx={{ p: 2 }}>
      <Grid container spacing={2} alignItems="center">
        <Grid>
          <AccountBalanceWalletIcon
            sx={{
              fontSize: 40,
              color: currentValue >= 0 ? 'success.main' : 'error.main',
            }}
          />
        </Grid>
        <Grid >
          <Typography variant="h4" component="div" sx={{ fontWeight: 'bold' }}>
            {formatValue(currentValue, format)}
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Today's Revenue
          </Typography>
        </Grid>
        {trend !== null && (
          <Grid >
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              {isPositive ? (
                <TrendingUpIcon sx={{ color: 'success.main' }} />
              ) : (
                <TrendingDownIcon sx={{ color: 'error.main' }} />
              )}
              <Chip
                label={`${isPositive ? '+' : ''}${trend.toFixed(1)}%`}
                size="small"
                color={isPositive ? 'success' : 'error'}
                variant="outlined"
              />
            </Box>
          </Grid>
        )}
        {currentValue < 0 && (
          <Grid >
            <Chip
              label="Critical: Negative Cash Flow"
              color="error"
              size="small"
              sx={{ mt: 1 }}
            />
          </Grid>
        )}
      </Grid>
    </Box>
  );
};

interface CashFlowWidgetProps extends Omit<EnhancedWidgetShellProps, 'children' | 'currentValue' | 'format' | 'isLoading' | 'isEmpty'> {
   insightId: string;
   onFeedback?: FeedbackHandler;
};

// 3. Create the "Smart" Container Component
// This fetches data and passes it to the presentational component
export const CashFlowSnapshotWidget: React.FC<CashFlowWidgetProps> = (props) => {
  const { accessToken } = useAuth();
  const { insightId, onFeedback, ...shellProps } = props;

  const { data, isLoading, error } = useQuery<PulseData>({
    queryKey: ['dashboardPulse'],
    queryFn: async () => {
      const { data } = await axios.get('/api/v1/dashboard/pulse', {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      });
      return data;
    },
    enabled: !!accessToken, // Only run when the user is logged in
  });

  const isEmpty = !isLoading && (!data || data.totalRevenue === 0);
  const currentValue = data?.totalRevenue || 0;
  const insight = getCashFlowInsight(currentValue);
  const previousValue = 0; // TODO: Get from API when available

  const getRevenueBand = (dailyRevenue: number): '100k' | '1M' | '5M' | '10M' | '50M+' => {
   const annualProjection = dailyRevenue * 365;
   if (annualProjection < 100000) return '100k';
   if (annualProjection < 1000000) return '1M';
   if (annualProjection < 5000000) return '5M';
   if (annualProjection < 10000000) return '10M';
   return '50M+';
 };

 // Render without CoachTrigger for backward compatibility in tests
 if (!insightId) {
   return (
    <Box data-testid="widget-shell-cash-flow">
     <CashFlowWidgetContent
       {...shellProps}
       currentValue={currentValue}
       previousValue={previousValue}
       format="currency"
       isLoading={isLoading}
       isEmpty={isEmpty}
       error={error?.message}
     />
    </Box>
   );
 }

  return (
    <Box data-testid="widget-shell-cash-flow">
      <CoachTrigger
      insightId={insightId}
      tactic="Cash Flow Optimization"
      successMetrics={["Cash Flow", "Working Capital"]}
      estimatedImpact="$5,000-$15,000 monthly improvement"
      onFeedback={onFeedback}
      feedbackEnabled={true}
    >
      <CashFlowWidgetContent
        {...shellProps}
        currentValue={currentValue}
        previousValue={previousValue}
        format="currency"
        isLoading={isLoading}
        isEmpty={isEmpty}
        error={error?.message}
        // Enhanced with 4 C's context
        businessContext={{
          stage: currentValue < 0 ? 'survival' : 'growth',
          burningPriority: 'cash-flow',
          revenueBand: getRevenueBand(currentValue),
        }}
        intelligenceLevel="L3"
        insightText={insight.causation}
        insightSeverity={insight.severity}
        primaryAction={{
          label: "View Cash Flow Plan",
          onClick: () => console.log("Navigate to cash flow optimization"),
          variant: 'primary' as const,
          workflowType: 'cash-optimization',
          expectedImpact: 'high',
          timeToComplete: 'minutes'
        }}
      />
      </CoachTrigger>
    </Box>  
  );
};