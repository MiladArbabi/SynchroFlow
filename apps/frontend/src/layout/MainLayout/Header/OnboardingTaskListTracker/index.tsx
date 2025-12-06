/* eslint-disable react-hooks/exhaustive-deps */
// apps/frontend/src/layout/MainLayout/Header/OnboardingTaskListTracker/index.tsx
import React, { useEffect, useRef, useState } from 'react';

// material-ui
import { useTheme } from '@mui/material/styles';
import useMediaQuery from '@mui/material/useMediaQuery';
import { useAuth } from 'contexts/AuthContext';
import { useDashboardState } from 'contexts/DashboardStateContext';

import Badge from '@mui/material/Badge';
import IconButton from '@mui/material/IconButton';
import Tooltip from '@mui/material/Tooltip';
import Chip from '@mui/material/Chip';
import ClickAwayListener from '@mui/material/ClickAwayListener';
import Divider from '@mui/material/Divider';
import Paper from '@mui/material/Paper';
import Popper, { PopperPlacementType } from '@mui/material/Popper';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import Box from '@mui/material/Box';
import LinearProgress from '@mui/material/LinearProgress';

// project imports
import MainCard from 'ui-component/cards/MainCard';
import Transitions from 'ui-component/extended/Transitions';

// onboarding readiness imports
import type { ModuleOnboardingReadiness } from '@lasyncro/shared';
import { useOnboardingReadiness } from 'hooks/useOnboardingReadiness';

// assets
import { IconBell, IconCheck, IconCircle } from '@tabler/icons-react';

// ==============================|| ONBOARDING CHECKLIST / NOTIFICATION SECTION ||============================== //
/**
 *
 * - Previously: "notifications" popper with mock data.
 * - Now: A compact onboarding checklist tracker, surfaced from the header bell.
 *
 * Responsibilities:
 * - Show a bell with a red dot if there are outstanding onboarding tasks.
 * - On open, show a checklist summarizing key onboarding steps and their status.
 * - Derive state from:
 *    - IntegrationContext (store connection + sync status)
 *    - DashboardStateContext (orders_per_month_segment, etc.)
 *    - SpecterConfigContext (optional Specter onboarding step)
 *
 * This will later be extracted into a dedicated OnboardingChecklist component
 * and potentially moved out of the header, but for now we keep the trigger here.
 */
