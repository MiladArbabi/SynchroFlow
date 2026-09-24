// apps/frontend/src/pages/alerts/AlertsSettingsPanel.tsx
//
// GH-1147 — the single notification-preferences UI. Rendered by the Alerts
// module (/alerts/settings) and by the Settings modal (/settings/alerts);
// useNotifications.ts stays the hook/data owner.
//
// Daily summary is deliberately not offered: the preference field exists and
// stays 'off', but nothing schedules a summary yet.

import { useMemo } from 'react';
import {
  Box,
  FormControl,
  FormControlLabel,
  MenuItem,
  Select,
  Skeleton,
  Switch,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import { Lock } from 'lucide-react';

import {
  type NotificationConditionDefinition,
  type NotificationConditionPreferences,
  type NotificationPreferenceUrgency,
  type NotificationPreferencesPatch,
  useNotificationConditions,
  useNotificationPreferences,
  usePushStatus,
  useUpdateNotificationPreferences,
} from './useNotifications';

const AREA_ORDER = [
  'fulfillment',
  'inventory',
  'inbound',
  'shopify',
];

const URGENCY_LABELS: Record<
  NotificationPreferenceUrgency,
  string
> = {
  critical_only: 'Critical only',
  important_critical: 'Important + critical',
  all: 'All available alerts',
};

// Toggles are reversible state: neutral when idle, --accent when on (never
// the confirmed/success tokens). A switch disabled while a save is pending
// must still read as ON, so its checked colour survives disabled.
const ALERTS_SWITCH_SX = {
  '& .MuiSwitch-switchBase + .MuiSwitch-track': {
    bgcolor: 'var(--rule-2)',
    opacity: 1,
  },
  '& .MuiSwitch-switchBase.Mui-checked': {
    color: 'var(--accent)',
  },
  '& .MuiSwitch-switchBase.Mui-checked + .MuiSwitch-track': {
    bgcolor: 'var(--accent)',
    opacity: 0.5,
  },
  '& .MuiSwitch-switchBase.Mui-checked.Mui-disabled': {
    color: 'var(--accent)',
  },
  '& .MuiSwitch-switchBase.Mui-checked.Mui-disabled + .MuiSwitch-track': {
    bgcolor: 'var(--accent)',
    opacity: 0.3,
  },
  '& .MuiSwitch-switchBase.Mui-disabled:not(.Mui-checked) + .MuiSwitch-track': {
    opacity: 0.5,
  },
} as const;

function sentenceCase(value: string): string {
  const normalized = value.replace(/[_-]+/g, ' ');

  return normalized.charAt(0).toUpperCase() + normalized.slice(1);
}

function Section({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <Box
      sx={{
        border: '1px solid var(--rule)',
        borderRadius: '10px',
        bgcolor: 'var(--surface)',
        overflow: 'hidden',
      }}
    >
      <Box
        sx={{
          px: 2,
          py: 1.5,
          borderBottom: '1px solid var(--rule)',
        }}
      >
        <Typography
          sx={{
            fontSize: 14,
            fontWeight: 600,
            color: 'var(--ink)',
          }}
        >
          {title}
        </Typography>

        {description && (
          <Typography
            sx={{
              fontSize: 12,
              color: 'var(--ink-3)',
              mt: 0.25,
            }}
          >
            {description}
          </Typography>
        )}
      </Box>

      <Box sx={{ p: 2 }}>
        {children}
      </Box>
    </Box>
  );
}

const VISUALLY_HIDDEN_SX = {
  position: 'absolute',
  width: 1,
  height: 1,
  p: 0,
  m: '-1px',
  overflow: 'hidden',
  clip: 'rect(0 0 0 0)',
  whiteSpace: 'nowrap',
  border: 0,
} as const;

// Immutable state, not a control: neutral ink, no switch, no handler. Push and
// email stay real switches wherever they can actually be changed.
function AlwaysOnStatus({
  subject,
  reason,
}: {
  subject: string;
  reason: string;
}) {
  return (
    <Tooltip title={reason}>
      <Box
        component="span"
        data-testid="alerts-always-on"
        sx={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 0.5,
          flexShrink: 0,
          fontSize: 12,
          fontWeight: 500,
          color: 'var(--ink-3)',
          whiteSpace: 'nowrap',
        }}
      >
        <Lock size={12} color="var(--ink-4)" aria-hidden />
        <Box component="span" sx={VISUALLY_HIDDEN_SX}>
          {`${subject}: `}
        </Box>
        Always on
      </Box>
    </Tooltip>
  );
}

