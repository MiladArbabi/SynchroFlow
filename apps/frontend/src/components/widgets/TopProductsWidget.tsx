/* eslint-disable @typescript-eslint/no-unused-vars */
// apps/frontend/src/components/widgets/TopProductsWidget.tsx
import React from 'react';
import {
  Box,
  Typography,
  Skeleton,
  List,
  ListItem,
  ListItemText,
  ListItemIcon,
  Chip,
} from '@mui/material';
import { EnhancedWidgetShellProps, WidgetContentProps } from './types';
import { EnhancedWidgetShell } from './EnhancedWidgetShell';
import { useQuery } from '@tanstack/react-query';
import axios from 'axios';
import { useAuth } from 'contexts/AuthContext';
import { Trophy } from 'lucide-react';
import { CoachTrigger } from '../triggers/CoachTrigger';
import { FeedbackHandler } from '../triggers/types';

// 1. Define the API response shape (from getTopProducts)
interface TopProductItem {
  id: string;
  title: string;
  totalSold: number;
}

// 4 C's Analysis for Top Products Widget
 const getTopProductsInsight = (items: TopProductItem[], previousItems?: TopProductItem[]) => {
   if (items.length === 0) {
     return {
       question: "Why don't I have any top-selling products?",
       causation: "No products are standing out in sales. This could indicate issues with product-market fit, marketing, or inventory availability.",
       actionPlan: "Review product offerings, marketing strategies, and ensure adequate inventory for popular items.",
       severity: 'critical' as const
     };
   }
   
   const topProduct = items[0];
   const secondProduct = items[1];
   
   if (topProduct && secondProduct && topProduct.totalSold > secondProduct.totalSold * 3) {
     return {
       question: "Why is one product dominating sales?",
       causation: `"${topProduct.title}" is outselling other products by ${(topProduct.totalSold / secondProduct.totalSold).toFixed(1)}x. This creates dependency risk but also indicates strong product-market fit.`,
       actionPlan: "Leverage the winning product for cross-selling while diversifying the product portfolio.",
       severity: 'warning' as const
     };
   }
   
   if (items.length >= 3 && items.every(item => item.totalSold < 10)) {
     return {
       question: "Why are all products selling slowly?",
       causation: "All top products have low sales volume. This suggests overall market challenges, pricing issues, or ineffective marketing.",
       actionPlan: "Analyze market trends, adjust pricing strategy, and boost marketing efforts.",
       severity: 'warning' as const
     };
   }
   
   if (items.length >= 3 && items.every(item => item.totalSold > 100)) {
     return {
       question: "What's driving strong product performance?",
       causation: "All top products are performing well with high sales volume. This indicates strong brand positioning and effective product strategy.",
       actionPlan: "Scale successful strategies and explore product line extensions.",
       severity: 'positive' as const
     };
   }
   
   return {
     question: "How can I optimize my product portfolio?",
     causation: "Product sales are distributed. Analyze which products drive the most profit and focus on promoting high-margin items.",
     actionPlan: "Review profit margins by product and adjust marketing focus accordingly.",
     severity: 'neutral' as const
   };
 };

// 2. Create the internal Presentational Component
const TopProductsContent: React.FC<
 { items: TopProductItem[] }
> = (props) => {
  const { items } = props;

  return (
    <Box>
      <List dense>
        {items.map((product, index) => (
          <ListItem
            key={product.id}
            secondaryAction={
              <Chip size="small" label={`${product.totalSold} sold`} />
            }
          >
            <ListItemIcon sx={{ minWidth: '40px' }}>
              {index === 0 ? (
                <Trophy size={20} color="gold" />
              ) : (
                <Typography
                  variant="caption"
                  color="text.secondary"
                  sx={{ width: '20px', textAlign: 'center' }}
                >
                  {index + 1}
                </Typography>
              )}
            </ListItemIcon>
            <ListItemText
              primary={product.title}
              primaryTypographyProps={{
                fontWeight: index === 0 ? 'bold' : 'normal',
                noWrap: true,
                maxWidth: '200px', // Prevents super long titles from breaking layout
              }}
            />
          </ListItem>
        ))}
      </List>
    </Box>
  );
};

interface TopProductsWidgetProps extends Omit<EnhancedWidgetShellProps, 'children'> {
   insightId?: string;
   onFeedback?: FeedbackHandler;
 }

// 3. Create the "Smart" Container Component
export const TopProductsWidget: React.FC<TopProductsWidgetProps> = (props) => {
  const { accessToken } = useAuth();
  const { insightId, onFeedback, ...shellProps } = props;

  const { data, isLoading, error } = useQuery<TopProductItem[]>({
    queryKey: ['dashboardTopProducts'],
    queryFn: async () => {
      const { data } = await axios.get('/api/v1/dashboard/top-products', {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      });
      return data;
    },
    enabled: !!accessToken, // Only run when the user is logged in
  });

  const items = data || [];
  const isEmpty = !isLoading && items.length === 0;

  const insight = getTopProductsInsight(items);
 
 // Calculate total sales for revenue band estimation
 const totalSales = items.reduce((sum, item) => sum + item.totalSold, 0);
 
 // Calculate appropriate revenue band (rough estimate based on sales)
 const getRevenueBand = (totalSales: number): '100k' | '1M' | '5M' | '10M' | '50M+' => {
   // Assuming average product price of $50 for estimation
   const annualRevenue = totalSales * 50 * 12;
   if (annualRevenue < 100000) return '100k';
   if (annualRevenue < 1000000) return '1M';
   if (annualRevenue < 5000000) return '5M';
   if (annualRevenue < 10000000) return '10M';
   return '50M+';
 };

 // Render without CoachTrigger for backward compatibility
 if (!insightId) {
   return (
     <TopProductsContent
       {...shellProps}
       items={items}
       /* isLoading={isLoading}
       isEmpty={isEmpty}
       error={error?.message} */
     />
   );
 }

  return (
    <CoachTrigger
     insightId={insightId}
     tactic="Product Portfolio Optimization"
     successMetrics={["Product Sales", "Revenue Diversification"]}
     estimatedImpact="+20-40% revenue growth"
     onFeedback={onFeedback}
     feedbackEnabled={true}
   >
    <EnhancedWidgetShell
       {...shellProps}
       // Enhanced with 4 C's context
       businessContext={{
         stage: items.length === 0 ? 'survival' : items.length >= 5 ? 'growth' : 'architect',
         burningPriority: 'inventory',
         revenueBand: getRevenueBand(totalSales),
         timeContext: 'weekly'
       }}
       intelligenceLevel="L3"
       insightText={insight.causation}
       insightSeverity={insight.severity}
       primaryAction={{
         label: "Analyze Product Performance",
         onClick: () => console.log("Navigate to product analytics"),
         variant: 'primary' as const,
         workflowType: 'inventory-management',
         expectedImpact: 'high',
         timeToComplete: 'hours'
       }}
       isLoading={isLoading}
       isEmpty={isEmpty}
       error={error?.message}
       currentValue={items.length}
       format="number"
     >
       <TopProductsContent items={items} />
     </EnhancedWidgetShell>
    </CoachTrigger>
  );
};