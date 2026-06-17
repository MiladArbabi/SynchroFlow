/* eslint-disable @typescript-eslint/no-unused-vars */
// apps/frontend/src/activation/SyncAnimationPage.tsx
//
// PURPOSE: FT0 sync animation — shown immediately after Shopify OAuth succeeds.
// DESIGN:  Implements "LaSyncro OAuth Building.dc.html" (Claude Design handoff).
//          Two-column layout: left = fulfillment narrative checklist + progress,
//          right = 3D isometric warehouse "fulfillment film" with a glowing
//          canvas pulse-trail that auto-advances IN SYNC with the real backend steps.
//
// DATA:    Real progress stays authoritative. useSyncStatus polls the backend,
//          useSyncStepMachine paces the 5 visible steps (≥ per-step min durations,
//          sequential, never simultaneous). The right-panel film is gated by the
//          real activeStepIndex so it can never run ahead of actual sync progress.
//
// STEP SEQUENCE (left checklist — all 5 always visible, unreached ones dimmed):
//   0 — Connecting to Shopify
//   1 — Building inventory truth   (N of M products — live count)
//   2 — Creating orders triage     (blocked → resolved substatus)
//   3 — Releasing clean batches
//   4 — Packing, labelling, shipping
//
// FONTS: Instrument Serif (display) + DM Sans (body) — loaded by the landing/app
//        shell. Fallbacks are declared inline so this renders even if absent.

import React, { useEffect, useRef } from 'react';
import { Box, Typography, Stack } from '@mui/material';
import { useColorScheme } from '@mui/material/styles';
import { CheckCircle, Zap, Circle } from 'lucide-react';
import { ThemeMode } from 'config';
import { useSyncStatus } from './hooks/useSyncStatus';
import { useSyncStepMachine } from './hooks/useSyncStepMachine';

// ─── Brand tokens (from LaSyncro design system) ────────────────────────────────

const ACCENT       = '#FF6B2B';
const ACCENT_HOVER = '#FF8C5A';
const OK_GREEN     = '#4CAF7A';   // design "done" green (--ok)
const AZURE        = '#1FA8FF';   // pulse / azure beam
const AZURE_LITE   = '#78CDFF';   // inner glow
const INK          = '#F0EEE8';
const INK_SOFT     = '#B9BDC7';
const INK_MUTED    = '#8B8F9A';

const FONT_SERIF = "'Instrument Serif', Georgia, serif";
const FONT_SANS  = "'DM Sans', system-ui, sans-serif";

// ─── Theme palette (dark-first to match the design; light fallback retained) ────

function useSyncTheme() {
  const { colorScheme } = useColorScheme();
  const isDark = colorScheme !== ThemeMode.LIGHT; // OAuth sync screen is dark-first
  return {
    isDark,
    // Radial-gradient backdrop matches the .dc.html (#131C29 core → #0B111C edge)
    pageBg: isDark
      ? 'radial-gradient(ellipse 90% 70% at 64% 40%, #131C29 0%, #0B111C 72%)'
      : '#FAFAF8',
    border:      isDark ? 'rgba(255,255,255,0.07)' : 'rgba(0,0,0,0.08)',
    barTrack:    isDark ? 'rgba(255,255,255,0.09)' : 'rgba(0,0,0,0.10)',
    textPrimary: isDark ? INK : '#0F0E0D',
    textSecond:  isDark ? INK_SOFT : '#3A3835',
    textMuted:   isDark ? INK_MUTED : '#6B7280',
    textHint:    isDark ? 'rgba(240,238,232,0.5)' : '#9CA3AF',
    stageBorder: isDark ? 'rgba(255,255,255,0.07)' : 'rgba(0,0,0,0.08)',
    stageBg:     isDark ? 'rgba(255,255,255,0.012)' : 'rgba(0,0,0,0.012)',
  };
}

// ─── Step definitions (fulfillment narrative — matches design copy) ─────────────

const TOTAL_STEPS = 5;

interface StepDef {
  label:  string;
  detail: string;
}

const STEPS: StepDef[] = [
  {
    label: 'Connecting to Shopify',
    detail: 'Products, variants, orders, and inventory start flowing into LaSyncro.',
  },
  {
    label: 'Building inventory truth',
    detail: 'SKUs become warehouse-ready for receive, barcode, stow, pick, pack, and ship.',
  },
  {
    label: 'Creating orders triage',
    detail: 'Customer, inventory, and operational blocks clear first, then ready orders prepare for batch release.',
  },
  {
    label: 'Releasing clean batches',
    detail: 'Ready orders release in clean batches, and pickers route the shortest path through the shelves.',
  },
  {
    label: 'Packing, labelling, shipping',
    detail: 'Picked batches are parcelled, ship-labelled, and staged at the outbound dock — synced end to end.',
  },
];

