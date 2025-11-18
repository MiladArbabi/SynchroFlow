/* eslint-disable @typescript-eslint/no-unused-vars */
// packages/ui/src/components/widgets/OrderMetricsWidget.tsx
import React from 'react';
import { Box, Typography, Grid, Skeleton } from '@mui/material';
import { EnhancedWidgetShellProps, WidgetContentProps } from './types';
import { useQuery } from '@tanstack/react-query';
import axios from 'axios';
import { useAuth } from 'contexts/AuthContext';
import { CoachTrigger } from '../triggers/CoachTrigger';
import { FeedbackHandler } from '../triggers/types';

// 1. Define the API response shape (from getPulse)
interface PulseData {
  totalRevenue: number;
  orderCount: number;
  unfulfilledCount: number;
}

const getOrderMetricsInsight = (totalOrders: number, averageOrder: number, previousAvgOrder?: number) => {
   if (totalOrders === 0) {
     return {
       question: "Why am I not getting any orders?",
       causation: "Zero orders indicate potential issues with marketing, website traffic, or conversion funnel. Check your traffic sources and website performance.",
       actionPlan: "Review marketing campaigns, optimize website conversion rates, and consider running promotions.",
       severity: 'critical' as const
     };
   }
   
   if (averageOrder < 50) {
     return {
       question: "Why is my average order value low?",
       causation: `Low AOV (${averageOrder.toFixed(2)}) suggests customers aren't buying enough per transaction. This could be due to product pricing, lack of upselling, or limited product selection.`,
       actionPlan: "Implement upselling strategies, bundle products, and review pricing strategy.",
       severity: 'warning' as const
     };
   }
   
   if (averageOrder > 200) {
     return {
       question: "What's driving high order values?",
       causation: `High AOV (${averageOrder.toFixed(2)}) indicates successful upselling, premium pricing, or high-value customer segments. Analyze which products or strategies are working.`,
       actionPlan: "Double down on successful strategies and identify opportunities to increase order frequency.",
       severity: 'positive' as const
     };
   }
   
   return {
     question: "How can I increase order volume and value?",
     causation: "Order metrics are stable. Focus on increasing both order frequency and average order value through customer retention and upselling.",
     actionPlan: "Implement loyalty programs, email marketing, and cross-selling strategies.",
     severity: 'neutral' as const
   };
 };

// 2. Create the internal Presentational Component
// This is the logic copied directly from mock-widgets.tsx
const OrderMetricsContent: React.FC<
  WidgetContentProps & { totalOrders: number; averageOrder: number }
> = (props) => {
  const { isLoading, isEmpty, error, totalOrders, averageOrder } = props;

  if (isLoading) {
    return (
      <Box data-testid="loading-skeleton">
        <Skeleton variant="rectangular" height={100} />
      </Box>
    );
  }

  if (error) {
    return (
      <Box sx={{ textAlign: 'center', py: 3 }}>
        <Typography variant="body2" color="error">
          Error loading order data
        </Typography>
      </Box>
    );
  }

  if (isEmpty) {
    return (
      <Box sx={{ textAlign: 'center', py: 3 }}>
        <Typography variant="body2" color="text.secondary">
          No order data available
        </Typography>
      </Box>
    );
  }

  // Helper to format currency
  const formatCurrency = (value: number) =>
    new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(value);

  return (
    <Box sx={{ p: 2 }}>
      <Grid container spacing={3} justifyContent="space-around">
        <Grid >
          <Box sx={{ textAlign: 'center' }}>
            <Typography variant="h5" fontWeight="bold">
              {totalOrders}
            </Typography>
            <Typography variant="caption" color="text.secondary">
              Total Orders
            </Typography>
          </Box>
        </Grid>
        <Grid >
          <Box sx={{ textAlign: 'center' }}>
            <Typography variant="h5" fontWeight="bold">
              {formatCurrency(averageOrder)}
            </Typography>
            <Typography variant="caption" color="text.secondary">
              Avg. Order
            </Typography>
          </Box>
        </Grid>
        {/* We are intentionally leaving out 'Conversion' as our API doesn't supply it yet */}
      </Grid>
    </Box>
  );
};

interface OrderMetricsWidgetProps extends Omit<EnhancedWidgetShellProps, 'children'> {
   insightId?: string;
   onFeedback?: FeedbackHandler;
 }

// 3. Create the "Smart" Container Component
export const OrderMetricsWidget: React.FC<OrderMetricsWidgetProps> = (props) => {
  const { accessToken } = useAuth();
  const { insightId, onFeedback, ...shellProps } = props;

  const { data, isLoading, error } = useQuery<PulseData>({
    queryKey: ['dashboardPulse'], // We reuse the same query as CashFlow
    queryFn: async () => {
      const { data } = await axios.get('/api/v1/dashboard/pulse', {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      });
      return data;
    },
    enabled: !!accessToken,
  });

  // Calculate metrics
  const totalOrders = data?.orderCount || 0;
  const totalRevenue = data?.totalRevenue || 0;
  // Calculate AOV, protecting against division by zero
  const averageOrder =
    totalOrders > 0 ? totalRevenue / totalOrders : 0;

  const isEmpty = !isLoading && totalOrders === 0;

  const insight = getOrderMetricsInsight(totalOrders, averageOrder);
 
 // Calculate appropriate revenue band
 const getRevenueBand = (dailyRevenue: number): '100k' | '1M' | '5M' | '10M' | '50M+' => {
   const annualProjection = dailyRevenue * 365;
   if (annualProjection < 100000) return '100k';
   if (annualProjection < 1000000) return '1M';
   if (annualProjection < 5000000) return '5M';
   if (annualProjection < 10000000) return '10M';
   return '50M+';
 };

 // Render without CoachTrigger for backward compatibility
 if (!insightId) {
   return (
     <OrderMetricsContent
       {...shellProps}
       totalOrders={totalOrders}
       averageOrder={averageOrder}
       isLoading={isLoading}
       isEmpty={isEmpty}
       error={error?.message}
     />
   );
 }

  return (
    <CoachTrigger
     insightId={insightId}
     tactic="Order Optimization"
     successMetrics={["Order Volume", "Average Order Value"]}
     estimatedImpact="+15-30% revenue growth"
     onFeedback={onFeedback}
     feedbackEnabled={true}
   >
    <OrderMetricsContent
      {...shellProps}
      totalOrders={totalOrders}
      averageOrder={averageOrder}
      isLoading={isLoading}
      isEmpty={isEmpty}
      error={error?.message}
      // Enhanced with 4 C's context
       businessContext={{
         stage: totalOrders === 0 ? 'survival' : averageOrder > 100 ? 'growth' : 'architect',
         burningPriority: 'acquisition',
         revenueBand: getRevenueBand(totalRevenue),
         timeContext: 'daily'
       }}
       intelligenceLevel="L3"
       insightText={insight.causation}
       insightSeverity={insight.severity}
       primaryAction={{
         label: "Optimize Orders",
         onClick: () => console.log("Navigate to order optimization"),
         variant: 'primary' as const,
         workflowType: 'customer-retention',
         expectedImpact: 'medium',
         timeToComplete: 'hours'
       }}
    />
    </CoachTrigger>
  );
};