export default function AlertsSettingsPanel() {
  const preferencesQuery = useNotificationPreferences();
  const conditionsQuery = useNotificationConditions();
  const pushStatusQuery = usePushStatus();
  const update = useUpdateNotificationPreferences();

  const preferences = preferencesQuery.data;
  const conditions = conditionsQuery.data ?? [];

  const groupedConditions = useMemo(() => {
    const grouped = new Map<
      string,
      NotificationConditionDefinition[]
    >();

    for (const condition of conditions) {
      const current = grouped.get(condition.area) ?? [];
      current.push(condition);
      grouped.set(condition.area, current);
    }

    const known = AREA_ORDER.filter(
      (area) => grouped.has(area),
    );

    const unknown = Array.from(grouped.keys())
      .filter((area) => !AREA_ORDER.includes(area))
      .sort();

    return [...known, ...unknown].map((area) => ({
      area,
      conditions: grouped.get(area) ?? [],
    }));
  }, [conditions]);

  if (
    preferencesQuery.isLoading
    || conditionsQuery.isLoading
  ) {
    return (
      <Box
        sx={{
          display: 'flex',
          flexDirection: 'column',
          gap: 1.5,
        }}
      >
        {[1, 2, 3].map((item) => (
          <Skeleton
            key={item}
            variant="rounded"
            height={116}
          />
        ))}
      </Box>
    );
  }

  if (
    preferencesQuery.isError
    || conditionsQuery.isError
    || !preferences
  ) {
    return (
      <Box
        sx={{
          p: 3,
          border: '1px solid var(--rule)',
          borderRadius: '10px',
          bgcolor: 'var(--surface)',
          textAlign: 'center',
        }}
      >
        <Typography
          sx={{
            fontSize: 13,
            color: 'var(--ink-3)',
          }}
        >
          Could not load notification settings.
        </Typography>
      </Box>
    );
  }

  const patch = (
    value: NotificationPreferencesPatch,
  ) => {
    update.mutate(value);
  };

  const patchCondition = (
    conditionKey: string,
    value: NotificationConditionPreferences,
  ) => {
    const current =
      preferences.conditions[conditionKey] ?? {};

    patch({
      conditions: {
        [conditionKey]: {
          ...current,
          ...value,
        },
      },
    });
  };

  return (
    <Box
      sx={{
        display: 'flex',
        flexDirection: 'column',
        gap: 1.5,
      }}
    >
      <Section
        title="Urgency"
        description="Choose how much notification noise you want."
      >
        <FormControl fullWidth size="small">
          <Select
            value={preferences.urgency}
            onChange={(event) => {
              patch({
                urgency: (
                  event.target.value as NotificationPreferenceUrgency
                ),
              });
            }}
            disabled={update.isPending}
          >
            {(Object.keys(URGENCY_LABELS) as NotificationPreferenceUrgency[]).map((value) => (
              <MenuItem key={value} value={value}>
                {URGENCY_LABELS[value]}
              </MenuItem>
            ))}
          </Select>
        </FormControl>
      </Section>

      <Section
        title="Channels"
        description="In-app notifications stay available. Push and email are optional."
      >
        <Box
          sx={{
            display: 'flex',
            flexDirection: 'column',
          }}
        >
          <Box
            sx={{
              display: 'flex',
              alignItems: 'center',
              gap: 1.5,
              minHeight: 38,
            }}
          >
            <Typography sx={{ fontSize: 14, color: 'var(--ink)' }}>
              In-app
            </Typography>
            <AlwaysOnStatus
              subject="In-app notifications"
              reason="In-app notifications keep Recent complete, so they cannot be turned off."
            />
          </Box>

          <Box sx={{ py: 0.5 }}>
            <FormControlLabel
              control={
                <Switch
                  sx={ALERTS_SWITCH_SX}
                  checked={preferences.channels.push}
                  disabled={update.isPending}
                  slotProps={{
                    input: {
                      'aria-label': 'Push notifications',
                    },
                  }}
                  onChange={(_, checked) => {
                    patch({
                      channels: { push: checked },
                    });
                  }}
                />
              }
              label="Push notifications"
            />
            <Typography
              sx={{
                ml: 7,
                mt: -0.5,
                fontSize: 12,
                color: 'var(--ink-3)',
              }}
            >
              {pushStatusQuery.data?.has_registered_destination
                ? pushStatusQuery.data.registered_destination_count === 1
                  ? 'Push destination registered'
                  : `${pushStatusQuery.data.registered_destination_count} push destinations registered`
                : 'No device registered'}
            </Typography>
            {!pushStatusQuery.data?.has_registered_destination && (
              <Typography
                sx={{
                  ml: 7,
                  mt: 0.25,
                  fontSize: 12,
                  color: 'var(--ink-3)',
                }}
              >
                Push won't be delivered until notifications are enabled on a device.
              </Typography>
            )}
          </Box>

          <FormControlLabel
            control={
              <Switch
                sx={ALERTS_SWITCH_SX}
                checked={preferences.channels.email}
                disabled={update.isPending}
                slotProps={{
                  input: {
                    'aria-label': 'Email notifications',
                  },
                }}
                onChange={(_, checked) => {
                  patch({
                    channels: { email: checked },
                  });
                }}
              />
            }
            label="Email"
          />
        </Box>
      </Section>

      <Section
        title="Quiet hours"
        description="Pause non-critical external notifications during a time window."
      >
        <FormControlLabel
          control={
            <Switch
              sx={ALERTS_SWITCH_SX}
              checked={preferences.quiet_hours.enabled}
              disabled={update.isPending}
              slotProps={{
                input: {
                  'aria-label': 'Enable quiet hours',
                },
              }}
              onChange={(_, checked) => {
                patch({
                  quiet_hours: { enabled: checked },
                });
              }}
            />
          }
          label="Use quiet hours"
        />

        {preferences.quiet_hours.enabled && (
          <Box
            sx={{
              display: 'flex',
              gap: 1.5,
              flexWrap: 'wrap',
              mt: 1,
            }}
          >
            <TextField
              label="From"
              type="time"
              size="small"
              value={preferences.quiet_hours.start}
              disabled={update.isPending}
              onChange={(event) => {
                patch({
                  quiet_hours: {
                    start: event.target.value,
                  },
                });
              }}
              slotProps={{
                inputLabel: { shrink: true },
              }}
            />

            <TextField
              label="Until"
              type="time"
              size="small"
              value={preferences.quiet_hours.end}
              disabled={update.isPending}
              onChange={(event) => {
                patch({
                  quiet_hours: {
                    end: event.target.value,
                  },
                });
              }}
              slotProps={{
                inputLabel: { shrink: true },
              }}
            />
          </Box>
        )}

        <FormControlLabel
          sx={{ mt: 1 }}
          control={
            <Switch
              sx={ALERTS_SWITCH_SX}
              checked={
                preferences.quiet_hours.allow_critical
              }
              disabled={update.isPending}
              slotProps={{
                input: {
                  'aria-label':
                    'Allow critical during quiet hours',
                },
              }}
              onChange={(_, checked) => {
                patch({
                  quiet_hours: {
                    allow_critical: checked,
                  },
                });
              }}
            />
          }
          label="Allow critical notifications"
        />
      </Section>

      <Section
        title="What should notify me?"
        description="These conditions come from LaSyncro's current notification catalog."
      >
        {groupedConditions.length === 0 ? (
          <Typography
            sx={{
              fontSize: 12,
              color: 'var(--ink-3)',
            }}
          >
            No notification conditions are available yet.
          </Typography>
        ) : (
          <Box
            sx={{
              display: 'flex',
              flexDirection: 'column',
              gap: 2,
            }}
          >
            {groupedConditions.map((group) => (
              <Box key={group.area}>
                <Typography
                  sx={{
                    fontSize: 11,
                    fontWeight: 600,
                    color: 'var(--ink-4)',
                    textTransform: 'uppercase',
                    letterSpacing: '0.06em',
                    mb: 0.75,
                  }}
                >
                  {sentenceCase(group.area)}
                </Typography>

                <Box
                  sx={{
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 1,
                  }}
                >
                  {group.conditions.map((condition) => {
                    const conditionPreferences =
                      preferences.conditions[
                        condition.key
                      ] ?? {};

                    const enabled =
                      conditionPreferences.enabled
                      ?? condition.defaultEnabled;

                    const push =
                      preferences.channels.push
                      && (
                        conditionPreferences.push
                        ?? true
                      );

                    const email =
                      preferences.channels.email
                      && (
                        conditionPreferences.email
                        ?? true
                      );

                    return (
                      <Box
                        key={condition.key}
                        sx={{
                          p: 1.5,
                          border:
                            '1px solid var(--rule)',
                          borderRadius: '8px',
                          bgcolor: 'var(--bg-3)',
                        }}
                      >
                        <Box
                          sx={{
                            display: 'flex',
                            alignItems: 'flex-start',
                            gap: 1,
                          }}
                        >
                          <Box
                            sx={{
                              flex: 1,
                              minWidth: 0,
                            }}
                          >
                            <Typography
                              sx={{
                                fontSize: 13,
                                fontWeight: 500,
                                color: 'var(--ink)',
                              }}
                            >
                              {condition.merchantLabel}
                            </Typography>

                            <Typography
                              sx={{
                                fontSize: 11,
                                color: 'var(--ink-4)',
                                mt: 0.25,
                              }}
                            >
                              {sentenceCase(
                                condition.urgency,
                              )}
                              {condition
                                .criticalInAppProtection
                                ? ' · In-app cannot be disabled'
                                : ''}
                            </Typography>
                          </Box>

                          {condition.criticalInAppProtection ? (
                            <AlwaysOnStatus
                              subject={condition.merchantLabel}
                              reason="Critical notifications always reach you in-app. Push and email can still be turned off below."
                            />
                          ) : (
                            <Switch
                              sx={ALERTS_SWITCH_SX}
                              checked={enabled}
                              disabled={update.isPending}
                              slotProps={{
                                input: {
                                  'aria-label':
                                    `Notify for ${condition.merchantLabel}`,
                                },
                              }}
                              onChange={(_, checked) => {
                                patchCondition(
                                  condition.key,
                                  { enabled: checked },
                                );
                              }}
                            />
                          )}
                        </Box>

                        <Box
                          sx={{
                            display: 'flex',
                            gap: 2,
                            flexWrap: 'wrap',
                            mt: 1,
                          }}
                        >
                          <FormControlLabel
                            control={
                              <Switch
                                sx={ALERTS_SWITCH_SX}
                                size="small"
                                checked={push}
                                disabled={
                                  update.isPending
                                  || !preferences
                                    .channels.push
                                }
                                slotProps={{
                                  input: {
                                    'aria-label':
                                      `Push for ${condition.merchantLabel}`,
                                  },
                                }}
                                onChange={(_, checked) => {
                                  patchCondition(
                                    condition.key,
                                    { push: checked },
                                  );
                                }}
                              />
                            }
                            label="Push"
                          />

                          <FormControlLabel
                            control={
                              <Switch
                                sx={ALERTS_SWITCH_SX}
                                size="small"
                                checked={email}
                                disabled={
                                  update.isPending
                                  || !preferences
                                    .channels.email
                                }
                                slotProps={{
                                  input: {
                                    'aria-label':
                                      `Email for ${condition.merchantLabel}`,
                                  },
                                }}
                                onChange={(_, checked) => {
                                  patchCondition(
                                    condition.key,
                                    { email: checked },
                                  );
                                }}
                              />
                            }
                            label="Email"
                          />
                        </Box>
                      </Box>
                    );
                  })}
                </Box>
              </Box>
            ))}
          </Box>
        )}

        {update.isError && (
          <Typography
            sx={{
              fontSize: 11,
              color: 'error.main',
              mt: 1,
            }}
          >
            Could not save notification settings.
          </Typography>
        )}
      </Section>
    </Box>
  );
}