const OnboardingTaskListTracker: React.FC = () => {
  const theme = useTheme();
  const downMD = useMediaQuery(theme.breakpoints.down('md'));
  
  const { accessToken } = useAuth();
  const { userState } = useDashboardState();
  const ordersPerMonthSegment = userState?.user.orders_per_month_segment;

    // --- Local UI state for the Popper ---
  const [open, setOpen] = useState(false);

  // Anchor ref is the bell icon button
  const anchorRef = useRef<HTMLButtonElement | null>(null);
  const prevOpen = useRef(open);

  // --- Onboarding readiness (from shared engine) ---
  // NOTE: using shopId=1 for now (matches DashboardPage)
  const { data, loading, error, refetch } = useOnboardingReadiness({
    shopId: 1,
    accessToken: accessToken ?? undefined,
  });

  const modules: ModuleOnboardingReadiness[] = data?.modules ?? [];

  // Which module's tasks are shown in the tracker ("platform" or "order-nexus")
  const [selectedModuleId, setSelectedModuleId] = useState<string | null>(null);

  // When readiness data arrives, default to the first module
  useEffect(() => {
    if (!selectedModuleId && modules.length > 0) {
      setSelectedModuleId(modules[0].moduleId);
    }
  }, [selectedModuleId, modules]);

  const selectedModule =
    modules.find((m) => m.moduleId === selectedModuleId) ?? modules[0];

  const moduleTasks = selectedModule?.tasks ?? [];

  const totalSteps = moduleTasks.length;
  const completedSteps = moduleTasks.filter((t) => t.complete).length;
  const remainingSteps = totalSteps - completedSteps;

  // Red dot if ANY module has unfinished required tasks
  const hasOutstandingTasks = modules.some((m) =>
    m.tasks.some((t) => t.required && !t.complete)
  );

  const progressValue =
    totalSteps > 0 ? (completedSteps / totalSteps) * 100 : 0;

  // --- Handlers for Popper open/close ---
  const handleToggle = () => {
    setOpen((prevOpen) => !prevOpen);
  };

  const handleClose = (event: MouseEvent | TouchEvent) => {
    if (anchorRef.current && anchorRef.current.contains(event.target as Node)) {
      return;
    }
    setOpen(false);
  };

  // Return focus to the bell when the popper closes
  useEffect(() => {
    if (prevOpen.current === true && open === false) {
      if (anchorRef.current instanceof HTMLElement) {
        anchorRef.current.focus();
      }
    }
    prevOpen.current = open;
  }, [open]);

  const hasInitializedRef = useRef(false);

  useEffect(() => {
    if (ordersPerMonthSegment === undefined) return;

    // Skip the first time we see a value; only react to *changes* afterwards
    if (!hasInitializedRef.current) {
      hasInitializedRef.current = true;
      return;
    }

    refetch();
  }, [ordersPerMonthSegment, refetch]);

  const popperPlacement: PopperPlacementType = downMD ? 'bottom' : 'bottom-end';

  // ==============================|| RENDER ||============================== //

  return (
    <>
      {/* Header bell with badge driven by onboarding completion state */}
      <Box sx={{ ml: { xs: 0, md: 1 }, mr: { xs: 0, md: 1 } }}>
        <Tooltip title="Onboarding checklist">
          <IconButton
            ref={anchorRef}
            aria-controls={open ? 'onboarding-checklist-popper' : undefined}
            aria-haspopup="true"
            onClick={handleToggle}
            color="inherit"
            size="large"
          >
            <Badge
              variant="dot"
              color="error"
              invisible={!hasOutstandingTasks} // red dot only when there are unfinished tasks
            >
              <IconBell stroke={1.5} size="20px" />
            </Badge>
          </IconButton>
        </Tooltip>
      </Box>

      {/* Popper with onboarding checklist */}
      <Popper
        placement={popperPlacement}
        open={open}
        anchorEl={anchorRef.current}
        role={undefined}
        transition
        disablePortal={true}
        popperOptions={{
          modifiers: [
            {
              name: 'offset',
              options: { offset: [downMD ? 5 : 0, 20] }
            }
          ]
        }}
        sx={{ zIndex: 1300, width: '100%', maxWidth: 350, minWidth: 300 }}
      >
        {({ TransitionProps }) => (
          <ClickAwayListener onClickAway={handleClose}>
            <Transitions
              type="fade"
              in={open}
              {...TransitionProps}
              transformOriginPosition={
                popperPlacement.includes('top') ? 'bottom' : 'top'
              }
            >
              <Paper sx={{ boxShadow: theme.shadows[16] }}>
                {open && (
                  <MainCard border={false} elevation={16} content={false}>
                    {/* Loading / error states */}
                    {loading && (
                      <Stack spacing={1.5} sx={{ p: 2 }}>
                        <Typography variant="subtitle1">
                          Onboarding checklist
                        </Typography>
                        <Typography variant="caption" color="text.secondary">
                          Loading onboarding readiness…
                        </Typography>
                        <LinearProgress sx={{ borderRadius: 999 }} />
                      </Stack>
                    )}

                    {!loading && error && (
                      <Stack spacing={1.5} sx={{ p: 2 }}>
                        <Typography variant="subtitle1">
                          Onboarding checklist
                        </Typography>
                        <Typography variant="caption" color="error">
                          Failed to load onboarding readiness.
                        </Typography>
                        <Typography variant="caption" color="text.secondary">
                          {error.message}
                        </Typography>
                        <Chip
                          label="Retry"
                          size="small"
                          onClick={() => refetch()}
                          color="primary"
                          variant="outlined"
                        />
                      </Stack>
                    )}

                    {!loading && !error && selectedModule && (
                      <>
                        {/* Header + progress for selected module */}
                        <Stack spacing={1.5} sx={{ p: 2 }}>
                          <Stack
                            direction="row"
                            alignItems="center"
                            justifyContent="space-between"
                          >
                            <Typography variant="subtitle1">
                              Onboarding – {selectedModule.displayName}
                            </Typography>

                            <Chip
                              size="small"
                              label={
                                remainingSteps > 0
                                  ? `${remainingSteps} left`
                                  : 'All done'
                              }
                              color={remainingSteps > 0 ? 'warning' : 'success'}
                              sx={{
                                color: theme.vars.palette.common.white
                              }}
                            />
                          </Stack>

                          {/* Module selector chips (if multiple modules) */}
                          {modules.length > 1 && (
                            <Stack direction="row" spacing={1} sx={{ mt: 0.5, flexWrap: 'wrap' }}>
                              {modules.map((m) => (
                                <Chip
                                  key={m.moduleId}
                                  size="small"
                                  label={m.displayName}
                                  variant={
                                    m.moduleId === selectedModule.moduleId
                                      ? 'filled'
                                      : 'outlined'
                                  }
                                  color={
                                    m.moduleId === selectedModule.moduleId
                                      ? 'primary'
                                      : 'default'
                                  }
                                  onClick={() => setSelectedModuleId(m.moduleId)}
                                />
                              ))}
                            </Stack>
                          )}

                          {/* Progress bar */}
                          <Box sx={{ mt: 0.5 }}>
                            <LinearProgress
                              variant="determinate"
                              value={progressValue}
                              sx={{ borderRadius: 999 }}
                            />
                            <Typography variant="caption" color="text.secondary">
                              {completedSteps}/{totalSteps} steps completed
                            </Typography>
                          </Box>
                        </Stack>

                        <Divider />

                        {/* Checklist items for selected module */}
                        <Box
                          sx={{
                            maxHeight: 'calc(100vh - 260px)',
                            overflowY: 'auto',
                            overflowX: 'hidden',
                            '&::-webkit-scrollbar': { width: 5 }
                          }}
                        >
                          <Stack spacing={1.5} sx={{ p: 2, pt: 1.5 }}>
                            {moduleTasks.map((task) => {
                              const icon = task.complete ? (
                                <IconCheck
                                  size={18}
                                  stroke={1.5}
                                  style={{
                                    color: theme.vars.palette.success.main
                                  }}
                                />
                              ) : (
                                <IconCircle
                                  size={18}
                                  stroke={1.5}
                                  style={{
                                    color: theme.vars.palette.text.secondary
                                  }}
                                />
                              );

                              return (
                                <Stack
                                  key={task.id}
                                  direction="row"
                                  alignItems="flex-start"
                                  spacing={1.5}
                                >
                                  <Box sx={{ mt: 0.3 }}>{icon}</Box>
                                  <Box sx={{ flex: 1 }}>
                                    <Typography
                                      variant="body2"
                                      sx={{
                                        fontWeight: task.complete ? 500 : 600,
                                        textDecoration: task.complete
                                          ? 'line-through'
                                          : 'none'
                                      }}
                                    >
                                      {task.label}
                                    </Typography>
                                    {/* Optional: show task.id for debugging */}
                                    <Typography
                                      variant="caption"
                                      color="text.secondary"
                                    >
                                      {task.required ? 'Required' : 'Optional'}
                                    </Typography>
                                  </Box>
                                  <Chip
                                    size="small"
                                    label={task.complete ? 'Done' : 'To do'}
                                    variant={task.complete ? 'filled' : 'outlined'}
                                    color={task.complete ? 'success' : 'default'}
                                  />
                                </Stack>
                              );
                            })}
                          </Stack>
                        </Box>
                      </>
                    )}
                  </MainCard>
                )}
              </Paper>
            </Transitions>
          </ClickAwayListener>
        )}
      </Popper>
    </>
  );
};

export default OnboardingTaskListTracker;