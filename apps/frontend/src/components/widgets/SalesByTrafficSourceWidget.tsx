// apps/frontend/src/components/widgets/SalesByTrafficSourceWidget.tsx
import React from 'react';
import {
  Box,
  Typography,
  Skeleton,
  List,
  ListItem,
  ListItemText,
  ListItemIcon,
  Tooltip,
  Chip,
  Stack
} from '@mui/material';
import { EnhancedWidgetShellProps, WidgetContentProps } from './types';
import { useQuery } from '@tanstack/react-query';
import axios from 'axios';
import { useAuth } from 'contexts/AuthContext';
import { Globe, TrendingUp, TrendingDown, Minus } from 'lucide-react';
import { CoachTrigger } from 'components/triggers/CoachTrigger';
import { FeedbackHandler } from 'components/triggers/types';

// 1. Define the API response shape (from getSalesByTrafficSource)
interface TrafficSourceItem {
  source: string;
  totalRevenue: number;
  orderCount: number;
  conversionRate?: number;
  averageOrderValue?: number;
  previousPeriodRevenue?: number;
}

interface TrafficSourceInsight {
   question: string;
   causation: string;
   actionPlan: string;
   severity: 'critical' | 'warning' | 'positive' | 'neutral' | 'info';
   topPerformer?: TrafficSourceItem;
   underperformer?: TrafficSourceItem;
   opportunity?: TrafficSourceItem;
 }

 interface SalesByTrafficSourceWidgetProps extends Omit<EnhancedWidgetShellProps, 'children'> {
  insightId?: string;
  onFeedback?: FeedbackHandler;
}

// Helper to format currency
const formatCurrency = (value: number) =>
  new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(value);

  // Helper to format percentage
 const formatPercent = (value: number) =>
   new Intl.NumberFormat('en-US', {
     style: 'percent',
     minimumFractionDigits: 1,
     maximumFractionDigits: 1,
   }).format(value);

 // Performance analysis function
 const analyzeTrafficSourcePerformance = (items: TrafficSourceItem[]): TrafficSourceInsight => {
   if (items.length === 0) {
     return {
       question: "Why am I not getting sales from any traffic sources?",
       causation: "No traffic source data indicates potential issues with tracking, marketing campaigns, or website conversion. Check your analytics setup and marketing channel performance.",
       actionPlan: "Set up proper tracking for all marketing channels, review campaign performance, and optimize your conversion funnel.",
       severity: 'critical'
     };
   }

   // Sort by revenue to find top performers and underperformers
   const sortedByRevenue = [...items].sort((a, b) => b.totalRevenue - a.totalRevenue);
   const topPerformer = sortedByRevenue[0];
   const underperformer = sortedByRevenue[sortedByRevenue.length - 1];
   
   // Find opportunity (high AOV but low traffic)
   const opportunity = items.find(item => 
     item.averageOrderValue && item.averageOrderValue > 150 && item.orderCount < 15
   );

   const totalRevenue = items.reduce((sum, item) => sum + item.totalRevenue, 0);
   const topPerformerShare = (topPerformer.totalRevenue / totalRevenue) * 100;

   if (topPerformerShare > 80) {
     return {
       question: "Are you over-reliant on one traffic source?",
       causation: `${topPerformer.source} accounts for ${formatPercent(topPerformerShare/100)} of your total revenue. This creates significant risk if this channel underperforms or costs increase.`,
       actionPlan: `Diversify your marketing mix by testing new channels. Allocate 10-15% of your budget to test ${underperformer.source} optimization or new channels like email marketing or Pinterest.`,
       severity: 'warning',
       topPerformer,
       underperformer
     };
   }

   if (opportunity) {
     return {
       question: "Which high-value traffic source is being underutilized?",
       causation: `${opportunity.source} has a high average order value of ${formatCurrency(opportunity.averageOrderValue!)} but only ${opportunity.orderCount} orders. This indicates untapped potential for growth.`,
       actionPlan: `Increase budget allocation to ${opportunity.source} by 25% and create targeted campaigns to drive more traffic from this high-value channel.`,
       severity: 'positive',
       opportunity
     };
   }

   if (underperformer.totalRevenue < totalRevenue * 0.05 && items.length > 2) {
     return {
       question: "Which traffic source should you reallocate budget from?",
       causation: `${underperformer.source} is generating only ${formatCurrency(underperformer.totalRevenue)} (${formatPercent(underperformer.totalRevenue/totalRevenue)}) while ${topPerformer.source} is performing well with ${formatCurrency(topPerformer.totalRevenue)}.`,
       actionPlan: `Reduce spending on ${underperformer.source} and reallocate 50% of that budget to ${topPerformer.source} or testing new channels with similar audience characteristics.`,
       severity: 'warning',
       topPerformer,
       underperformer
     };
   }

   return {
     question: "How can you optimize your marketing ROI?",
     causation: `Your traffic sources are relatively balanced. ${topPerformer.source} leads with ${formatCurrency(topPerformer.totalRevenue)}. Focus on improving conversion rates and average order value across all channels.`,
     actionPlan: "Implement A/B testing on landing pages, create channel-specific promotions, and analyze customer journey data to identify drop-off points.",
     severity: 'info',
     topPerformer
   };
 };

 // Get performance trend indicator
 const getPerformanceIndicator = (item: TrafficSourceItem, insight: TrafficSourceInsight) => {
   if (item.source === insight.topPerformer?.source) {
     return <TrendingUp size={16} color="#4caf50" />;
   }
   if (item.source === insight.underperformer?.source) {
     return <TrendingDown size={16} color="#f44336" />;
   }
   if (item.source === insight.opportunity?.source) {
     return <TrendingUp size={16} color="#ff9800" />;
   }
   return <Minus size={16} color="#9e9e9e" />;
 };

