/* eslint-disable @typescript-eslint/no-unused-vars */
// apps/frontend/src/pages/ft2-pages/MemberDetailPage.tsx
//
// MEMBER DETAIL PAGE — /team/:userId
// -----------------------------------
// Owner/admin: full view — identity, cost & shift, schedule, performance, activity, notes.
// Operator (own record only): identity + performance + schedule. No cost, no notes.

import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  Box, Typography, Skeleton, Chip, TextField,
  Switch, FormControlLabel, Button,
} from '@mui/material';
import { useTheme, alpha } from '@mui/material/styles';
import { ArrowLeft, Clock, Package, CheckCircle } from 'lucide-react';
import { useAppTheme } from '../../hooks/useAppTheme';
import { useAuth } from 'contexts/AuthContext';
import { useEntitlements } from '../../contexts/EntitlementsContext';
import { useExchangeRates } from '../../hooks/useExchangeRates';
import { formatCurrencyCompact } from '@lasyncro/shared/ui';
import {
  useMemberDetail,
  usePatchMemberDetail,
  useMemberSchedule,
  usePutMemberSchedule,
  type MemberRole,
} from '../members/useMembers';

// ─── HELPERS ──────────────────────────────────────────────────

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function fmtName(first: string | null, last: string | null): string {
  return [first, last].filter(Boolean).join(' ') || '—';
}

function fmtDuration(seconds: number | null): string {
  if (seconds == null) return '—';
  const m = Math.round(seconds / 60);
  if (m < 60) return `${m}m`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

const ROLE_COLORS: Record<MemberRole, 'default' | 'primary' | 'secondary'> = {
  owner: 'primary',
  admin: 'secondary',
  operator: 'default',
};

// ─── SUB-COMPONENTS ───────────────────────────────────────────

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <Typography sx={{
      fontSize: 11, fontWeight: 700, color: 'var(--ink-3)',
      textTransform: 'uppercase', letterSpacing: '0.08em', mb: 1.25,
    }}>
      {children}
    </Typography>
  );
}

function DetailCard({ children, sx = {} }: { children: React.ReactNode; sx?: object }) {
  const pal = useAppTheme();
  return (
    <Box sx={{
      background: pal.surface,
      border: `0.5px solid ${pal.rule}`,
      borderRadius: '8px',
      p: 2,
      ...sx,
    }}>
      {children}
    </Box>
  );
}

function StatPill({ label, value, tone }: {
  label: string; value: string;
  tone?: 'positive' | 'negative' | 'warning' | 'neutral';
}) {
  const theme = useTheme();
  const color =
    tone === 'positive' ? theme.palette.success.main :
    tone === 'negative' ? theme.palette.error.main :
    tone === 'warning'  ? theme.palette.warning.main :
    'var(--ink)';
  return (
    <Box sx={{ flex: 1, minWidth: 0, p: 1.25, background: 'var(--bg-2)', borderRadius: '6px' }}>
      <Typography sx={{ fontSize: 10, fontWeight: 700, color: 'var(--ink-3)', textTransform: 'uppercase', letterSpacing: '0.06em', mb: 0.4 }}>
        {label}
      </Typography>
      <Typography sx={{ fontSize: 18, fontWeight: 700, color, fontVariantNumeric: 'tabular-nums', lineHeight: 1.2 }}>
        {value}
      </Typography>
    </Box>
  );
}

// ─── SCHEDULE GRID ────────────────────────────────────────────

interface ScheduleEntry { start_time: string; end_time: string; }
type DraftSchedule = Record<number, ScheduleEntry | null>;

