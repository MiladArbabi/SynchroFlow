/* eslint-disable @typescript-eslint/no-unused-vars */
// packages/ui/src/components/widgets/InventoryAlertsWidget.tsx
import React from 'react';
import { Box, Typography, Chip, Skeleton } from '@mui/material';
import { EnhancedWidgetShellProps, WidgetContentProps } from './types';
import { useQuery } from '@tanstack/react-query';
import axios from 'axios';
import { useAuth } from 'contexts/AuthContext';
import { CoachTrigger } from '../triggers/CoachTrigger';
import { FeedbackHandler } from '../triggers/types';
import { EnhancedWidgetShell } from './EnhancedWidgetShell';

// 1. Define the API response shape (from getInventoryHealth)
interface InventoryAlertItem {
  id: string;
  title: string;
  total_inventory: number;
}

// 4 C's Analysis for Inventory Alerts Widget
 const getInventoryAlertsInsight = (items: InventoryAlertItem[]) => {
   const outOfStockItems = items.filter(item => item.total_inventory <= 0);
   const lowStockItems = items.filter(item => item.total_inventory > 0 && item.total_inventory <= 10);
   
   if (outOfStockItems.length > 0) {
     const topOutOfStock = outOfStockItems[0];
     return {
       question: "Why are products going out of stock?",
       causation: `${outOfStockItems.length} products are out of stock, including "${topOutOfStock.title}". This leads to lost sales and customer dissatisfaction.`,
       actionPlan: "Implement automatic reordering, set safety stock levels, and diversify suppliers for critical items.",
       severity: 'critical' as const
     };
   }
   
   if (lowStockItems.length >= 3) {
     return {
       question: "Why do I have multiple low stock alerts?",
       causation: `${lowStockItems.length} products are running low. This indicates potential supply chain issues or inaccurate demand forecasting.`,
       actionPlan: "Review sales velocity, adjust reorder points, and consider bulk ordering for high-turnover items.",
       severity: 'warning' as const
     };
   }
   
   if (items.length === 0) {
     return {
       question: "Is my inventory properly monitored?",
       causation: "No inventory alerts detected. This could mean well-managed inventory or insufficient monitoring thresholds.",
       actionPlan: "Review inventory monitoring settings and ensure safety stock levels are appropriately set.",
       severity: 'neutral' as const
     };
   }
   
   return {
     question: "How can I optimize inventory management?",
     causation: "Inventory levels are being monitored. Focus on reducing carrying costs while maintaining adequate stock levels.",
     actionPlan: "Analyze inventory turnover rates and optimize reorder quantities based on demand patterns.",
     severity: 'positive' as const
   };
 };

// 2. Create the internal Presentational Component
// This is the logic copied directly from mock-widgets.tsx
const InventoryAlertsContent: React.FC<{ items: InventoryAlertItem[] }> = (props) => {
  const { items } = props;

  return (
    <Box sx={{ p: 2 }}>
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
        {items.map((alert) => {
          const isOutOfStock = alert.total_inventory <= 0;
          const status = isOutOfStock ? 'out' : 'low';
          const label = isOutOfStock
            ? 'Out of Stock'
            : `Low: ${alert.total_inventory}`;

          return (
            <Box
              key={alert.id}
              sx={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                p: 1,
                border: '1px solid',
                borderColor:
                  status === 'out' ? 'error.main' : 'warning.main',
                borderRadius: 1,
                bgcolor: status === 'out' ? 'error.light' : 'warning.light',
              }}
            >
              <Typography variant="body2">{alert.title}</Typography>
              <Chip
                label={label}
                color={status === 'out' ? 'error' : 'warning'}
                size="small"
              />
            </Box>
          );
        })}
      </Box>
    </Box>
  );
};

interface InventoryAlertsWidgetProps extends Omit<EnhancedWidgetShellProps, 'children'> {
   insightId?: string;
   onFeedback?: FeedbackHandler;
 }

// 3. Create the "Smart" Container Component
export const InventoryAlertsWidget: React.FC<InventoryAlertsWidgetProps> = (props) => {
  const { accessToken } = useAuth();
  const { insightId, onFeedback, ...shellProps } = props;

  const { data, isLoading, error } = useQuery<InventoryAlertItem[]>({
    queryKey: ['dashboardInventoryHealth'],
    queryFn: async () => {
      const { data } = await axios.get('/api/v1/dashboard/inventory-health', {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      });
      return data;
    },
    enabled: !!accessToken, // Only run when the user is logged in
  });

  // Ensure items is always an array, even if API returns malformed data
  const items = Array.isArray(data) ? data : [];
  const isEmpty = !isLoading && items.length === 0;

  const insight = getInventoryAlertsInsight(items);
 
 // Calculate inventory health metrics for business context
 const totalAlerts = items.length;
 const outOfStockCount = items.filter(item => item.total_inventory <= 0).length;
 
 const getRevenueBand = (): '100k' | '1M' | '5M' | '10M' | '50M+' => {
   // Rough estimate based on inventory complexity
   if (totalAlerts <= 2) return '100k';
   if (totalAlerts <= 5) return '1M';
   if (totalAlerts <= 10) return '5M';
   if (totalAlerts <= 20) return '10M';
   return '50M+';
 };

 // Render without CoachTrigger for backward compatibility
 if (!insightId) {
   return (
     <InventoryAlertsContent
       {...shellProps}
       items={items}
       isLoading={isLoading}
       isEmpty={isEmpty}
       error={error?.message}
     />
   );
 }

  return (
    <CoachTrigger
     insightId={insightId}
     tactic="Inventory Optimization"
     successMetrics={["Stock Availability", "Carrying Costs"]}
     estimatedImpact="15-30% reduction in stockouts"
     onFeedback={onFeedback}
     feedbackEnabled={true}
   >
    <EnhancedWidgetShell
       {...shellProps}
       businessContext={{
         stage: outOfStockCount > 0 ? 'survival' : totalAlerts > 5 ? 'growth' : 'architect',
         burningPriority: 'inventory',
         revenueBand: getRevenueBand(),
         timeContext: 'realtime'
       }}
       intelligenceLevel="L3"
       insightText={insight.causation}
       insightSeverity={insight.severity}
       primaryAction={{
         label: "Optimize Inventory",
         onClick: () => console.log("Navigate to inventory optimization"),
         variant: 'primary' as const,
         workflowType: 'inventory-management',
         expectedImpact: 'high',
         timeToComplete: 'hours'
       }}
       isLoading={isLoading}
       isEmpty={isEmpty}
       error={error?.message}
       currentValue={totalAlerts}
       format="number"
     >
       <InventoryAlertsContent items={items} />
     </EnhancedWidgetShell>
   </CoachTrigger>
  );
};