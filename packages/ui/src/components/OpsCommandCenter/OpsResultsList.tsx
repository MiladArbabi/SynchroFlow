//packages/ui/src/components/OpsCommandCenter/OpsResultsList.tsx
import React from 'react';
import {
  Box,
  List,
  ListItem,
  ListItemButton,
  ListItemText,
  Typography,
} from '@mui/material';
import { OpsAction } from './types';

// Define the component's props
interface OpsResultsListProps {
  commands: OpsAction[];
  selectedIndex: number;
  onCommandSelect: (action: OpsAction) => void;
}

/**
 * Renders the list of available commands (Layer 1 search results).
 * Handles keyboard selection highlighting and click events.
 */
export const OpsResultsList: React.FC<OpsResultsListProps> = ({
  commands,
  selectedIndex,
  onCommandSelect,
}) => {
  // Handle the empty state
  if (commands.length === 0) {
    return (
      <Box sx={{ p: 2, textAlign: 'center' }}>
        <Typography variant="body2" color="text.secondary">
          No actions found.
        </Typography>
      </Box>
    );
  }

  return (
    <List sx={{ p: 0, maxHeight: 400, overflowY: 'auto' }} dense>
      {commands.map((action, index) => {
        const isSelected = selectedIndex === index;

        return (
          <ListItem
            key={action.id}
            disablePadding
            role="listitem" // Explicitly set role for our test
            aria-selected={isSelected} // Set aria-selected for the test
          >
            <ListItemButton
              selected={isSelected} // This controls the MUI visual highlight
              onClick={() => onCommandSelect(action)}
              sx={{
                borderBottom: '1px solid',
                borderColor: 'divider',
              }}
            >
              <ListItemText
                primary={
                  <Typography variant="body1" fontWeight={500}>
                    {action.name}
                  </Typography>
                }
                secondary={
                  <Typography variant="body2" color="text.secondary">
                    {action.description}
                  </Typography>
                }
              />
            </ListItemButton>
          </ListItem>
        );
      })}
    </List>
  );
};