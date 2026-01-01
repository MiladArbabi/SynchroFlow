// apps/frontend/src/lifecycle/Ft1ChecklistShell.tsx
import React, { useEffect, useRef } from 'react';
import { useUiEvents } from 'analytics/useUiEvents';
import { Accordion } from 'ui-component/extended/Accordion';
import { Box, Paper, Stack, Typography } from '@mui/material';
import CheckIcon from '@mui/icons-material/Check';
import { consumeFt1ChecklistFocus, Ft1ChecklistFocus } from 'activation/ft1ChecklistFocus';
import { clearFt1ChecklistFocus } from 'activation/ft1ChecklistFocus';

interface ChecklistTask {
  id: string;
  label: string;
  completed: boolean;
}

interface ChecklistModule {
  moduleId: string;
  title: string;
  tasks: ChecklistTask[];
}

interface Ft1ChecklistShellProps {
  checklist: {
    modules: ChecklistModule[];
  };
  open: boolean;
}

/**
 * Ft1ChecklistShell
 * -----------------
 * Structural shell for FT1 onboarding checklist.
 *
 * HARD RULES:
 * - No lifecycle awareness
 * - No entitlement awareness
 * - No theme branching
 * - No routing
 * - Emits generic UI intent events only
 */
export function Ft1ChecklistShell({ checklist, open }: Ft1ChecklistShellProps) {
  const { emit } = useUiEvents();
  const [expandedId, setExpandedId] = React.useState<string | null>(null);
  const focusRef = useRef<Ft1ChecklistFocus | null>(null);
  const focusedTaskRef = useRef<HTMLDivElement | null>(null);
  const prevOpenRef = useRef<boolean>(false);

  const handleTaskClick = (moduleId: string, taskId: string) => {
    emit({
      event: 'ui.intent',
      payload: {
        action: `task_click:${taskId}`,
        surface: 'ft1_checklist',
        moduleId,
        taskId,
      },
    });
    clearFt1ChecklistFocus();
  };

  // Consume focus ONLY on closed → open transition
  useEffect(() => {
    if (open && !prevOpenRef.current) {
      const nextFocus = consumeFt1ChecklistFocus();
      focusRef.current = consumeFt1ChecklistFocus();
      setExpandedId(nextFocus?.moduleId ?? null);
    }

    // Clear focus when drawer closes
    if (!open && prevOpenRef.current) {
      focusRef.current = null;
      clearFt1ChecklistFocus();
      setExpandedId(null);
    }

    prevOpenRef.current = open;
  }, [open]);

  const focus = focusRef.current ?? undefined;

  // Scroll ONLY after focus is locked
  useEffect(() => {
    if (open && focus && focusedTaskRef.current) {
      focusedTaskRef.current.scrollIntoView({
        block: 'center',
        inline: 'nearest',
      });
    }
  }, [open, focus]);

  return (
    <section 
      data-testid="ft1-checklist-shell"
      className="ft1-checklist"
    >
      <Accordion
        toggle
        expandedId={expandedId}
        onToggle={(id) => setExpandedId(id)}
        data={checklist.modules.map(module => ({
          id: module.moduleId,
          title: module.title,
          focused: focus?.moduleId === module.moduleId,
          content: (
            <Stack spacing={1}>
              {module.tasks.map(task => {
                const isFocused =
                  focus?.moduleId === module.moduleId &&
                  focus?.taskId === task.id;

                return (
                  <Paper
                    key={task.id}
                    ref={isFocused ? focusedTaskRef : undefined}
                    variant="outlined"
                    onClick={() =>
                      handleTaskClick(module.moduleId, task.id)
                    }
                    sx={{
                      p: 1.25,
                      display: 'flex',
                      alignItems: 'center',
                      gap: 1.5,
                      cursor: 'pointer',
                      position: 'relative',
                      bgcolor: isFocused
                        ? 'action.hover'
                        : 'background.paper',
                      opacity: task.completed ? 0.75 : 1,
                    }}
                  >
                    {isFocused && (
                      <Box
                        sx={{
                          width: 2,
                          alignSelf: 'stretch',
                          bgcolor: 'primary.main',
                          borderRadius: 1,
                        }}
                      />
                    )}

                    <Typography
                      variant="body2"
                      color={
                        task.completed
                          ? 'text.disabled'
                          : 'text.primary'
                      }
                    >
                      {task.label}
                    </Typography>
                    {task.completed && (
                      <CheckIcon
                        fontSize="small"
                        sx={{
                          color: 'success.main',
                          ml: 'auto',
                          opacity: 0,
                          transform: 'scale(0.8)',
                          animation: 'ft1-checkmark-in 180ms ease-out forwards',
                          '@keyframes ft1-checkmark-in': {
                            from: {
                              opacity: 0,
                              transform: 'scale(0.8)',
                            },
                            to: {
                              opacity: 0.8,
                              transform: 'scale(1)',
                            },
                          },
                        }}
                      />
                    )}
                  </Paper>
                );
              })}
            </Stack>
          ),
        }))}
      />
    </section>
  );
}