// ════════════════════════════════════════════════════════════════════════════
//  WarehouseFilm — 3D isometric fulfillment film (right panel)
//  Ported from the design's pulse engine. The canvas pulse-trail + zone lighting
//  + beat chips + caption advance through 7 "beats" gated by the real UI step.
// ════════════════════════════════════════════════════════════════════════════

// Plane waypoints in the 1100×700 floor-plane coordinate space.
const P = {
  src:    [-20, 150] as [number, number],
  blocked:[188, 200] as [number, number],
  pool:   [188, 510] as [number, number],
  batches:[472, 186] as [number, number],
  packA:  [940, 196] as [number, number],
  out:    [940, 500] as [number, number],
  exit:   [1095, 640] as [number, number],
};
const PICK: [number, number][] = [
  [472, 186], [420, 378], [760, 378], [760, 440], [420, 440], [420, 502], [760, 502],
];
const OVERVIEW: [number, number][] = [
  P.blocked, P.pool, P.batches, ...PICK,
  [820, 520], P.packA, [940, 360], P.out, P.exit,
];

interface Beat {
  z:    string[];               // zones lit during this beat
  path: [number, number][];     // pulse waypoints
  num:  string;                 // caption "01".."07"
  name: string;                 // caption label
  step: number;                 // which left-checklist step (1..5) this belongs to
  // precomputed:
  seg?: number[];
  len?: number;
}

const BEATS: Beat[] = [
  { z: ['blocked'],                       path: [P.src, [80, 150], P.blocked],                              num: '01', name: 'Orders arriving',          step: 1 },
  { z: ['shelves'],                       path: [[420, 378], [760, 378], [760, 440], [500, 440]],           num: '02', name: 'Inventory truth',          step: 2 },
  { z: ['blocked'],                       path: [[110, 138], [270, 138], [110, 208], [270, 208], [110, 278]], num: '03', name: 'Blocked orders surface', step: 3 },
  { z: ['blocked', 'pool'],               path: [P.blocked, [150, 360], P.pool],                            num: '04', name: 'Blocks resolved',          step: 3 },
  { z: ['pool', 'batches'],               path: [P.pool, [330, 300], P.batches],                            num: '05', name: 'Clean batch release',      step: 4 },
  { z: ['batches', 'shelves'],            path: PICK,                                                       num: '06', name: 'Enhanced pick route',      step: 4 },
  { z: ['shelves', 'pack', 'outbound'],   path: [[760, 502], [820, 420], P.packA, [940, 340], P.out, P.exit], num: '07', name: 'Pack · label · outbound', step: 5 },
];

// Per-beat duration (ms), derived from the design's progress windows.
const BEAT_WEIGHTS = [0.10, 0.14, 0.15, 0.12, 0.15, 0.18, 0.16];
const BEAT_BASE_MS = 13940; // design connect-phase length (cycle 17s × 0.82)
const BEAT_DUR = BEAT_WEIGHTS.map((w) => Math.round(w * BEAT_BASE_MS));

const ALL_ZONES = ['blocked', 'pool', 'batches', 'shelves', 'pack', 'outbound'];

// precompute path segment lengths
function prep(arr: [number, number][]) {
  const o = { path: arr, seg: [] as number[], len: 0 };
  for (let i = 0; i < arr.length - 1; i++) {
    const d = Math.hypot(arr[i + 1][0] - arr[i][0], arr[i + 1][1] - arr[i][1]);
    o.seg.push(d);
    o.len += d;
  }
  return o;
}
BEATS.forEach((b) => { const p = prep(b.path); b.seg = p.seg; b.len = p.len; });
const OV = prep(OVERVIEW);

function pointAt(o: { path: [number, number][]; seg: number[]; len: number }, u: number): [number, number] {
  let d = u * o.len;
  for (let i = 0; i < o.seg.length; i++) {
    if (d <= o.seg[i] || i === o.seg.length - 1) {
      const k = o.seg[i] ? Math.min(d / o.seg[i], 1) : 0;
      return [
        o.path[i][0] + (o.path[i + 1][0] - o.path[i][0]) * k,
        o.path[i][1] + (o.path[i + 1][1] - o.path[i][1]) * k,
      ];
    }
    d -= o.seg[i];
  }
  return o.path[o.path.length - 1];
}

// last beat index permitted by the current UI step
function maxBeatForStep(curStep: number): number {
  let m = 0;
  for (let i = 0; i < BEATS.length; i++) if (BEATS[i].step <= curStep) m = i;
  return m;
}