function ScheduleGrid({
  userId,
  canWrite,
}: {
  userId: number;
  canWrite: boolean;
}) {
  const { data, isLoading } = useMemberSchedule(userId);
  const { mutate: putSchedule, isPending } = usePutMemberSchedule();

  const [draft, setDraft] = useState<DraftSchedule>({});
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    if (!data) return;
    const init: DraftSchedule = {};
    for (let d = 0; d <= 6; d++) {
      const row = data.schedule.find((r) => r.weekday === d);
      init[d] = row ? { start_time: row.start_time.slice(0, 5), end_time: row.end_time.slice(0, 5) } : null;
    }
    setDraft(init);
    setDirty(false);
  }, [data]);

  const toggle = (day: number) => {
    setDraft((prev) => ({
      ...prev,
      [day]: prev[day] ? null : { start_time: '09:00', end_time: '17:00' },
    }));
    setDirty(true);
  };

  const updateTime = (day: number, field: 'start_time' | 'end_time', val: string) => {
    setDraft((prev) => ({ ...prev, [day]: { ...prev[day]!, [field]: val } }));
    setDirty(true);
  };

  const save = () => {
    const schedule = Object.entries(draft)
      .filter(([, v]) => v !== null)
      .map(([k, v]) => ({ weekday: Number(k), start_time: v!.start_time, end_time: v!.end_time }));
    putSchedule({ userId, schedule }, { onSuccess: () => setDirty(false) });
  };

  if (isLoading) return <Skeleton height={120} sx={{ borderRadius: '6px' }} />;

  return (
    <Box>
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.75 }}>
        {WEEKDAYS.map((label, day) => {
          const entry = draft[day];
          const active = entry !== null;
          return (
            <Box key={day} sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
              <Box
                onClick={canWrite ? () => toggle(day) : undefined}
                sx={{
                  width: 36, textAlign: 'center',
                  fontSize: 11, fontWeight: 600,
                  color: active ? 'var(--accent)' : 'var(--ink-4)',
                  cursor: canWrite ? 'pointer' : 'default',
                  userSelect: 'none',
                  py: 0.25,
                  borderRadius: '4px',
                  bgcolor: active ? 'var(--accent-ghost)' : 'transparent',
                  border: `0.5px solid ${active ? 'var(--accent-border)' : 'transparent'}`,
                  transition: 'all 0.1s',
                }}
              >
                {label}
              </Box>
              {active ? (
                canWrite ? (
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
                    <TextField
                      type="time" size="small" value={entry!.start_time}
                      onChange={(e) => updateTime(day, 'start_time', e.target.value)}
                      inputProps={{ style: { fontSize: 12, padding: '3px 6px' } }}
                      sx={{ width: 110 }}
                    />
                    <Typography sx={{ fontSize: 11, color: 'var(--ink-3)' }}>to</Typography>
                    <TextField
                      type="time" size="small" value={entry!.end_time}
                      onChange={(e) => updateTime(day, 'end_time', e.target.value)}
                      inputProps={{ style: { fontSize: 12, padding: '3px 6px' } }}
                      sx={{ width: 110 }}
                    />
                  </Box>
                ) : (
                  <Typography sx={{ fontSize: 12, color: 'var(--ink)' }}>
                    {entry!.start_time} – {entry!.end_time}
                  </Typography>
                )
              ) : (
                <Typography sx={{ fontSize: 12, color: 'var(--ink-4)' }}>Off</Typography>
              )}
            </Box>
          );
        })}
      </Box>
      {canWrite && dirty && (
        <Box sx={{ mt: 1.5, display: 'flex', justifyContent: 'flex-end' }}>
          <Button
            size="small" variant="contained" onClick={save} disabled={isPending}
            sx={{ bgcolor: 'var(--accent)', '&:hover': { bgcolor: 'var(--accent)', opacity: 0.88 }, fontSize: 12 }}
          >
            {isPending ? 'Saving…' : 'Save schedule'}
          </Button>
        </Box>
      )}
    </Box>
  );
}

// ─── PAGE ─────────────────────────────────────────────────────

