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
              selected={isSelected}
              onClick={() => onCommandSelect(action)}
              sx={{
                // Reduce vertical padding to make list denser
                py: 0.25, //  Value 1 is default
                borderBottom: '1px solid',
                borderColor: 'divider',
              }}
            >
              <ListItemText
                primary={
                  <Typography
                    variant="body1"
                    color="text.secondary"
                    fontWeight={900}
                    sx={{
                      // Description size
                      fontSize: '0.75',
                    }}
                  >
                    {action.name}
                  </Typography>
                }
                secondary={
                  <Typography
                    variant="body2"
                    color="text.secondary"
                    sx={{
                      // Description size
                      fontSize: '0.75rem',
                    }}
                  >
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