const ZONE_LABEL_SX = {
  position: 'absolute', left: '12px', top: '9px',
  font: `500 10px/1.3 ${FONT_SANS}`,
  letterSpacing: '0.08em', textTransform: 'uppercase',
  color: 'rgba(240,238,232,0.5)',
} as const;

const chipBase = {
  position: 'absolute', transform: 'translateZ(26px)', opacity: 0,
  transition: 'opacity 0.6s ease',
  font: `500 11px/1.4 ${FONT_SANS}`, color: INK,
  background: 'rgba(28,39,64,0.95)', borderRadius: '8px', padding: '8px 12px',
} as const;

const WarehouseFilm: React.FC<{ activeStepIndex: number; isDone: boolean }> = ({
  activeStepIndex,
  isDone,
}) => {
  const rootRef   = useRef<HTMLDivElement | null>(null);
  const fitRef    = useRef<HTMLDivElement | null>(null);
  const stageRef  = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  // latest control values, read inside the rAF loop without restarting it
  const stepRef = useRef(activeStepIndex);
  const doneRef = useRef(isDone);
  stepRef.current = activeStepIndex;
  doneRef.current = isDone;

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;

    const RGB      = '31,168,255';     // azure
    const RGB_LITE = '120,205,255';

    let raf = 0;
    let watchdog: ReturnType<typeof setInterval> | null = null;

    // film state
    let beatIdx = 0;
    let beatStart = performance.now();
    let trail: [number, number][] = [];
    const t0 = performance.now();
    let lastTick = 0;
    let ctx: CanvasRenderingContext2D | null = null;
    let boundCanvas: HTMLCanvasElement | null = null;

    const fit = () => {
      const st = stageRef.current, f = fitRef.current;
      if (!st || !f) return;
      const s = Math.min(st.clientWidth / 1190, st.clientHeight / 910);
      f.style.transform = `scale(${s})`;
    };

    const setZones = (lit: string[], g: number) => {
      root.querySelectorAll<HTMLElement>('[data-zone]').forEach((el) => {
        const on = lit.includes(el.getAttribute('data-zone') || '');
        if (on) {
          el.style.borderColor = `rgba(${RGB},${0.55 * g})`;
          el.style.background  = `rgba(${RGB},${0.05 * g})`;
          el.style.boxShadow   = `0 0 30px rgba(${RGB},${0.14 * g})`;
        } else {
          el.style.borderColor = 'rgba(255,255,255,0.10)';
          el.style.background  = 'rgba(255,255,255,0.022)';
          el.style.boxShadow   = 'none';
        }
      });
    };

    const setChips = (oneBased: number, holding: boolean) => {
      root.querySelectorAll<HTMLElement>('[data-show]').forEach((el) => {
        const r = (el.getAttribute('data-show') || '').split('-');
        const a = +r[0], b = +(r[1] || r[0]);
        el.style.opacity = (!holding && oneBased >= a && oneBased <= b) ? '1' : '0';
      });
    };

    const setCaption = (num: string, name: string) => {
      const cn = root.querySelector<HTMLElement>('[data-cap-num]');
      const cm = root.querySelector<HTMLElement>('[data-cap-name]');
      if (cn) cn.textContent = num;
      if (cm) cm.textContent = name;
    };

    const frame = () => {
      fit();
      const cv = canvasRef.current;
      if (!cv) return;
      if (cv !== boundCanvas) {
        boundCanvas = cv;
        ctx = cv.getContext('2d');
        if (ctx) ctx.setTransform(2, 0, 0, 2, 0, 0);
      }
      if (!ctx) return;

      const time = (performance.now() - t0) / 1000;
      const curStep = doneRef.current ? 5 : stepRef.current + 1; // 1..5
      const holding = doneRef.current;
      const maxBeat = maxBeatForStep(curStep);

      // advance / replay the gated beat
      const now = performance.now();
      const dur = BEAT_DUR[beatIdx] || 2200;
      if (now - beatStart >= dur) {
        if (beatIdx < maxBeat) beatIdx += 1;       // step opened up — advance
        else beatIdx = maxBeat;                    // hold at frontier (replay)
        beatStart = now;
      }
      // if backend jumped multiple steps, catch up promptly
      if (beatIdx < maxBeat && now - beatStart >= dur * 0.5) {
        beatIdx += 1; beatStart = now;
      }

      const beat = BEATS[beatIdx];
      const local = Math.min((now - beatStart) / dur, 1);

      // zones + chips + caption
      setZones(holding ? ALL_ZONES : beat.z, holding ? 0.5 : 1);
      setChips(beatIdx + 1, holding);
      if (holding) setCaption('✓ / 06', 'Synced end to end');
      else setCaption(`${beat.num} / 06`, beat.name);

      // pulse position
      let pos: [number, number], alpha = 1;
      if (holding) { pos = pointAt(OV, (time * 0.05) % 1); alpha = 0.8; }
      else {
        const e = local < 0.5 ? 4 * local * local * local : 1 - Math.pow(-2 * local + 2, 3) / 2;
        pos = pointAt(beat as Required<Beat>, e);
      }

      // trail
      const last = trail[trail.length - 1];
      if (last && Math.hypot(pos[0] - last[0], pos[1] - last[1]) > 110) trail = [];
      trail.push(pos);
      if (trail.length > 60) trail.shift();

      // draw
      ctx.clearRect(0, 0, 1100, 700);
      ctx.globalCompositeOperation = 'lighter';
      ctx.lineCap = 'round';
      const n = trail.length;
      for (let i = 1; i < n; i++) {
        const f = i / n;
        ctx.strokeStyle = `rgba(${RGB},${f * f * 0.55 * alpha})`;
        ctx.lineWidth = 0.5 + f * 4.5;
        ctx.beginPath();
        ctx.moveTo(trail[i - 1][0], trail[i - 1][1]);
        ctx.lineTo(trail[i][0], trail[i][1]);
        ctx.stroke();
      }
      const [x, y] = pos;
      let rg = ctx.createRadialGradient(x, y, 0, x, y, 30);
      rg.addColorStop(0, `rgba(${RGB},${0.32 * alpha})`); rg.addColorStop(1, `rgba(${RGB},0)`);
      ctx.fillStyle = rg; ctx.beginPath(); ctx.arc(x, y, 30, 0, 7); ctx.fill();
      rg = ctx.createRadialGradient(x, y, 0, x, y, 11);
      rg.addColorStop(0, `rgba(${RGB_LITE},${0.75 * alpha})`); rg.addColorStop(1, `rgba(${RGB},0)`);
      ctx.fillStyle = rg; ctx.beginPath(); ctx.arc(x, y, 11, 0, 7); ctx.fill();
      ctx.fillStyle = `rgba(255,255,255,${alpha})`; ctx.beginPath(); ctx.arc(x, y, 3, 0, 7); ctx.fill();
      ctx.strokeStyle = `rgba(${RGB},${0.16 * alpha})`; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.arc(x, y, 21 + 3.5 * Math.sin(time * 2.4), 0, 7); ctx.stroke();
      ctx.globalCompositeOperation = 'source-over';
    };

    const onResize = () => fit();
    window.addEventListener('resize', onResize);
    fit();

    const tick = () => { raf = requestAnimationFrame(tick); lastTick = performance.now(); frame(); };
    tick();
    // watchdog keeps the film alive if rAF is throttled (background tab return)
    watchdog = setInterval(() => { if (performance.now() - lastTick > 220) frame(); }, 250);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', onResize);
      if (watchdog) clearInterval(watchdog);
    };
  }, []);

  const ZONE_BOX = {
    position: 'absolute', borderRadius: '7px',
    border: '1px solid rgba(255,255,255,0.10)', background: 'rgba(255,255,255,0.022)',
    transition: 'border-color 0.6s, background 0.6s, box-shadow 0.6s',
  } as const;

  return (
    <Box
      ref={rootRef}
      sx={{
        position: 'relative', width: '100%', height: '100%', minHeight: 420,
        border: '1px solid rgba(255,255,255,0.07)', borderRadius: '16px',
        background: 'rgba(255,255,255,0.012)', overflow: 'hidden',
      }}
    >
      {/* faint backdrop grid, masked to a soft ellipse */}
      <Box sx={{
        position: 'absolute', inset: 0,
        backgroundImage:
          'repeating-linear-gradient(0deg, rgba(255,255,255,0.022) 0 1px, transparent 1px 46px),' +
          'repeating-linear-gradient(90deg, rgba(255,255,255,0.022) 0 1px, transparent 1px 46px)',
        WebkitMaskImage: 'radial-gradient(ellipse 78% 70% at 50% 48%, #000 25%, transparent 82%)',
        maskImage: 'radial-gradient(ellipse 78% 70% at 50% 48%, #000 25%, transparent 82%)',
        pointerEvents: 'none',
      }} />

      {/* caption */}
      <Box sx={{ position: 'absolute', left: 24, top: 22, zIndex: 6, display: 'flex', alignItems: 'baseline', gap: '11px' }}>
        <Typography data-cap-num component="span" sx={{ font: `400 15px/1 ${FONT_SERIF}`, color: AZURE }}>01 / 06</Typography>
        <Typography data-cap-name component="span" sx={{ font: `500 10px/1 ${FONT_SANS}`, letterSpacing: '0.14em', textTransform: 'uppercase', color: 'rgba(240,238,232,0.55)' }}>Orders arriving</Typography>
      </Box>

      {/* 3D fit wrapper + plane */}
      <Box ref={stageRef} sx={{ position: 'absolute', inset: 0 }}>
        <Box ref={fitRef} sx={{ position: 'absolute', left: '50%', top: '51%', width: 0, height: 0, transformOrigin: '0 0' }}>
          <Box sx={{ perspective: '1600px' }}>
            <Box sx={{
              position: 'relative', width: 1100, height: 700, ml: '-550px', mt: '-350px',
              transform: 'rotateX(47deg) rotateZ(-31deg)', transformStyle: 'preserve-3d',
            }}>
              {/* ── ZONES ── */}
              <Box data-zone="blocked" sx={{ ...ZONE_BOX, left: 64, top: 80, width: 250, height: 252 }}>
                <Box component="span" sx={ZONE_LABEL_SX}>Blocked orders</Box>
                {[40, 82, 124, 166, 208].map((t) => (
                  <Box key={t} sx={{ position: 'absolute', left: 18, right: 18, top: t, height: 30, border: '1px solid rgba(255,255,255,0.09)', borderRadius: '4px', background: 'rgba(255,255,255,0.03)' }} />
                ))}
              </Box>

              <Box data-zone="pool" sx={{ ...ZONE_BOX, left: 64, top: 388, width: 250, height: 244 }}>
                <Box component="span" sx={ZONE_LABEL_SX}>Orders pool · ready</Box>
              </Box>

              <Box data-zone="batches" sx={{ ...ZONE_BOX, left: 366, top: 80, width: 214, height: 214 }}>
                <Box component="span" sx={ZONE_LABEL_SX}>Batch release</Box>
              </Box>

              <Box data-zone="shelves" sx={{ ...ZONE_BOX, left: 366, top: 332, width: 444, height: 300, background: 'rgba(255,255,255,0.02)' }}>
                <Box component="span" sx={ZONE_LABEL_SX}>Pick · inventory</Box>
                {[42, 104, 166, 228].map((t) => (
                  <Box key={t} sx={{ position: 'absolute', left: 22, right: 22, top: t, height: 22, background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.09)', borderRadius: '3px' }} />
                ))}
                {/* stocked cell markers (beats 2–8) */}
                {[
                  { l: 120, t: 46,  o: 0.8,  g: 0.75 },
                  { l: 300, t: 108, o: 0.65, g: 0.6  },
                  { l: 210, t: 170, o: 0.55, g: 0.5  },
                  { l: 360, t: 232, o: 0.5,  g: 0.5  },
                ].map((m, i) => (
                  <Box key={i} data-show="2-8" sx={{ position: 'absolute', left: m.l, top: m.t, width: 11, height: 11, background: `rgba(31,168,255,${m.o})`, borderRadius: '2px', boxShadow: `0 0 11px rgba(31,168,255,${m.g})`, opacity: 0, transition: 'opacity 0.7s ease' }} />
                ))}
              </Box>

              <Box data-zone="pack" sx={{ ...ZONE_BOX, left: 842, top: 80, width: 196, height: 230 }}>
                <Box component="span" sx={ZONE_LABEL_SX}>Pack &amp; label</Box>
                {[44, 92, 140].map((t) => (
                  <Box key={t} sx={{ position: 'absolute', left: 20, right: 20, top: t, height: 24, border: '1px solid rgba(255,255,255,0.10)', borderRadius: '3px', background: 'rgba(255,255,255,0.04)' }} />
                ))}
              </Box>

              <Box data-zone="outbound" sx={{ ...ZONE_BOX, left: 842, top: 366, width: 196, height: 266 }}>
                <Box component="span" sx={ZONE_LABEL_SX}>Outbound</Box>
                {[60, 130].map((t) => (
                  <Box key={t} sx={{ position: 'absolute', right: -1, top: t, width: 8, height: 46, background: 'rgba(255,255,255,0.10)', borderRadius: '2px' }} />
                ))}
              </Box>

              {/* parcels staged (beat 6+) */}
              <Box data-show="6-8" sx={{ position: 'absolute', left: 868, top: 560, display: 'flex', gap: '9px', opacity: 0, transition: 'opacity 0.7s ease' }}>
                {[0, 1, 2, 3].map((i) => (
                  <Box key={i} sx={{ width: 15, height: 15, background: i % 2 ? '#243050' : '#2E3D62', border: `1px solid rgba(31,168,255,${i % 2 ? 0.45 : 0.55})`, borderRadius: '2px' }} />
                ))}
              </Box>

              {/* ── CHIPS ── */}
              {/* beat 1 */}
              <Box data-show="1" sx={{ ...chipBase, left: 80, top: 22, border: '1px solid rgba(31,168,255,0.35)', display: 'flex', alignItems: 'center', gap: '8px' }}>
                <Box component="span" sx={{ width: 7, height: 7, borderRadius: '50%', background: AZURE, flex: 'none', boxShadow: '0 0 8px rgba(31,168,255,0.9)' }} />
                <span>Orders syncing from Shopify</span>
              </Box>

              {/* beat 3 — blocked tags */}
              <Box data-show="3" sx={{ position: 'absolute', left: 330, top: 96, transform: 'translateZ(26px)', opacity: 0, transition: 'opacity 0.6s ease', display: 'flex', flexDirection: 'column', gap: '7px' }}>
                {[
                  ['Address unverified', 'customer'],
                  ['Out of stock', 'inventory'],
                  ['Carrier delay', 'operational'],
                ].map(([t, tag]) => (
                  <Box key={t} sx={{ background: 'rgba(40,26,22,0.96)', border: '1px solid rgba(255,107,43,0.45)', borderRadius: '8px', padding: '7px 11px', font: `500 11px/1.3 ${FONT_SANS}`, color: INK, display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <Box component="span" sx={{ width: 7, height: 7, borderRadius: '50%', background: ACCENT, flex: 'none' }} />
                    <span>{t} · <Box component="span" sx={{ color: '#FF9C6E' }}>{tag}</Box></span>
                  </Box>
                ))}
              </Box>

              {/* beat 4 — resolved */}
              <Box data-show="4" sx={{ ...chipBase, left: 330, top: 372, border: '1px solid rgba(31,168,255,0.4)', display: 'flex', alignItems: 'center', gap: '8px' }}>
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke={AZURE} strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 L9 17 l-5 -5" /></svg>
                <span>3 blocks cleared · ready for batch</span>
              </Box>

              {/* beat 5 — batches */}
              <Box data-show="5" sx={{ position: 'absolute', left: 470, top: 24, transform: 'translateZ(26px)', opacity: 0, transition: 'opacity 0.6s ease', display: 'flex', flexDirection: 'column', gap: '7px' }}>
                <Box sx={{ background: 'rgba(28,39,64,0.95)', border: '1px solid rgba(31,168,255,0.4)', borderRadius: '8px', padding: '8px 12px', font: `500 11px/1.4 ${FONT_SANS}`, color: INK }}>Batch A · 14 orders · 1 path</Box>
                <Box sx={{ background: 'rgba(28,39,64,0.95)', border: '1px solid rgba(255,255,255,0.12)', borderRadius: '8px', padding: '8px 12px', font: `500 11px/1.4 ${FONT_SANS}`, color: INK_MUTED }}>Batch B · 12 orders · queued</Box>
              </Box>

              {/* beat 5/6 — pick scan */}
              <Box data-show="5-6" sx={{ ...chipBase, left: 600, top: 300, border: '1px solid rgba(31,168,255,0.4)', display: 'flex', alignItems: 'center', gap: '8px' }}>
                <Box component="span" sx={{ width: 7, height: 7, borderRadius: '50%', background: AZURE, flex: 'none', boxShadow: '0 0 8px rgba(31,168,255,0.9)' }} />
                <span>Enhanced route · 7 of 14 picked</span>
              </Box>

              {/* beat 6 — label */}
              <Box data-show="6" sx={{ ...chipBase, left: 836, top: 24, border: '1px solid rgba(31,168,255,0.4)' }}>Label printed · #SH-2291</Box>

              {/* pulse canvas (inherits the iso plane transform) */}
              <Box component="canvas" ref={canvasRef} width={2200} height={1400} sx={{ position: 'absolute', left: 0, top: 0, width: 1100, height: 700, pointerEvents: 'none' }} />
            </Box>
          </Box>
        </Box>
      </Box>
    </Box>
  );
};

// ════════════════════════════════════════════════════════════════════════════
//  StepItem — left checklist row (all 5 visible; unreached dimmed)
// ════════════════════════════════════════════════════════════════════════════

type StepState = 'pending' | 'active' | 'done';

const StepIcon: React.FC<{ state: StepState }> = ({ state }) => {
  if (state === 'done')   return <CheckCircle size={20} color={OK_GREEN} />;
  if (state === 'active') return <Zap size={20} color={ACCENT} fill="none" />;
  return <Circle size={20} color="rgba(255,255,255,0.22)" />;
};

const StepItem: React.FC<{
  step: StepDef;
  state: StepState;
  stepIndex: number;
  count: number;
  total: number;
  pal: ReturnType<typeof useSyncTheme>;
}> = ({ step, state, stepIndex, count, total, pal }) => {
  const reached = state === 'active' || state === 'done';
  const titleColor =
    state === 'done' ? OK_GREEN : state === 'active' ? ACCENT : INK_MUTED;

  // step 2 inline live product count (real data, not the demo's hardcoded 20)
  const showCount = stepIndex === 1 && reached;
  // step 3 "blocked surfacing" substatus while active
  const showSub3 = stepIndex === 2 && state === 'active';

  return (
    <Box sx={{
      display: 'flex', gap: '14px', maxWidth: 470,
      opacity: reached ? 1 : 0.32,
      transition: 'opacity 0.5s ease',
      animation: state === 'active' ? 'lsIconPulseWrap 0s' : 'none',
    }}>
      <Box sx={{
        flex: 'none', mt: '1px',
        '@keyframes lsIconPulse': {
          '0%, 100%': { opacity: 1, transform: 'scale(1)' },
          '50%':      { opacity: 0.55, transform: 'scale(0.9)' },
        },
        animation: state === 'active' ? 'lsIconPulse 1.5s ease-in-out infinite' : 'none',
      }}>
        <StepIcon state={state} />
      </Box>

      <Box sx={{ minWidth: 0 }}>
        <Typography sx={{
          font: `500 13px/1.3 ${FONT_SANS}`, letterSpacing: '0.07em',
          textTransform: 'uppercase', color: titleColor, mb: '5px',
          transition: 'color 0.4s ease',
        }}>
          {step.label}
        </Typography>

        {showSub3 && (
          <Box sx={{ display: 'flex', alignItems: 'center', gap: '8px', mb: '4px' }}>
            <Box sx={{
              width: 6, height: 6, borderRadius: '50%', background: ACCENT, flex: 'none',
              '@keyframes lsBlink': { '0%,100%': { opacity: 1, transform: 'scale(1)' }, '50%': { opacity: 0.35, transform: 'scale(0.7)' } },
              animation: 'lsBlink 1.2s ease-in-out infinite',
            }} />
            <Typography sx={{ font: `500 13px/1.4 ${FONT_SANS}`, color: pal.textPrimary }}>
              Blocked orders surfacing — this takes a moment
            </Typography>
          </Box>
        )}

        <Typography sx={{ font: `300 13.5px/1.55 ${FONT_SANS}`, color: pal.textMuted, m: 0 }}>
          {showCount && (
            <>
              <Box component="span" sx={{ font: `500 15px/1 ${FONT_SANS}`, color: pal.textPrimary, fontVariantNumeric: 'tabular-nums' }}>
                {count.toLocaleString()}
              </Box>
              {total > 0 ? <> of {total.toLocaleString()} products — </> : ' products — '}
            </>
          )}
          {step.detail}
        </Typography>
      </Box>
    </Box>
  );
};

// ════════════════════════════════════════════════════════════════════════════
//  SyncAnimationPage
// ════════════════════════════════════════════════════════════════════════════

const SyncAnimationPage: React.FC = () => {
  const { status, counts: polledCounts, progress } = useSyncStatus();
  const { stepStates, activeStepIndex, progressWidth, isError } =
    useSyncStepMachine(status, polledCounts, TOTAL_STEPS, progress);
  const pal = useSyncTheme();

  const isDone = status === 'COMPLETED';

  // Peak count tracking — DB counts lag projections; never let displayed numbers regress.
  const peakVariantsRef = useRef(0);
  if (polledCounts.variants > 0) peakVariantsRef.current = Math.max(peakVariantsRef.current, polledCounts.variants);
  if (progress?.current && progress.current > 0) peakVariantsRef.current = Math.max(peakVariantsRef.current, progress.current);

  const productCount = peakVariantsRef.current;
  const productTotal = progress?.total ?? 0;

  // ── Error state ──────────────────────────────────────────────────────────
  if (isError) {
    return (
      <Box sx={{ minHeight: '100dvh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: pal.pageBg }}>
        <Box sx={{ textAlign: 'center', maxWidth: 340, p: 4 }}>
          <Typography sx={{ font: `400 26px/1.1 ${FONT_SERIF}`, color: pal.textPrimary, mb: 1 }}>Sync interrupted</Typography>
          <Typography sx={{ font: `300 14px/1.6 ${FONT_SANS}`, color: pal.textSecond }}>
            Something went wrong while connecting your store. Please reconnect to try again.
          </Typography>
        </Box>
      </Box>
    );
  }

  const curStepNum = Math.min(activeStepIndex + 1, TOTAL_STEPS);
  const pct = isDone ? 100 : Math.round(progressWidth);

  return (
    <Box sx={{
      minHeight: 'calc(100vh - 60px)',
      background: pal.pageBg,
      color: pal.textPrimary,
      fontFamily: FONT_SANS,
      display: 'flex', flexDirection: 'column',
    }}>
      <Box sx={{
        flex: 1, display: 'flex', alignItems: 'stretch', minHeight: 0,
        flexDirection: { xs: 'column', md: 'row' },
        maxWidth: 1440, mx: 'auto', width: '100%',
      }}>
        {/* ░░░ LEFT — narrative + steps ░░░ */}
        <Box sx={{
          flex: { md: '0 0 44%' }, maxWidth: { md: 620 },
          display: 'flex', flexDirection: 'column', justifyContent: 'center',
          px: { xs: 3, md: '4vw' }, py: { xs: 4, md: 0 }, minWidth: 0,
        }}>
          {/* eyebrow */}
          <Box sx={{ display: 'inline-flex', alignItems: 'center', gap: '9px', mb: '22px' }}>
            <Box sx={{
              width: 7, height: 7, borderRadius: '50%', background: ACCENT,
              '@keyframes lsBlink2': { '0%,100%': { transform: 'scale(1)', opacity: 1 }, '50%': { transform: 'scale(0.7)', opacity: 0.45 } },
              animation: 'lsBlink2 2.2s ease-in-out infinite',
            }} />
            <Typography sx={{ font: `500 11px/1 ${FONT_SANS}`, letterSpacing: '0.13em', textTransform: 'uppercase', color: ACCENT }}>
              Connecting your operation
            </Typography>
          </Box>

          {/* headline */}
          <Typography component="h1" sx={{
            font: `400 clamp(34px, 4vw, 52px)/1.05 ${FONT_SERIF}`,
            letterSpacing: '-0.02em', color: pal.textPrimary, m: '0 0 14px', textWrap: 'balance',
          }}>
            Building your LaSyncro workspace,{' '}
            <Box component="em" sx={{ fontStyle: 'italic', color: ACCENT }}>live.</Box>
          </Typography>

          <Typography sx={{ font: `300 15px/1.6 ${FONT_SANS}`, color: pal.textSecond, maxWidth: 440, m: '0 0 28px' }}>
            Turning your Shopify data into inventory truth, orders triage, warehouse flow, and your first Morning Brief.
          </Typography>

          {/* checklist */}
          <Stack spacing={2} sx={{ mb: '30px' }}>
            {STEPS.map((step, i) => (
              <StepItem
                key={i}
                step={step}
                state={stepStates[i]}
                stepIndex={i}
                count={productCount}
                total={productTotal}
                pal={pal}
              />
            ))}
          </Stack>

          {/* progress */}
          <Box sx={{ maxWidth: 470 }}>
            <Box sx={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', mb: '11px' }}>
              <Typography sx={{ font: `500 11px/1 ${FONT_SANS}`, letterSpacing: '0.1em', textTransform: 'uppercase', color: pal.textHint }}>
                {isDone ? 'Workspace ready' : `Step ${curStepNum} of ${TOTAL_STEPS}`}
              </Typography>
              <Typography sx={{ font: `400 15px/1 ${FONT_SERIF}`, color: ACCENT }}>{pct}%</Typography>
            </Box>
            <Box sx={{ position: 'relative', height: 3, borderRadius: '3px', background: pal.barTrack, overflow: 'hidden' }}>
              <Box sx={{
                position: 'absolute', left: 0, top: 0, bottom: 0,
                width: `${pct}%`, borderRadius: '3px',
                background: `linear-gradient(90deg, ${ACCENT}, ${ACCENT_HOVER})`,
                transition: 'width 1s cubic-bezier(0.4,0,0.2,1)',
              }} />
            </Box>
          </Box>
        </Box>

        {/* ░░░ RIGHT — fulfillment film ░░░ */}
        <Box sx={{
          flex: 1, minWidth: 0,
          display: { xs: 'none', md: 'block' },
          p: '26px 30px 30px 0',
        }}>
          <WarehouseFilm activeStepIndex={activeStepIndex} isDone={isDone} />
        </Box>
      </Box>
    </Box>
  );
};

export default SyncAnimationPage;