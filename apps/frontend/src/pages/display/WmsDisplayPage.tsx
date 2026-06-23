// apps/frontend/src/pages/display/WmsDisplayPage.tsx
//
// FLOOR DISPLAY — /wms/analytics/display?token=…
// -----------------------------------------------
// TV-optimised, no auth, token-bound, read-only.
// 4-slot rotation × 20s = 80s full cycle.
// Capacity strip pinned across all slots.
//
// Slot 1 — Team Performance (UPH · Required · Standard · progress · CPT)
// Slot 2 — Pipeline Velocity (stage bars + latency)
// Slot 3 — Exception Top-5 (SKU only, no operator names)
// Slot 4 — 3D Warehouse Map (IsometricCanvas, 4-angle orbit × 10s)
//
// INVARIANTS:
// - No operator names anywhere on display
// - No interaction handlers
// - No cursor
// - Rotation does not pause

import { useEffect, useState, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Box, Typography } from '@mui/material';
import { useTheme } from '@mui/material/styles';
import { useQuery } from '@tanstack/react-query';
import axios from 'axios';
import { Clock, AlertTriangle } from 'lucide-react';
import { IsometricCanvas } from '@lasyncro/shared/ui';
import type { WarehouseZone } from '@lasyncro/shared/ui';

const displayAxios = axios.create({ baseURL: '' });

// ─── TYPES ────────────────────────────────────────────────────

type DisplayData = {
  live: {
    pipeline: { awaiting_pick: number; picking: number; packing: number; ship_ready: number; shipped: number };
    operators_on_shift: number;
    cpt_local: string | null;
    hours_to_cpt: number | null;
    live_uph: number | null;
    required_uph: number | null;
    standard_uph: number | null;
    on_track: 'green' | 'amber' | 'red' | null;
    shipped_today: number;
    shipped_via_wms: number;
    shipped_via_legacy: number;
    unfulfilled_orders: number;
  };
  pipeline: {
    stages: {
      released_to_picking_s: number | null;
      picking_s: number | null;
      packing_s: number | null;
      packed_to_shipped_s: number | null;
    };
    latencies: {
      receive_to_pickable_hours: number | null;
      return_to_restock_hours: number | null;
    };
  };
  exceptions: {
    top_skus: { lasyncro_variant_id: string; title: string | null; sku: string | null; exception_count: number }[];
  };
  zones: WarehouseZone[];
};

// ─── HOOKS ────────────────────────────────────────────────────
function useDisplayData(token: string) {
  return useQuery<DisplayData>({
    queryKey: ['wms', 'display', token],
    queryFn: async () => {
      const { data } = await displayAxios.get(`/api/v1/wms/analytics/display?token=${encodeURIComponent(token)}`);
      return data;
    },
    refetchInterval: 60_000,
    enabled: token.length > 0,
    retry: false,
  });
}

// ─── HELPERS ──────────────────────────────────────────────────

function fmtSeconds(s: number | null): string {
  if (s == null) return '—';
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}

function fmtHours(h: number | null): string {
  if (h == null) return '—';
  if (h < 1) return `${Math.round(h * 60)}m`;
  return `${h.toFixed(1)}h`;
}

function fmtCpt(cptLocal: string | null, hoursToCpt: number | null): string {
  if (!cptLocal) return '';
  const label = cptLocal.slice(0, 5);
  if (hoursToCpt == null || hoursToCpt <= 0) return `${label} (passed)`;
  const h = Math.floor(hoursToCpt);
  const m = Math.round((hoursToCpt - h) * 60);
  return h > 0 ? `${h}h ${m}m to ${label}` : `${m}m to ${label}`;
}

// ─── SHARED DISPLAY COMPONENTS ────────────────────────────────

function SlotLabel({ children }: { children: React.ReactNode }) {
  return (
    <Typography sx={{ fontSize: 13, fontWeight: 700, color: 'rgba(255,255,255,0.4)', textTransform: 'uppercase', letterSpacing: '0.12em', mb: 3 }}>
      {children}
    </Typography>
  );
}

