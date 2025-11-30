/* eslint-disable @typescript-eslint/no-unused-vars */
//apps/frontend/src/components/OpsCommandCenter/OpsClarificationList.tsx
import React from 'react';
import {
  Box,
  List,
  ListItem,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  Typography,
} from '@mui/material';
import { LucideHelpCircle } from 'lucide-react';
import { ClarificationOption } from 'components/OpsCommandCenter/naturalLanguage/types';

interface OpsClarificationListProps {
  options: ClarificationOption[];
  onSelect: (option: ClarificationOption) => void;
}

/**
 * Renders a list of clarification questions when Kore's
 * confidence is "medium" (Layer 2.75).
 */
export const OpsClarificationList: React.FC<OpsClarificationListProps> = ({
  options,
  onSelect,
}) => {
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
        <LucideHelpCircle size={18} />
        <Typography variant="body1" fontWeight="medium">
          What did you mean?
        </Typography>
      </Box>

      <List disablePadding>
        {options.map((option, index) => (
          <ListItem key={index} disablePadding>
            <ListItemButton
              onClick={() => onSelect(option)}
              sx={{
                py: 1.5,
                borderBottom: '1px solid',
                borderColor: 'divider',
              }}
            >
              <ListItemText
                primary={
                  <Typography variant="body1">
                    {option.label}
                  </Typography>
                }
              />
            </ListItemButton>
          </ListItem>
        ))}
      </List>
    </Box>
  );
};