// 2. Create the internal Presentational Component
const TrafficSourceContent: React.FC<
  WidgetContentProps & { 
    items: TrafficSourceItem[];
    insight: TrafficSourceInsight; 
  }
> = (props) => {
  const { isLoading, isEmpty, error, items, insight } = props;

  if (isLoading) {
    return (
      <Box data-testid="loading-skeleton" sx={{ p: 2 }}>
        <Skeleton variant="rectangular" height={150} />
      </Box>
    );
  }

  if (error) {
    return (
      <Box sx={{ textAlign: 'center', py: 3 }}>
        <Typography variant="body2" color="error">
          Error loading traffic source data
        </Typography>
      </Box>
    );
  }

  if (isEmpty) {
    return (
      <Box sx={{ textAlign: 'center', py: 3 }}>
        <Typography variant="body2" color="text.secondary">
          No traffic source data available
        </Typography>
      </Box>
    );
  }

  return (
    <Box>
      {/* Performance Summary */}
      <Stack direction="row" spacing={1} sx={{ mb: 2, flexWrap: 'wrap' }}>
        <Chip 
          label={`Top: ${insight.topPerformer?.source}`}
          size="small"
          color="success"
          variant="outlined"
        />
        {insight.underperformer && (
          <Chip 
            label={`Review: ${insight.underperformer.source}`}
            size="small"
            color="warning"
            variant="outlined"
          />
        )}
        {insight.opportunity && (
          <Chip 
            label={`Opportunity: ${insight.opportunity.source}`}
            size="small"
            color="info"
            variant="outlined"
          />
        )}
      </Stack>

      <List dense>
        {items.map((item) => (
          <ListItem
            key={item.source}
            secondaryAction={
              <Box sx={{ textAlign: 'right' }}>
                <Typography variant="body2" fontWeight="bold">
                  {formatCurrency(item.totalRevenue)}
                </Typography>
                {item.conversionRate && (
                  <Typography variant="caption" color="text.secondary">
                    {formatPercent(item.conversionRate)} CR
                  </Typography>
                )}
              </Box>
            }
          >
           <ListItemIcon sx={{ minWidth: '32px' }}>
             {getPerformanceIndicator(item, insight)}
           </ListItemIcon>
            <ListItemIcon sx={{ minWidth: '40px' }}>
              <Globe size={20} />
            </ListItemIcon>
            <ListItemText
              primary={
                <Tooltip title={item.source} arrow>
                  <Typography variant="body2" noWrap maxWidth="120px">
                    {item.source}
                  </Typography>
                </Tooltip>
              }
              secondary={`${item.orderCount} orders${item.averageOrderValue 
                ? ` • ${formatCurrency(item.averageOrderValue)} AOV` : ''}`}
            />
          </ListItem>
        ))}
      </List>
    </Box>
  );
};

