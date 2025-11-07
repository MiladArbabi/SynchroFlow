//packages/ui/src/components/OpsCommandCenter/OpsSearchStatus.tsx
// packages/ui/src/components/OpsCommandCenter/OpsSearchStatus.tsx
import React from 'react';
import { Box, Typography } from '@mui/material';

interface OpsSearchStatusProps {
  actionCount: number;
  entityCount: number;
}

// Helper to pluralize
const pluralize = (count: number, singular: string, plural: string) =>
  count === 1 ? `${count} ${singular}` : `${count} ${plural}`;

export const OpsSearchStatus: React.FC<OpsSearchStatusProps> = ({
  actionCount,
  entityCount,
}) => {
  const hasActions = actionCount > 0;
  const hasEntities = entityCount > 0;

  let statusText = '';

  if (hasActions && hasEntities) {
    statusText = `${pluralize(actionCount, 'Action', 'Actions')}, ${pluralize(
      entityCount,
      'Entity',
      'Entities',
    )}`;
  } else if (hasActions) {
    statusText = pluralize(actionCount, 'Action', 'Actions');
  } else if (hasEntities) {
    statusText = pluralize(entityCount, 'Entity', 'Entities');
  } else {
    statusText = 'No results found';
  }

  return (
    <Box
      sx={{
        p: 1.5,
        borderTop: '1px solid',
        borderColor: 'divider',
        backgroundColor: 'background.default', // A slightly different bg
      }}
    >
      <Typography variant="caption" color="text.secondary">
        {statusText}
      </Typography>
    </Box>
  );
};