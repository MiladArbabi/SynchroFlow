//packages/ui/src/components/OpsCommandCenter/ConversationHeader.tsx
import React from 'react';
import { Box, Typography, IconButton, Tooltip } from '@mui/material';
import { LucideX } from 'lucide-react';
import { KoreConversation } from 'components/OpsCommandCenter/naturalLanguage/types';

interface ConversationHeaderProps {
  conversation: KoreConversation | null;
  onClear: () => void;
}

/**
 * A small header that appears when Kore is in a follow-up conversation,
 * showing the current topic and allowing the user to reset.
 */
export const ConversationHeader: React.FC<ConversationHeaderProps> = ({
  conversation,
  onClear,
}) => {
  // If no conversation is active, render nothing
  if (!conversation) {
    return null;
  }

  // Format the topic name (e.g., "find-orders" -> "find orders")
  const topicName = conversation.topic.replace('-', ' ');

  return (
    <Box
      sx={{
        p: 1,
        borderBottom: '1px solid',
        borderColor: 'divider',
        bgcolor: 'action.hover', // A slight tint to show it's a special state
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
      }}
    >
      <Typography variant="caption" color="text.secondary" sx={{ ml: 1 }}>
        {/* Test expects "Continuing: find-orders" */}
        Continuing: {topicName}
      </Typography>
      <Tooltip title="Start new conversation">
        <IconButton
          size="small"
          onClick={onClear}
          aria-label="Start new conversation" // For the test
        >
          <LucideX size={16} />
        </IconButton>
      </Tooltip>
    </Box>
  );
};