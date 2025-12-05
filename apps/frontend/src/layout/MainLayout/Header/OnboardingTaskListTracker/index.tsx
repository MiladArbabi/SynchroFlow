// apps/frontend/src/layout/MainLayout/Header/OnboardingTaskListTracker/index.tsx
/* eslint-disable @typescript-eslint/no-unused-vars */
import React, { useEffect, useRef, useState } from 'react';

// material-ui
import { useTheme } from '@mui/material/styles';
import useMediaQuery from '@mui/material/useMediaQuery';

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

// context imports
import { useIntegration } from 'contexts/IntegrationContext';
import { useDashboardState } from 'contexts/DashboardStateContext';
import { useSpecterConfig } from 'contexts/SpecterConfigContext';

// assets
import { IconBell, IconCheck, IconCircle } from '@tabler/icons-react';

// ==============================|| TYPES ||============================== //

interface OnboardingStep {
  id: string;
  label: string;
  description?: string;
  done: boolean;
}

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

  // --- Context hooks: source of truth for onboarding state ---
  const { hasIntegrations, syncStatus } = useIntegration();
  const { userState, isLoading: isUserStateLoading } = useDashboardState();
  const { shouldShowOnboardingNudges } = useSpecterConfig();

  // --- Local UI state for the Popper ---
  const [open, setOpen] = useState(false);

  // Anchor ref is the bell icon button
  const anchorRef = useRef<HTMLButtonElement | null>(null);
  const prevOpen = useRef(open);

  // --- Derive onboarding booleans from contexts ---

  // 1) Store connection
  const shopifyConnected = userState?.user.shopify_connected === true;

  // 2) Initial sync completed
  const syncCompleted = syncStatus === 'COMPLETED';

  // 3) Orders-per-month segmentation filled
  const hasOrdersPerMonthSegment =
    !!userState?.user.orders_per_month_segment;

  // 4) Specter nudges configured (very simple heuristic:
  //    if nudges are no longer "first-run" / always-on, we assume they've been reviewed)
  const specterConfigured = shouldShowOnboardingNudges === false;

  // --- Checklist steps definition ---
  const steps: OnboardingStep[] = [
    {
      id: 'connect-store',
      label: 'Connect your Shopify store',
      description: 'Link your main storefront so we can pull products and orders.',
      done: shopifyConnected
    },
    {
      id: 'complete-sync',
      label: 'Let us complete your first data sync',
      description: 'We fetch your products, orders, and line items.',
      done: syncCompleted
    },
    {
      id: 'orders-per-month',
      label: 'Tell us your monthly order volume',
      description: 'Answer the “orders per month” banner on the dashboard.',
      done: hasOrdersPerMonthSegment
    },
    {
      id: 'specter-config',
      label: 'Review Specter nudges (optional)',
      description: 'Tune how and when Specter should surface insights.',
      done: specterConfigured
    }
  ];

  const totalSteps = steps.length;
  const completedSteps = steps.filter((s) => s.done).length;
  const remainingSteps = totalSteps - completedSteps;
  const hasOutstandingTasks = remainingSteps > 0;

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
                    {/* Header + progress */}
                    <Stack spacing={1.5} sx={{ p: 2 }}>
                      <Stack
                        direction="row"
                        alignItems="center"
                        justifyContent="space-between"
                      >
                        <Typography variant="subtitle1">
                          Onboarding checklist
                        </Typography>

                        <Chip
                          size="small"
                          label={
                            hasOutstandingTasks
                              ? `${remainingSteps} left`
                              : 'All done'
                          }
                          color={hasOutstandingTasks ? 'warning' : 'success'}
                          sx={{
                            color: theme.vars.palette.common.white
                          }}
                        />
                      </Stack>

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

                    {/* Checklist items */}
                    <Box
                      sx={{
                        maxHeight: 'calc(100vh - 260px)',
                        overflowY: 'auto',
                        overflowX: 'hidden',
                        '&::-webkit-scrollbar': { width: 5 }
                      }}
                    >
                      <Stack spacing={1.5} sx={{ p: 2, pt: 1.5 }}>
                        {steps.map((step) => {
                          const icon = step.done ? (
                            <IconCheck
                              size={18}
                              stroke={1.5}
                              style={{ color: theme.vars.palette.success.main }}
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
                              key={step.id}
                              direction="row"
                              alignItems="flex-start"
                              spacing={1.5}
                            >
                              <Box sx={{ mt: 0.3 }}>{icon}</Box>
                              <Box sx={{ flex: 1 }}>
                                <Typography
                                  variant="body2"
                                  sx={{
                                    fontWeight: step.done ? 500 : 600,
                                    textDecoration: step.done
                                      ? 'line-through'
                                      : 'none'
                                  }}
                                >
                                  {step.label}
                                </Typography>
                                {step.description && (
                                  <Typography
                                    variant="caption"
                                    color="text.secondary"
                                  >
                                    {step.description}
                                  </Typography>
                                )}
                              </Box>
                              <Chip
                                size="small"
                                label={step.done ? 'Done' : 'To do'}
                                variant={step.done ? 'filled' : 'outlined'}
                                color={step.done ? 'success' : 'default'}
                              />
                            </Stack>
                          );
                        })}
                      </Stack>
                    </Box>
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