function BigStat({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
      <Typography sx={{ fontSize: 72, fontWeight: 800, color: color ?? 'white', fontVariantNumeric: 'tabular-nums', lineHeight: 1 }}>
        {value}
      </Typography>
      <Typography sx={{ fontSize: 16, color: 'rgba(255,255,255,0.5)', mt: 1, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
        {label}
      </Typography>
    </Box>
  );
}

// ─── CAPACITY STRIP (pinned across all slots) ─────────────────

function CapacityStrip({ live }: { live: DisplayData['live'] | undefined }) {
  const theme = useTheme();
  const onTrackColor =
    live?.on_track === 'green' ? theme.palette.success.main :
    live?.on_track === 'amber' ? theme.palette.warning.main :
    live?.on_track === 'red' ? theme.palette.error.main :
    'rgba(255,255,255,0.3)';

  return (
    <Box sx={{
      display: 'flex', alignItems: 'center', gap: 4,
      px: 6, py: 2.5,
      borderBottom: '1px solid rgba(255,255,255,0.08)',
      flexShrink: 0,
    }}>
      {/* PIPELINE */}
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
        {[
          { label: 'Awaiting', val: live?.pipeline.awaiting_pick ?? 0 },
          { label: 'Picking', val: live?.pipeline.picking ?? 0 },
          { label: 'Packing', val: live?.pipeline.packing ?? 0 },
          { label: 'Ship-ready', val: live?.pipeline.ship_ready ?? 0 },
          { label: 'Shipped', val: live?.shipped_today ?? 0, accent: true },
        ].map((s, i) => (
          <Box key={s.label} sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
            {i > 0 && <Typography sx={{ color: 'rgba(255,255,255,0.2)', fontSize: 20 }}>→</Typography>}
            <Box sx={{ textAlign: 'center' }}>
              <Typography sx={{ fontSize: 28, fontWeight: 700, color: s.accent ? theme.palette.success.main : 'white', fontVariantNumeric: 'tabular-nums', lineHeight: 1 }}>
                {s.val}
              </Typography>
              <Typography sx={{ fontSize: 11, color: 'rgba(255,255,255,0.4)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                {s.label}
              </Typography>
            </Box>
          </Box>
        ))}
      </Box>

      <Box sx={{ ml: 'auto', display: 'flex', alignItems: 'center', gap: 4 }}>
        {/* OPERATORS */}
        <Box sx={{ textAlign: 'center' }}>
          <Typography sx={{ fontSize: 28, fontWeight: 700, color: 'white', lineHeight: 1 }}>
            {live?.operators_on_shift ?? 0}
          </Typography>
          <Typography sx={{ fontSize: 11, color: 'rgba(255,255,255,0.4)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
            On shift
          </Typography>
        </Box>

        {/* CPT */}
        {live?.cpt_local && (
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <Clock size={16} color="rgba(255,255,255,0.4)" />
            <Typography sx={{ fontSize: 16, fontWeight: 600, color: live?.on_track === 'red' ? theme.palette.error.main : 'rgba(255,255,255,0.7)' }}>
              {fmtCpt(live.cpt_local, live.hours_to_cpt)}
            </Typography>
          </Box>
        )}

        {/* ON-TRACK SIGNAL */}
        {live?.on_track && (
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, px: 2, py: 0.75, borderRadius: '20px', bgcolor: `${onTrackColor}20`, border: `1px solid ${onTrackColor}50` }}>
            <Box sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: onTrackColor }} />
            <Typography sx={{ fontSize: 14, fontWeight: 700, color: onTrackColor }}>
              {live.on_track === 'green' ? 'On track' : live.on_track === 'amber' ? 'At risk' : 'Behind'}
            </Typography>
          </Box>
        )}
      </Box>
    </Box>
  );
}

// ─── SLOT 1 — TEAM PERFORMANCE ────────────────────────────────

function Slot1TeamPerformance({ live }: { live: DisplayData['live'] | undefined }) {
  const theme = useTheme();
  const uphColor =
    live?.on_track === 'green' ? theme.palette.success.main :
    live?.on_track === 'amber' ? theme.palette.warning.main :
    live?.on_track === 'red' ? theme.palette.error.main :
    'white';

  const total = (live?.unfulfilled_orders ?? 0) + (live?.shipped_today ?? 0);
  const shipped = live?.shipped_today ?? 0;
  const pct = total > 0 ? Math.round((shipped / total) * 100) : 0;

  return (
    <Box sx={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
      <SlotLabel>Team Performance</SlotLabel>

      {/* UPH TRIO */}
      <Box sx={{ display: 'flex', gap: 10, alignItems: 'flex-end' }}>
        <BigStat label={live?.live_uph != null ? 'Live UPH' : 'UPH · 30d'} value={live?.live_uph != null ? String(live.live_uph) : (live?.standard_uph != null ? String(live.standard_uph) : '—')} color={uphColor} />
        <BigStat label="Required" value={live?.required_uph != null ? String(live.required_uph) : '—'} color="rgba(255,255,255,0.5)" />
        <BigStat label="30d Baseline" value={live?.standard_uph != null ? String(live.standard_uph) : '—'} color="rgba(255,255,255,0.3)" />
      </Box>

      {/* PROGRESS BAR */}
      <Box sx={{ width: '60%', maxWidth: 600 }}>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 1 }}>
          <Typography sx={{ fontSize: 14, color: 'rgba(255,255,255,0.5)' }}>Orders shipped today</Typography>
          <Typography sx={{ fontSize: 14, fontWeight: 700, color: 'white' }}>{shipped} of {total}</Typography>
        </Box>
        <Box sx={{ height: 12, borderRadius: 6, bgcolor: 'rgba(255,255,255,0.1)', overflow: 'hidden' }}>
          <Box sx={{ height: '100%', width: `${pct}%`, borderRadius: 6, bgcolor: theme.palette.success.main, transition: 'width 1s ease' }} />
        </Box>
      </Box>
    </Box>
  );
}

// ─── SLOT 2 — PIPELINE VELOCITY ───────────────────────────────

function Slot2PipelineVelocity({ pipeline }: { pipeline: DisplayData['pipeline'] | undefined }) {
  const theme = useTheme();
  const stages = [
    { label: 'Released → Picking', s: pipeline?.stages.released_to_picking_s ?? null, color: theme.palette.info.main },
    { label: 'Picking', s: pipeline?.stages.picking_s ?? null, color: theme.palette.success.main },
    { label: 'Packing', s: pipeline?.stages.packing_s ?? null, color: theme.palette.warning.main },
    { label: 'Ship', s: pipeline?.stages.packed_to_shipped_s ?? null, color: theme.palette.error.light },
  ];
  const totalS = stages.reduce((a, s) => a + (s.s ?? 0), 0);

  return (
    <Box sx={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 5, px: 10 }}>
      <SlotLabel>Pipeline Velocity</SlotLabel>

      {/* STACKED BAR */}
      {totalS > 0 ? (
        <Box sx={{ width: '100%', height: 24, borderRadius: '8px', overflow: 'hidden', display: 'flex' }}>
          {stages.map(st => st.s && st.s > 0 && (
            <Box key={st.label} sx={{ flex: st.s, bgcolor: st.color, minWidth: 4 }} title={`${st.label}: ${fmtSeconds(st.s)}`} />
          ))}
        </Box>
      ) : (
        <Box sx={{ width: '100%', height: 24, borderRadius: '8px', bgcolor: 'rgba(255,255,255,0.1)' }} />
      )}

      {/* STAGE LEGEND */}
      <Box sx={{ display: 'flex', gap: 6, flexWrap: 'wrap', justifyContent: 'center' }}>
        {stages.map(st => (
          <Box key={st.label} sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
            <Box sx={{ width: 14, height: 14, borderRadius: '3px', bgcolor: st.color, flexShrink: 0 }} />
            <Typography sx={{ fontSize: 18, color: 'rgba(255,255,255,0.6)' }}>{st.label}</Typography>
            <Typography sx={{ fontSize: 22, fontWeight: 700, color: 'white', fontVariantNumeric: 'tabular-nums' }}>
              {fmtSeconds(st.s)}
            </Typography>
          </Box>
        ))}
      </Box>

      {/* LATENCIES */}
      <Box sx={{ display: 'flex', gap: 8 }}>
        {[
          { label: 'Receive → Pickable', val: fmtHours(pipeline?.latencies.receive_to_pickable_hours ?? null) },
          { label: 'Return → Restocked', val: fmtHours(pipeline?.latencies.return_to_restock_hours ?? null) },
        ].map(l => (
          <Box key={l.label} sx={{ textAlign: 'center', px: 4, py: 2, borderRadius: '12px', bgcolor: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.08)' }}>
            <Typography sx={{ fontSize: 36, fontWeight: 800, color: 'white', fontVariantNumeric: 'tabular-nums' }}>{l.val}</Typography>
            <Typography sx={{ fontSize: 13, color: 'rgba(255,255,255,0.4)', textTransform: 'uppercase', letterSpacing: '0.06em', mt: 0.5 }}>{l.label}</Typography>
          </Box>
        ))}
      </Box>
    </Box>
  );
}

// ─── SLOT 3 — EXCEPTION TOP-5 ─────────────────────────────────

function Slot3ExceptionTopFive({ exceptions }: { exceptions: DisplayData['exceptions'] | undefined }) {
  const theme = useTheme();
  const topSkus = exceptions?.top_skus ?? [];

  return (
    <Box sx={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 4, px: 16 }}>
      <SlotLabel>Exception Hotspots</SlotLabel>

      {topSkus.length === 0 ? (
        <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
          <Typography sx={{ fontSize: 64 }}>✓</Typography>
          <Typography sx={{ fontSize: 28, color: theme.palette.success.main, fontWeight: 700 }}>No exceptions this period</Typography>
        </Box>
      ) : (
        <Box sx={{ width: '100%', maxWidth: 700, display: 'flex', flexDirection: 'column', gap: 2 }}>
          {topSkus.slice(0, 5).map((sku, i) => (
            <Box key={sku.lasyncro_variant_id} sx={{
              display: 'flex', alignItems: 'center', gap: 3,
              px: 3, py: 2, borderRadius: '12px',
              bgcolor: i === 0 ? 'rgba(239,68,68,0.12)' : 'rgba(255,255,255,0.04)',
              border: `1px solid ${i === 0 ? 'rgba(239,68,68,0.3)' : 'rgba(255,255,255,0.06)'}`,
            }}>
              <Typography sx={{ fontSize: 24, fontWeight: 800, color: 'rgba(255,255,255,0.3)', width: 32, flexShrink: 0, fontVariantNumeric: 'tabular-nums' }}>
                {i + 1}
              </Typography>
              <Box sx={{ flex: 1, minWidth: 0 }}>
                <Typography sx={{ fontSize: 22, fontWeight: 600, color: 'white', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {sku.title ?? '—'}
                </Typography>
                {sku.sku && (
                  <Typography sx={{ fontSize: 14, color: 'rgba(255,255,255,0.4)', fontFamily: 'monospace' }}>
                    {sku.sku}
                  </Typography>
                )}
              </Box>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, flexShrink: 0 }}>
                <AlertTriangle size={18} color={i === 0 ? theme.palette.error.main : theme.palette.warning.main} />
                <Typography sx={{ fontSize: 28, fontWeight: 800, color: i === 0 ? theme.palette.error.main : theme.palette.warning.main, fontVariantNumeric: 'tabular-nums' }}>
                  {sku.exception_count}
                </Typography>
              </Box>
            </Box>
          ))}
        </Box>
      )}
    </Box>
  );
}

