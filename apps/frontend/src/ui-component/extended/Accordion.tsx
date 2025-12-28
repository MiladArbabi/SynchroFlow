import React, { useEffect, useState } from 'react';
import MuiAccordion from '@mui/material/Accordion';
import MuiAccordionDetails from '@mui/material/AccordionDetails';
import MuiAccordionSummary from '@mui/material/AccordionSummary';
import Box from '@mui/material/Box';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';

export interface AccordionItem {
  id: string;
  title: React.ReactNode;
  content: React.ReactNode;
  disabled?: boolean;
  expanded?: boolean;
  defaultExpand?: boolean;
  focused?: boolean;
}

interface AccordionProps {
  data: AccordionItem[];
  defaultExpandedId?: string | null;
  expandIcon?: React.ReactNode | false;
  square?: boolean;
  toggle?: boolean;
}

export function Accordion({
  data,
  defaultExpandedId = null,
  expandIcon,
  square,
  toggle,
}: AccordionProps) {
  const [expanded, setExpanded] = useState<string | false>(false);

  const handleChange =
    (panel: string) => (_: unknown, newExpanded: boolean) => {
      if (toggle) {
        setExpanded(newExpanded ? panel : false);
      }
    };

  useEffect(() => {
    if (defaultExpandedId) {
      setExpanded(defaultExpandedId);
    }
  }, [defaultExpandedId]);

  return (
    <Box sx={{ width: '100%' }}>
      {data.map(item => (
        <MuiAccordion
          key={item.id}
          elevation={0}
          square={square}
          disabled={item.disabled}
          sx={{
            border: item.focused ? '1px solid' : undefined,
            borderColor: item.focused ? 'primary.main' : undefined,
            backgroundColor: item.focused ? 'action.hover' : undefined,
          }}
          expanded={
            toggle
              ? expanded === item.id
              : !item.disabled && !!item.expanded
          }
          onChange={handleChange(item.id)}
        >
          <MuiAccordionSummary
            expandIcon={
              expandIcon === false ? null : expandIcon || <ExpandMoreIcon />
            }
            sx={{
              color: item.focused ? 'text.primary' : 'text.secondary',
              fontWeight: item.focused ? 600 : 500,
              borderLeft: item.focused ? 3 : 0,
              borderColor: item.focused ? 'primary.main' : 'transparent',
              pl: item.focused ? 1.5 : 2,
              transition: 'all 120ms ease-out',
            }}
          >
            {item.title}
          </MuiAccordionSummary>
          <MuiAccordionDetails>{item.content}</MuiAccordionDetails>
        </MuiAccordion>
      ))}
    </Box>
  );
}