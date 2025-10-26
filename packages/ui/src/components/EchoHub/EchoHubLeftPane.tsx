// packages/ui/src/components/EchoHub/EchoHubLeftPane.tsx
import React from 'react';
import {
  List,
  ListItem,
  ListItemButton,
  ListItemText,
  ListSubheader,
  Divider,
} from '@mui/material';

// Static data for v1
const sources = ['All', 'Email', 'Chat', 'Shopify Inbox'];
const filters = ['Unassigned', 'Mine', 'High Priority', 'SLA Breach Risk'];

/**
 * EchoHubLeftPane: Displays navigation lists for sources and filters.
 */
const EchoHubLeftPane: React.FC = () => {
  // We'll add selected state later
  const [selectedSource, setSelectedSource] = React.useState('All');
  const [selectedFilter, setSelectedFilter] = React.useState('Unassigned');

  return (
    <List dense sx={{ width: '100%', height: '100%', bgcolor: 'background.paper', overflowY: 'auto' }}>
      {/* Sources Section */}
      <ListSubheader>Sources</ListSubheader>
      {sources.map((source) => (
        <ListItem key={source} disablePadding>
          <ListItemButton
            selected={selectedSource === source}
            // onClick={() => setSelectedSource(source)} // Add functionality later
          >
            <ListItemText primary={source} />
          </ListItemButton>
        </ListItem>
      ))}

      <Divider sx={{ my: 1 }} />

      {/* Filters Section */}
      <ListSubheader>Filters</ListSubheader>
      {filters.map((filter) => (
        <ListItem key={filter} disablePadding>
          <ListItemButton
             selected={selectedFilter === filter}
            // onClick={() => setSelectedFilter(filter)} // Add functionality later
          >
            <ListItemText primary={filter} />
          </ListItemButton>
        </ListItem>
      ))}
    </List>
  );
};

export default EchoHubLeftPane;