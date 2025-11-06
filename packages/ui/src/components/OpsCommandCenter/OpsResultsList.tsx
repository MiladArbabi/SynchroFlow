//packages/ui/src/components/OpsCommandCenter/OpsResultsList.tsx
import React from 'react';
import {
  Box,
  List,
  ListItem,
  ListItemButton,
  ListItemText,
  Typography,
  ListSubheader
} from '@mui/material';
import { OpsAction, SearchResult } from './types';

// Define the component's props
interface OpsResultsListProps {
  commands: OpsAction[]; // L1 results
  entities: SearchResult[];
  selectedIndex: number;
  onCommandSelect: (item: OpsAction | SearchResult) => void; // 1. Update prop
}

/**
 * Renders the list of available commands (Layer 1 search results).
 * Handles keyboard selection highlighting and click events.
 */
export const OpsResultsList: React.FC<OpsResultsListProps> = ({
  commands,
  entities,
  selectedIndex,
  onCommandSelect,
}) => {
  const combinedItems = [...commands, ...entities];

  // Handle the empty state
  if (combinedItems.length === 0) {
    return (
      <Box sx={{ p: 2, textAlign: 'center' }}>
        <Typography variant="body2" color="text.secondary">
          No actions found.
        </Typography>
      </Box>
    );
  }

  return (
    <List sx={{ p: 0, maxHeight: 400, overflowY: 'auto' }} dense subheader={<li />}>
      {/* --- L1 ACTIONS SECTION --- */}
      {commands.length > 0 && (
        <ListSubheader sx={{ bgcolor: 'background.paper' }}>Actions</ListSubheader>
      )}
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
                      fontSize: '0.75rem',
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
      
      {/* --- L2 ENTITIES SECTION --- */}
      {entities.length > 0 && (
        <ListSubheader sx={{ bgcolor: 'background.paper' }}>Entities</ListSubheader>
      )}
      {entities.map((entity, index) => {
        const itemIndex = commands.length + index; // Offset by L1 commands
        const isSelected = selectedIndex === itemIndex;

        return (
          <ListItem
            key={entity.id}
            disablePadding
            role="listitem"
            aria-selected={isSelected}
          >
            <ListItemButton
              selected={isSelected}
              onClick={() => onCommandSelect(entity)}
              sx={{
                py: 0.75,
                borderBottom: '1px solid',
                borderColor: 'divider',
              }}
            >
              <ListItemText
                primary={
                  <Typography variant="body1" fontWeight={500}>
                    {entity.title}
                  </Typography>
                }
                secondary={
                  <Typography variant="body2" color="text.secondary" sx={{ fontSize: '0.825rem' }}>
                    {entity.description}
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