export default function MemberDetailPage() {
  const { userId: rawId } = useParams<{ userId: string }>();
  const userId = Number(rawId);
  const navigate = useNavigate();
  const pal = useAppTheme();
  const theme = useTheme();
  const { user } = useAuth();
  const { displayCurrency, locale } = useEntitlements();
  const { rates } = useExchangeRates();
  const fmt = (n: number | null) => formatCurrencyCompact(n, displayCurrency, locale, rates);

  const requesterRole = user?.role ?? 'operator';
  const isOwnerOrAdmin = requesterRole === 'owner' || requesterRole === 'admin';
  const isSelf = user?.id === userId;
  const canWrite = isOwnerOrAdmin && !isSelf;

  const { data, isLoading } = useMemberDetail(userId);
  const { mutate: patch, isPending: isPatching } = usePatchMemberDetail();

  const [hourlyCost, setHourlyCost] = useState<string>('');
  const [displayHidden, setDisplayHidden] = useState(false);
  const [notes, setNotes] = useState('');
  const [notesDirty, setNotesDirty] = useState(false);
  const [costDirty, setCostDirty] = useState(false);

  useEffect(() => {
    if (!data?.cost_and_shift) return;
    setHourlyCost(data.cost_and_shift.hourly_cost != null ? String(data.cost_and_shift.hourly_cost) : '');
    setDisplayHidden(data.cost_and_shift.display_hidden ?? false);
  }, [data?.cost_and_shift]);

  useEffect(() => {
    if (data?.notes != null) setNotes(data.notes ?? '');
  }, [data?.notes]);

  if (isLoading) {
    return (
      <Box sx={{ p: 3 }}>
        <Skeleton height={32} width={200} sx={{ mb: 2 }} />
        <Skeleton height={120} sx={{ borderRadius: '8px', mb: 2 }} />
        <Skeleton height={200} sx={{ borderRadius: '8px' }} />
      </Box>
    );
  }

  if (!data) {
    return (
      <Box sx={{ p: 3 }}>
        <Typography sx={{ fontSize: 14, color: 'var(--ink-3)' }}>Member not found.</Typography>
      </Box>
    );
  }

  const { identity, performance, recent_activity } = data;

  const uphTone = performance.uph_30d == null ? 'neutral'
    : performance.uph_30d >= 40 ? 'positive'
    : performance.uph_30d >= 25 ? 'warning' : 'negative';

  const accTone = performance.accuracy_30d_pct == null ? 'neutral'
    : performance.accuracy_30d_pct >= 95 ? 'positive'
    : performance.accuracy_30d_pct >= 85 ? 'warning' : 'negative';

  const saveCost = () => {
    const parsed = hourlyCost === '' ? null : parseFloat(hourlyCost);
    patch({ userId, hourly_cost: parsed, display_hidden: displayHidden }, {
      onSuccess: () => setCostDirty(false),
    });
  };

  const saveNotes = () => {
    patch({ userId, owner_notes: notes || null }, {
      onSuccess: () => setNotesDirty(false),
    });
  };

  return (
    <Box sx={{ bgcolor: 'var(--bg)', minHeight: '100%', p: 2.5 }}>

      {/* BACK */}
      <Box
        onClick={() => navigate('/team')}
        sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.5, mb: 2, cursor: 'pointer', color: 'var(--ink-3)', '&:hover': { color: 'var(--ink)' }, transition: 'color 0.1s' }}
      >
        <ArrowLeft size={14} />
        <Typography sx={{ fontSize: 12, fontWeight: 500 }}>Team</Typography>
      </Box>

      {/* IDENTITY HEADER */}
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 2.5 }}>
        <Box sx={{
          width: 48, height: 48, borderRadius: '50%', flexShrink: 0,
          bgcolor: alpha(theme.palette.primary.main, 0.15),
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <Typography sx={{ fontSize: 18, fontWeight: 700, color: theme.palette.primary.main }}>
            {(identity.first_name?.[0] ?? identity.email[0]).toUpperCase()}
          </Typography>
        </Box>
        <Box>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <Typography sx={{ fontSize: 20, fontWeight: 600, color: 'var(--ink)', lineHeight: 1.2 }}>
              {fmtName(identity.first_name, identity.last_name)}
            </Typography>
            <Chip label={identity.role} size="small" color={ROLE_COLORS[identity.role]} variant="outlined" />
          </Box>
          <Typography sx={{ fontSize: 12, color: 'var(--ink-3)', mt: '2px' }}>
            {identity.email} · Member since {fmtDate(identity.member_since)}
          </Typography>
        </Box>
      </Box>

      {/* TWO-COLUMN LAYOUT */}
      <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 2, alignItems: 'start' }}>

        {/* LEFT — Performance + Recent Activity */}
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>

          {/* PERFORMANCE */}
          <DetailCard>
            <SectionLabel>30-day Performance</SectionLabel>
            <Box sx={{ display: 'flex', gap: 1, mb: 1.5 }}>
              <StatPill
                label="UPH"
                value={performance.uph_30d != null ? String(performance.uph_30d) : '—'}
                tone={uphTone}
              />
              <StatPill
                label="Accuracy"
                value={performance.accuracy_30d_pct != null ? `${performance.accuracy_30d_pct}%` : '—'}
                tone={accTone}
              />
              <StatPill
                label="Exceptions"
                value={String(performance.exception_count_30d)}
                tone={performance.exception_count_30d === 0 ? 'positive' : performance.exception_count_30d < 5 ? 'warning' : 'negative'}
              />
            </Box>
            {Object.keys(performance.scan_source_mix).length > 0 && (
              <Box>
                <Typography sx={{ fontSize: 10, fontWeight: 700, color: 'var(--ink-3)', textTransform: 'uppercase', letterSpacing: '0.06em', mb: 0.75 }}>
                  Scan source mix
                </Typography>
                <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
                  {Object.entries(performance.scan_source_mix).map(([src, count]) => (
                    <Box key={src} sx={{
                      px: 1, py: 0.25, borderRadius: '4px',
                      bgcolor: 'var(--bg-2)', border: `0.5px solid ${pal.rule}`,
                    }}>
                      <Typography sx={{ fontSize: 11, color: 'var(--ink)' }}>
                        {src} <Typography component="span" sx={{ fontWeight: 700 }}>{count}</Typography>
                      </Typography>
                    </Box>
                  ))}
                </Box>
              </Box>
            )}
          </DetailCard>

          {/* RECENT ACTIVITY */}
          <DetailCard>
            <SectionLabel>Recent Batches</SectionLabel>
            {recent_activity.length === 0 ? (
              <Typography sx={{ fontSize: 12, color: 'var(--ink-3)' }}>No batch activity yet.</Typography>
            ) : (
              <Box>
                <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 0.6fr 0.6fr 0.6fr', mb: 0.5 }}>
                  {['Date', 'Units', 'Duration', 'Exceptions'].map(h => (
                    <Typography key={h} sx={{ fontSize: 10, fontWeight: 600, color: 'var(--ink-3)', textTransform: 'uppercase' }}>
                      {h}
                    </Typography>
                  ))}
                </Box>
                {recent_activity.map((b) => (
                  <Box
                    key={b.pick_batch_id}
                    sx={{
                      display: 'grid', gridTemplateColumns: '1fr 0.6fr 0.6fr 0.6fr',
                      py: 0.6, borderBottom: `0.5px solid ${pal.rule}`,
                      '&:last-child': { borderBottom: 'none' },
                    }}
                  >
                    <Typography sx={{ fontSize: 12, color: 'var(--ink)' }}>
                      {fmtDate(b.pick_claimed_at)}
                    </Typography>
                    <Typography sx={{ fontSize: 12, color: 'var(--ink)', fontVariantNumeric: 'tabular-nums' }}>
                      {b.units_picked}/{b.total_units}
                    </Typography>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.4 }}>
                      <Clock size={10} color="var(--ink-3)" />
                      <Typography sx={{ fontSize: 12, color: 'var(--ink-3)', fontVariantNumeric: 'tabular-nums' }}>
                        {fmtDuration(b.duration_seconds)}
                      </Typography>
                    </Box>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.4 }}>
                      {b.exception_count === 0
                        ? <CheckCircle size={11} color={theme.palette.success.main} />
                        : <Package size={11} color={theme.palette.warning.main} />
                      }
                      <Typography sx={{ fontSize: 12, color: b.exception_count > 0 ? theme.palette.warning.main : 'var(--ink-3)' }}>
                        {b.exception_count}
                      </Typography>
                    </Box>
                  </Box>
                ))}
              </Box>
            )}
          </DetailCard>
        </Box>

        {/* RIGHT — Cost & Shift + Schedule + Notes */}
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>

          {/* COST & SHIFT — owner/admin only */}
          {isOwnerOrAdmin && data.cost_and_shift !== undefined && (
            <DetailCard>
              <SectionLabel>Cost & Shift</SectionLabel>
              <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
                <Box>
                  <Typography sx={{ fontSize: 11, color: 'var(--ink-3)', mb: 0.5 }}>
                    Hourly cost ({displayCurrency})
                  </Typography>
                  <TextField
                    type="number"
                    size="small"
                    value={hourlyCost}
                    placeholder="e.g. 14.50"
                    disabled={!canWrite}
                    onChange={(e) => { setHourlyCost(e.target.value); setCostDirty(true); }}
                    inputProps={{ min: 0, step: 0.01, style: { fontSize: 13 } }}
                    sx={{ width: 160 }}
                  />
                  <Typography sx={{ fontSize: 10, color: 'var(--ink-4)', mt: 0.4 }}>
                    Used for cost-per-order in Warehouse Analytics. Never shown to the operator.
                  </Typography>
                </Box>
                {canWrite && (
                  <FormControlLabel
                    control={
                      <Switch
                        size="small"
                        checked={displayHidden}
                        onChange={(e) => { setDisplayHidden(e.target.checked); setCostDirty(true); }}
                      />
                    }
                    label={
                      <Typography sx={{ fontSize: 12, color: 'var(--ink)' }}>
                        Hide from Floor Display
                      </Typography>
                    }
                  />
                )}
                {canWrite && costDirty && (
                  <Box sx={{ display: 'flex', justifyContent: 'flex-end' }}>
                    <Button
                      size="small" variant="contained" onClick={saveCost} disabled={isPatching}
                      sx={{ bgcolor: 'var(--accent)', '&:hover': { bgcolor: 'var(--accent)', opacity: 0.88 }, fontSize: 12 }}
                    >
                      {isPatching ? 'Saving…' : 'Save'}
                    </Button>
                  </Box>
                )}
              </Box>
            </DetailCard>
          )}

          {/* SCHEDULE */}
          <DetailCard>
            <SectionLabel>Weekly Schedule</SectionLabel>
            <Typography sx={{ fontSize: 11, color: 'var(--ink-3)', mb: 1.25 }}>
              {canWrite ? 'Click a day to toggle. Times are in shop timezone.' : 'Your schedule this week.'}
            </Typography>
            <ScheduleGrid userId={userId} canWrite={canWrite} />
          </DetailCard>

          {/* NOTES — owner/admin only, never shown to operator */}
          {isOwnerOrAdmin && (
            <DetailCard>
              <SectionLabel>Owner Notes</SectionLabel>
              <Typography sx={{ fontSize: 11, color: 'var(--ink-3)', mb: 1 }}>
                Private — never visible to the operator.
              </Typography>
              <TextField
                multiline minRows={3} maxRows={6} fullWidth size="small"
                placeholder="Performance notes, context, reminders…"
                value={notes}
                disabled={!canWrite}
                onChange={(e) => { setNotes(e.target.value); setNotesDirty(true); }}
                inputProps={{ style: { fontSize: 13 } }}
              />
              {canWrite && notesDirty && (
                <Box sx={{ display: 'flex', justifyContent: 'flex-end', mt: 1 }}>
                  <Button
                    size="small" variant="contained" onClick={saveNotes} disabled={isPatching}
                    sx={{ bgcolor: 'var(--accent)', '&:hover': { bgcolor: 'var(--accent)', opacity: 0.88 }, fontSize: 12 }}
                  >
                    {isPatching ? 'Saving…' : 'Save notes'}
                  </Button>
                </Box>
              )}
            </DetailCard>
          )}
        </Box>
      </Box>
    </Box>
  );
}