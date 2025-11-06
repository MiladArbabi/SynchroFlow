//packages/ui/src/components/OpsCommandCenter/OpsResultsList.tsx
import React, { useRef } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import {
  Box,
  List,
  ListItem,
  ListItemButton,
  ListItemText,
  Typography,
  ListSubheader
} from '@mui/material';
import { OpsAction, SearchResult, VirtualItem } from './types';

// Define the component's props
interface OpsResultsListProps {
  items: VirtualItem[];
  selectedIndex: number;
  onCommandSelect: (item: OpsAction | SearchResult) => void; // 1. Update prop
}
/**
 * Renders the list of available commands (Layer 1 search results).
 * Handles keyboard selection highlighting and click events.
 */
export const OpsResultsList: React.FC<OpsResultsListProps> = ({
  items,
  selectedIndex,
  onCommandSelect,
}) => {
  // 1. Create a ref for the scrolling parent element
 const parentRef = useRef<HTMLUListElement>(null);

 // 3. Set up the virtualizer
 // HOOKS MUST be called *before* any early returns.
 const rowVirtualizer = useVirtualizer({
  count: items.length,
  getScrollElement: () => parentRef.current,
  estimateSize: (index) => {
   // Give headers a bit less space than items
   const item = items[index];
   return item.type === 'header' ? 32 : 58; // Estimated heights
  },
  overscan: 10, // Render 10 items above/below the viewport
 });

  // Handle the empty state
  if (items.length === 0) {
    return (
      <Box sx={{ p: 2, textAlign: 'center' }}>
        <Typography variant="body2" color="text.secondary">
          No actions found.
        </Typography>
      </Box>
    );
  }

 const virtualItems = rowVirtualizer.getVirtualItems();

  return (
    <List
      ref={parentRef} // Attach the ref here
      sx={{ p: 0, maxHeight: 400, overflowY: 'auto', position: 'relative' }} // Add relative positioning
      data-testid="virtual-scroll-container"
      dense
    >
    {/* Render a container for the total size */}
    <Box sx={{ height: `${rowVirtualizer.getTotalSize()}px`, width: '100%' }} />  
      {/* 5. Iterate over virtual items and position them absolutely */}
      {virtualItems.map((virtualItem) => {
      const item = items[virtualItem.index];
      const isSelected = selectedIndex === virtualItem.index;

      // --- RENDER HEADER ---
    if (item.type === 'header') {
     return (
      <ListSubheader
       data-testid={`header-${item.label.toLowerCase()}`}
       key={virtualItem.key}
       component="div" // Required for positioning
       sx={{
        bgcolor: 'background.paper',
        position: 'absolute',
        top: 0,
        left: 0,
        width: '100%',
        height: `${virtualItem.size}px`,
        transform: `translateY(${virtualItem.start}px)`,
       }}
      >
       {item.label}
      </ListSubheader>
     );
    }

    // --- RENDER ITEM (ACTION OR ENTITY) ---
    const itemData = item.data;
    const isAction = 'category' in itemData; // Check if it's an OpsAction

    return (
          <ListItem
            key={itemData.id}
            disablePadding
            role="listitem"
            aria-selected={isSelected}
            component="div" // Required for positioning
            data-testid={`item-${itemData.id}`}
              sx={{
              position: 'absolute',
              top: 0,
              left: 0,
              width: '100%',
              height: `${virtualItem.size}px`,
              transform: `translateY(${virtualItem.start}px)`,
              }}
          >
            <ListItemButton
              selected={isSelected}
              onClick={() => onCommandSelect(itemData)}
              sx={{
                py: isAction ? 0.25 : 0.75,
                borderBottom: '1px solid',
                borderColor: 'divider',
                height: '100%',
              }}
            >
              <ListItemText
                primary={
                  <Typography
                    variant="body1"
                    color={isAction ? 'text.secondary' : 'inherit'}
                    fontWeight={isAction ? 900 : 500}
                    sx={{ fontSize: isAction ? '0.75rem' : '1rem' }}
                  >
                    {isAction ? itemData.name : itemData.title}
                  </Typography>
                }
                secondary={
                  <Typography
                    variant="body2"
                    color="text.secondary"
                    sx={{ fontSize: isAction ? '0.75rem' : '0.825rem' }}
                  >
                    {itemData.description}
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