// 3. Create the "Smart" Container Component with CoachTrigger
export const SalesByTrafficSourceWidget: React.FC<SalesByTrafficSourceWidgetProps> 
= (props) => {
  const { accessToken } = useAuth();
  const { insightId, onFeedback, ...shellProps } = props;

  const { data, isLoading, error } = useQuery<TrafficSourceItem[]>({
    queryKey: ['dashboardTrafficSource'],
    queryFn: async () => {
      const { data } = await axios.get(
        '/api/v1/dashboard/sales-by-traffic-source',
        {
          headers: {
            Authorization: `Bearer ${accessToken}`,
          },
        }
      );
      return data;
    },
    enabled: !!accessToken, // Only run when the user is logged in
  });

  const items = data || [];
  const isEmpty = !isLoading && items.length === 0;

  const insight = analyzeTrafficSourcePerformance(items);

  // Get CoachTrigger props based on insight severity
  const getCoachTriggerConfig = () => {
    switch (insight.severity) {
      case 'critical':
        return {
          title: "🚨 Marketing Channel Alert",
          tactic: "Traffic Source Diagnosis",
          successMetrics: ["Revenue Diversity", "Channel ROI", "Conversion Rate"],
          estimatedImpact: "+25% Marketing Efficiency",
          feedbackEnabled: true
        };
      case 'warning':
        return {
          title: "⚠️ Budget Optimization Needed", 
          tactic: "Channel Performance Analysis",
          successMetrics: ["ROI", "Cost per Acquisition", "Revenue Growth"],
          estimatedImpact: "+15% Marketing ROI",
          feedbackEnabled: true
        };
      case 'positive':
        return {
          title: "💡 Growth Opportunity Identified",
          tactic: "High-Value Channel Expansion", 
          successMetrics: ["AOV", "Revenue", "Customer Quality"],
          estimatedImpact: "+20% Revenue from Channel",
          feedbackEnabled: true
        };
      default:
        return {
          title: "📊 Marketing Mix Analysis",
          tactic: "Performance Optimization",
          successMetrics: ["Conversion Rate", "AOV", "Channel Balance"],
          estimatedImpact: "+10% Overall Marketing Performance",
          feedbackEnabled: true
        };
    }
  };

  const coachConfig = getCoachTriggerConfig();

  // Render without CoachTrigger for backward compatibility
  if (!insightId) {
    return (
      <TrafficSourceContent
        {...shellProps}
        items={items}
        isLoading={isLoading}
        isEmpty={isEmpty}
        error={error?.message}
        insight={insight}
      />
    );
  }

  return (
    <CoachTrigger
      insightId={insightId}
      tactic={coachConfig.tactic}
      successMetrics={coachConfig.successMetrics}
      estimatedImpact={coachConfig.estimatedImpact}
      onFeedback={onFeedback}
      feedbackEnabled={coachConfig.feedbackEnabled}
      title={coachConfig.title}
    >
    <TrafficSourceContent
        {...shellProps}
        items={items}
        isLoading={isLoading}
        isEmpty={isEmpty}
        error={error?.message}
        insight={insight}
      />
    </CoachTrigger>
  );
};