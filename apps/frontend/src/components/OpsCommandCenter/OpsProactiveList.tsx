//apps/frontend/src/components/OpsCommandCenter/OpsProactiveList.tsx
import React from 'react';
import {
  Box,
  Typography,
  Button,
  IconButton,
  List,
  ListItem,
  Chip,
  Tooltip,
} from '@mui/material';
import { LucideAlertTriangle, LucideX } from 'lucide-react';
import { ProactiveInsight, SuggestedAction } from 'components/OpsCommandCenter/types';

// Define the component's props
interface OpsProactiveListProps {
  insights: ProactiveInsight[];
  onActionClick: (insight: ProactiveInsight, action: SuggestedAction) => void;
  onDismiss: (insightId: string) => void;
}

// Helper to get the color for the urgency chip
const getUrgencyColor = (
  urgency: 'high' | 'medium' | 'low',
): 'error' | 'warning' | 'info' => {
  if (urgency === 'high') return 'error';
  if (urgency === 'medium') return 'warning';
  return 'info';
};

/**
 * Renders the list of proactive insights when the console is idle.
 * This is the main UI for Layer 3.
 */
export const OpsProactiveList: React.FC<OpsProactiveListProps> = ({
  insights,
  onActionClick,
  onDismiss,
}) => {
  // Filter out any insights that are already dismissed or acted upon
  const activeInsights = insights.filter(
    (i) => i.status === 'new' || i.status === 'viewed',
  );

  return (
    <Box sx={{ maxHeight: 400, overflow: 'auto' }}>
      <Box
        sx={{
          p: 2,
          borderBottom: '1px solid',
          borderColor: 'divider',
          display: 'flex',
          alignItems: 'center',
          gap: 1,
        }}
      >
        <LucideAlertTriangle size={18} />
        <Typography variant="body1" fontWeight="medium">
          Kore: Here's what needs your attention:
        </Typography>
      </Box>

      <List disablePadding>
        {activeInsights.map((insight, index) => (
          <ListItem
            key={insight.id}
            disablePadding
            sx={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'flex-start',
              p: 2,
              borderBottom:
                index < activeInsights.length - 1 ? '1px solid' : 'none',
              borderColor: 'divider',
            }}
          >
            {/* Header: Chip + Dismiss Button */}
            <Box
              sx={{
                width: '100%',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                mb: 1,
              }}
            >
              <Chip
                label={insight.title}
                color={getUrgencyColor(insight.urgency)}
                size="small"
                sx={{ fontWeight: 'medium' }}
              />
              <Tooltip title="Dismiss Insight">
                <IconButton
                  size="small"
                  aria-label="Dismiss Insight"
                  onClick={() => onDismiss(insight.id)}
                >
                  <LucideX size={16} />
                </IconButton>
              </Tooltip>
            </Box>

            {/* Message Body */}
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
              {insight.message}
            </Typography>

            {/* Action Buttons */}
            <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
              {insight.suggestedActions?.map((action: SuggestedAction, idx: number) => (
                <Button
                  key={idx}
                  variant={action.primary ? 'contained' : 'outlined'}
                  size="small"
                  onClick={() => onActionClick(insight, action)}
                >
                  {action.label}
                </Button>
              ))}
            </Box>
          </ListItem>
        ))}
      </List>
    </Box>
  );
};