// ─── SLOT 4 — 3D WAREHOUSE MAP ────────────────────────────────

const ORBIT_OFFSETS = [
  { x: 420, y: 120 },
  { x: 120, y: 120 },
  { x: 120, y: 420 },
  { x: 420, y: 420 },
];

function Slot4WarehouseMap({ zones }: { zones: WarehouseZone[] }) {
  const [orbitIdx, setOrbitIdx] = useState(0);
  const orbitRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    orbitRef.current = setInterval(() => {
      setOrbitIdx(prev => (prev + 1) % ORBIT_OFFSETS.length);
    }, 10_000);
    return () => { if (orbitRef.current) clearInterval(orbitRef.current); };
  }, []);

  if (zones.length === 0) {
    return (
      <Box sx={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 2 }}>
        <Typography sx={{ fontSize: 24, color: 'rgba(255,255,255,0.3)' }}>No warehouse configured</Typography>
      </Box>
    );
  }

  return (
    <Box sx={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <Box sx={{ px: 6, pt: 3, flexShrink: 0 }}>
        <SlotLabel>Warehouse Map</SlotLabel>
      </Box>
      <Box sx={{
        flex: 1, overflow: 'hidden',
        transition: 'opacity 0.8s ease',
      }}>
        <IsometricCanvas
          zones={zones}
          initialZoom={0.7}
          initialOffset={ORBIT_OFFSETS[orbitIdx]}
          showFloor
          showBins
        />
      </Box>
    </Box>
  );
}

// ─── ROTATION ENGINE ──────────────────────────────────────────

const SLOT_DURATION = 20_000;
const TOTAL_SLOTS = 4;

// ─── PAGE ─────────────────────────────────────────────────────

export default function WmsDisplayPage() {
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token') ?? '';
  const theme = useTheme();

  const { data, isError } = useDisplayData(token);
  const zones: WarehouseZone[] = data?.zones ?? [];

  // Slot rotation
  const [slot, setSlot] = useState(0);
  const slotRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    slotRef.current = setInterval(() => {
      setSlot(prev => (prev + 1) % TOTAL_SLOTS);
    }, SLOT_DURATION);
    return () => { if (slotRef.current) clearInterval(slotRef.current); };
  }, []);

  // Heartbeat every 5 min
  useEffect(() => {
    if (!token) return;
    const hb = setInterval(async () => {
      try {
        await displayAxios.post(`/api/v1/wms/analytics/display/heartbeat?token=${encodeURIComponent(token)}`);
      } catch (err) {
        console.warn('[WmsDisplay] heartbeat failed (non-fatal)', err);
      }
    }, 5 * 60_000);
    return () => clearInterval(hb);
  }, [token]);

  // Slot indicator dots
  const SlotDots = () => (
    <Box sx={{ display: 'flex', gap: 0.75, position: 'absolute', bottom: 20, left: '50%', transform: 'translateX(-50%)' }}>
      {Array.from({ length: TOTAL_SLOTS }).map((_, i) => (
        <Box key={i} sx={{ width: i === slot ? 20 : 6, height: 6, borderRadius: 3, bgcolor: i === slot ? 'white' : 'rgba(255,255,255,0.2)', transition: 'all 0.3s ease' }} />
      ))}
    </Box>
  );

  if (!token) {
    return (
      <Box sx={{ width: '100vw', height: '100vh', bgcolor: '#0a0a0f', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <Typography sx={{ fontSize: 24, color: 'rgba(255,255,255,0.3)' }}>No display token provided.</Typography>
      </Box>
    );
  }

  if (isError) {
    return (
      <Box sx={{ width: '100vw', height: '100vh', bgcolor: '#0a0a0f', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <Typography sx={{ fontSize: 24, color: theme.palette.error.main }}>Invalid or expired display token.</Typography>
      </Box>
    );
  }

  return (
    <Box sx={{
      width: '100vw', height: '100vh',
      bgcolor: '#0a0f1e',
      display: 'flex', flexDirection: 'column',
      overflow: 'hidden',
      cursor: 'none',
      userSelect: 'none',
    }}>
      {/* CAPACITY STRIP — pinned */}
      <CapacityStrip live={data?.live} />

      {/* SLOT CONTENT */}
      <Box sx={{ flex: 1, display: 'flex', flexDirection: 'column', position: 'relative', overflow: 'hidden' }}>
        <Box sx={{ flex: 1, display: slot === 0 ? 'flex' : 'none', flexDirection: 'column' }}>
          <Slot1TeamPerformance live={data?.live} />
        </Box>
        <Box sx={{ flex: 1, display: slot === 1 ? 'flex' : 'none', flexDirection: 'column' }}>
          <Slot2PipelineVelocity pipeline={data?.pipeline} />
        </Box>
        <Box sx={{ flex: 1, display: slot === 2 ? 'flex' : 'none', flexDirection: 'column' }}>
          <Slot3ExceptionTopFive exceptions={data?.exceptions} />
        </Box>
        <Box sx={{ flex: 1, display: slot === 3 ? 'flex' : 'none', flexDirection: 'column' }}>
          <Slot4WarehouseMap zones={zones} />
        </Box>

        <SlotDots />
      </Box>
    </Box>
  );
}