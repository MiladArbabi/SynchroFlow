// modules/floor-planning/src/ui/components/CanvasEditor.tsx
/**
 * CanvasEditor — 2D SVG floor plan editor (Phase 2)
 * ---------------------------------------------------
 * Three-column layout:
 *   LEFT  — ComponentPalette: draggable zone type tiles + layout templates
 *   CENTER — SVG canvas: positioned racks, pan/zoom, drag-to-reposition, metre rulers
 *   RIGHT  — RackInspector: fixed panel showing editable dimensions, stats, actions
 *
 * Coordinate system: metres from top-left origin, rendered at SCALE px/m.
 * Snap grid: 0.5m.
 * Collision: warehouse zones are frames (no collision). All other zones clamp
 * to nearest non-overlapping edge during drag and resize.
 *
 * Phase 3: same WarehouseLocation data feeds Three.js renderer unchanged.
 */
import { useState, useRef, useCallback, useEffect } from 'react';
import { Box, Typography, Divider, Chip, IconButton, Paper, TextField } from '@mui/material';
import { X, Layers, RotateCw, Copy, Trash2, Tag } from 'lucide-react';
import type { WarehouseZone } from '../pages/FloorPlanningModuleFT2.js';

// ── Constants ────────────────────────────────────────────────────────────────
const SCALE      = 60;
const SNAP       = 0.1;
const MIN_ZOOM   = 0.3;
const MAX_ZOOM   = 3.0;
const CANVAS_W   = 20;
const CANVAS_H   = 15;
const RULER_SIZE = 24;

// Zone fills — higher opacity for visual distinction; stroke is the saturated anchor colour.
// Palette: indigo=pick, amber=pack, emerald=receive, sky=ship, rose=returns, red=quarantine, violet=kitting, slate=storage
// Zone fills — higher opacity for visual distinction; stroke is the saturated anchor colour.
// Palette: indigo=pick, amber=pack, emerald=receive, sky=ship, rose=returns, red=quarantine, violet=kitting, slate=storage
// Frame types (lane/warehouse) use faded gold — visually distinct as territory containers.
const ZONE_COLORS: Record<string, string> = {
  // Frame types — gold/amber faded, reads as "territory"
  lane:       'rgba(217,179,83,0.12)',
  warehouse:  'rgba(217,179,83,0.08)',
  shelf:      'rgba(217,179,83,0.10)',
  // Operational zone types
  pick:       'rgba(99,102,241,0.22)',
  pack:       'rgba(245,158,11,0.25)',
  receive:    'rgba(16,185,129,0.22)',
  ship:       'rgba(14,165,233,0.22)',
  returns:    'rgba(251,113,133,0.25)',
  quarantine: 'rgba(239,68,68,0.35)',
  kitting:    'rgba(139,92,246,0.25)',
  storage:    'rgba(100,116,139,0.18)',
};

const ZONE_STROKE: Record<string, string> = {
  // Frame types — muted gold border
  lane:       'rgba(217,179,83,0.5)',
  warehouse:  'rgba(217,179,83,0.35)',
  shelf:      'rgba(217,179,83,0.45)',
  // Operational zone types
  pick:       'rgba(99,102,241,0.85)',
  pack:       'rgba(245,158,11,0.85)',
  receive:    'rgba(16,185,129,0.85)',
  ship:       'rgba(14,165,233,0.85)',
  returns:    'rgba(251,113,133,0.85)',
  quarantine: 'rgba(239,68,68,1.0)',
  kitting:    'rgba(139,92,246,0.85)',
  storage:    'rgba(100,116,139,0.6)',
};

const PALETTE_ITEMS = [
  { type: 'lane',    label: 'Aisle',           zone_type: 'pick',    defaultW: 4.4, defaultD: 1.0 },
  { type: 'bin',     label: 'Rack',            zone_type: 'storage', defaultW: 1.0, defaultD: 0.8 },
  { type: 'bin',     label: 'Bin',             zone_type: 'pick',    defaultW: 1.0, defaultD: 0.8 },
  { type: 'bin',     label: 'Dock',            zone_type: 'ship',    defaultW: 3.0, defaultD: 3.0 },
  { type: 'bin',     label: 'Packing station', zone_type: 'pack',    defaultW: 2.0, defaultD: 1.5 },
  { type: 'bin',     label: 'Shipping bay',    zone_type: 'ship',    defaultW: 4.0, defaultD: 3.0 },
  { type: 'bin',     label: 'Returns area',    zone_type: 'returns', defaultW: 3.0, defaultD: 2.0 },
  { type: 'bin',     label: 'Kitting bench',   zone_type: 'kitting', defaultW: 2.0, defaultD: 1.0 },
] as const;

const TEMPLATES = [
  { label: 'Pick-pack-ship (linear)' },
  { label: 'U-shaped flow'           },
  { label: 'Fish-bone with kitting'  },
];

function snapV(v: number): number {
  return Math.round(v / SNAP) * SNAP;
}

// ── Types ────────────────────────────────────────────────────────────────────
interface DragState {
  locationCode: string;
  startMouseX: number;
  startMouseY: number;
  startPosX: number;
  startPosY: number;
}

interface PanState {
  startMouseX: number;
  startMouseY: number;
  startOffsetX: number;
  startOffsetY: number;
}

interface ResizeState {
  locationCode: string;
  edge: 'se' | 'e' | 's';
  startMouseX: number;
  startMouseY: number;
  startW: number;
  startD: number;
}

interface CanvasEditorProps {
  zones: WarehouseZone[];
  onUpdateZone?: (locationCode: string, payload: {
    position_x?: number | null;
    position_y?: number | null;
    width?: number | null;
    depth?: number | null;
    orientation?: number;
    rack_levels?: number | null;
    zone_type?: string | null;
  }) => Promise<void>;
  onDeleteZone?: (locationCode: string) => Promise<void>;
}

// ── ComponentPalette ─────────────────────────────────────────────────────────
function ComponentPalette({ unpositionedZones, onPlace }: {
  unpositionedZones: WarehouseZone[];
  onPlace: (zone: WarehouseZone) => void;
}) {
  return (
    <Box sx={{
      width: 160, flexShrink: 0, borderRight: '1px solid var(--rule)',
      bgcolor: 'var(--bg)', display: 'flex', flexDirection: 'column', overflow: 'hidden',
    }}>
      <Box sx={{ p: 1.5, borderBottom: '1px solid var(--rule)' }}>
        <Typography sx={{ fontSize: 9, fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--ink-4)' }}>
          Drag to add
        </Typography>
      </Box>
      <Box sx={{ p: 1, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 0.75, overflowY: 'auto' }}>
        {PALETTE_ITEMS.map((item) => {
          const fill   = ZONE_COLORS[item.zone_type] ?? ZONE_COLORS.storage;
          const stroke = ZONE_STROKE[item.zone_type] ?? ZONE_STROKE.storage;
          return (
            <Box key={item.label} title={`${item.label} · ${item.zone_type}`}
              sx={{ p: 1, borderRadius: 1.5, border: `1px solid ${stroke}`, bgcolor: fill, cursor: 'grab',
                display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 0.5, userSelect: 'none',
                '&:hover': { opacity: 0.8 }, transition: 'opacity 0.12s' }}>
              <Box sx={{ width: '100%', height: 20, borderRadius: 0.5, border: `1px solid ${stroke}`, bgcolor: fill }} />
              <Typography sx={{ fontSize: 9, fontWeight: 600, color: 'var(--ink-2)', textAlign: 'center', lineHeight: 1.2 }}>
                {item.label}
              </Typography>
            </Box>
          );
        })}
      </Box>

      {/* Unpositioned zones — click to place at canvas centre */}
      {unpositionedZones.length > 0 && (
        <>
          <Divider />
          <Box sx={{ p: 1.5, borderBottom: '1px solid var(--rule)' }}>
            <Typography sx={{ fontSize: 9, fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--ink-4)', mb: 1 }}>
              Unpositioned · {unpositionedZones.length}
            </Typography>
            {unpositionedZones.map((zone) => {
              const colorKey = (zone.type === 'lane' || zone.type === 'warehouse' || zone.type === 'shelf') ? zone.type : (zone.zone_type ?? 'storage');
              const stroke = ZONE_STROKE[colorKey] ?? ZONE_STROKE.storage;
              const fill   = ZONE_COLORS[colorKey] ?? ZONE_COLORS.storage;
              return (
                <Box key={zone.location_code} onClick={() => onPlace(zone)} title="Click to place on canvas"
                  sx={{ display: 'flex', alignItems: 'center', gap: 0.75, py: 0.6, px: 1, mb: 0.5, borderRadius: 1,
                    border: `1px solid ${stroke}`, bgcolor: fill, cursor: 'pointer', userSelect: 'none',
                    '&:hover': { opacity: 0.8 }, transition: 'opacity 0.12s' }}>
                  <Box sx={{ width: 8, height: 8, borderRadius: 0.5, border: `1px solid ${stroke}`, bgcolor: fill, flexShrink: 0 }} />
                  <Typography sx={{ fontSize: 10, fontFamily: 'monospace', fontWeight: 600, color: 'var(--ink-2)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {zone.location_code}
                  </Typography>
                </Box>
              );
            })}
          </Box>
        </>
      )}

      <Divider />
      <Box sx={{ p: 1.5, borderBottom: '1px solid var(--rule)' }}>
        <Typography sx={{ fontSize: 9, fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--ink-4)', mb: 1 }}>
          Templates
        </Typography>
        {TEMPLATES.map((t) => (
          <Box key={t.label} sx={{ display: 'flex', alignItems: 'center', gap: 0.75, py: 0.75, px: 1, borderRadius: 1, cursor: 'pointer', mb: 0.5, '&:hover': { bgcolor: 'var(--bg-2)' } }}>
            <Box sx={{ width: 3, height: 3, borderRadius: '50%', bgcolor: 'var(--ink-4)', flexShrink: 0 }} />
            <Typography sx={{ fontSize: 10, color: 'var(--ink-3)', lineHeight: 1.3 }}>{t.label}</Typography>
          </Box>
        ))}
      </Box>
      <Box sx={{ p: 1.5, mt: 'auto', borderTop: '1px solid var(--rule)', bgcolor: 'var(--bg-2)' }}>
        <Typography sx={{ fontSize: 9, fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--ink-4)', mb: 0.75 }}>
          Layout health
        </Typography>
        <Typography sx={{ fontSize: 10, color: 'var(--ink-4)', fontStyle: 'italic', lineHeight: 1.4 }}>
          All good — no issues detected.
        </Typography>
      </Box>
    </Box>
  );
}

// ── RackInspector ─────────────────────────────────────────────────────────────
function RackInspector({ zone, onClose, onUpdateZone, onDeleteZone }: {
  zone: WarehouseZone;
  onClose: () => void;
  onUpdateZone?: CanvasEditorProps['onUpdateZone'];
  onDeleteZone?: CanvasEditorProps['onDeleteZone'];
}) {
  const zoneColor = ZONE_STROKE[zone.zone_type ?? 'storage'] ?? ZONE_STROKE.storage;
  const [saving, setSaving] = useState(false);
  const [editW, setEditW]   = useState(String(zone.width  ?? ''));
  const [editD, setEditD]   = useState(String(zone.depth  ?? ''));
  const [editX, setEditX]   = useState(String(zone.position_x ?? ''));
  const [editY, setEditY]   = useState(String(zone.position_y ?? ''));

  useEffect(() => {
    setEditW(String(zone.width  ?? ''));
    setEditD(String(zone.depth  ?? ''));
    setEditX(String(zone.position_x ?? ''));
    setEditY(String(zone.position_y ?? ''));
  }, [zone.location_code, zone.width, zone.depth, zone.position_x, zone.position_y]);

  async function commitField(field: 'width' | 'depth' | 'position_x' | 'position_y', raw: string) {
    const val = parseFloat(raw);
    if (isNaN(val) || !onUpdateZone) return;
    setSaving(true);
    try { await onUpdateZone(zone.location_code, { [field]: snapV(val) }); }
    finally { setSaving(false); }
  }

  async function handleDelete() {
    if (!onDeleteZone) return;
    if (!window.confirm(`Delete ${zone.location_code}? This cannot be undone.`)) return;
    await onDeleteZone(zone.location_code);
    onClose();
  }

  return (
    <Box sx={{ width: 220, flexShrink: 0, borderLeft: '1px solid var(--rule)', bgcolor: 'var(--bg)', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <Box sx={{ px: 2, py: 1.5, borderBottom: '1px solid var(--rule)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <Typography sx={{ fontSize: 9, fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--ink-4)' }}>
          {zone.type.toUpperCase()}
        </Typography>
        <IconButton size="small" onClick={onClose} sx={{ color: 'var(--ink-4)' }}><X size={13} /></IconButton>
      </Box>
      <Box sx={{ flex: 1, overflowY: 'auto', p: 2, display: 'flex', flexDirection: 'column', gap: 2 }}>
        <Box>
          <Typography sx={{ fontSize: 9, fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--ink-4)', mb: 0.75 }}>Code</Typography>
          <Box sx={{ px: 1.5, py: 1, bgcolor: 'var(--bg-2)', borderRadius: 1, border: '1px solid var(--rule)' }}>
            <Typography sx={{ fontFamily: 'monospace', fontSize: 14, fontWeight: 700, color: 'var(--ink)' }}>{zone.location_code}</Typography>
          </Box>
        </Box>
        {zone.zone_type && (
          <Box sx={{ display: 'flex', gap: 0.75, flexWrap: 'wrap' }}>
            <Chip label={zone.type} size="small" sx={{ fontSize: 10, height: 20 }} />
            <Chip label={zone.zone_type} size="small"
              sx={{ fontSize: 10, height: 20, bgcolor: ZONE_COLORS[zone.zone_type] ?? 'transparent', color: zoneColor, border: `1px solid ${zoneColor}` }} />
          </Box>
        )}
        <Divider />
        <Box>
          <Typography sx={{ fontSize: 9, fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--ink-4)', mb: 1 }}>Dimensions</Typography>
          <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 1 }}>
            {([
              { label: 'Width',      field: 'width'      as const, value: editW, set: setEditW },
              { label: 'Depth',      field: 'depth'      as const, value: editD, set: setEditD },
              { label: 'Position X', field: 'position_x' as const, value: editX, set: setEditX },
              { label: 'Position Y', field: 'position_y' as const, value: editY, set: setEditY },
            ]).map(({ label, field, value, set }) => (
              <Box key={field}>
                <Typography sx={{ fontSize: 9, color: 'var(--ink-4)', mb: 0.25, fontWeight: 500 }}>{label}</Typography>
                <TextField size="small" value={value} onChange={(e) => set(e.target.value)}
                  onBlur={() => commitField(field, value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') commitField(field, value); }}
                  disabled={saving}
                  inputProps={{ style: { fontFamily: 'monospace', fontSize: 12, padding: '4px 8px' } }}
                  InputProps={{ endAdornment: <Typography sx={{ fontSize: 10, color: 'var(--ink-4)' }}>m</Typography> }}
                  sx={{ width: '100%' }} />
              </Box>
            ))}
          </Box>
        </Box>
        <Divider />
        <Box sx={{ display: 'flex', gap: 2 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
            <Layers size={12} color="var(--ink-4)" />
            <Typography sx={{ fontSize: 11, color: 'var(--ink-3)' }}>{zone.rack_levels ?? '—'} levels</Typography>
          </Box>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
            <RotateCw size={12} color="var(--ink-4)" />
            <Typography sx={{ fontSize: 11, color: 'var(--ink-3)' }}>{zone.orientation ?? 0}°</Typography>
          </Box>
        </Box>
        {zone.barcode && (
          <Box>
            <Typography sx={{ fontSize: 9, fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--ink-4)', mb: 0.75 }}>Barcode</Typography>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, px: 1.5, py: 1, bgcolor: 'var(--bg-2)', borderRadius: 1, border: '1px solid var(--rule)' }}>
              <Tag size={11} color="var(--ink-4)" />
              <Typography sx={{ fontFamily: 'monospace', fontSize: 11, color: 'var(--ink)' }}>{zone.barcode}</Typography>
            </Box>
          </Box>
        )}
        {zone.parent_location_code && (
          <Typography sx={{ fontSize: 10, color: 'var(--ink-4)' }}>
            Parent: <span style={{ fontFamily: 'monospace' }}>{zone.parent_location_code}</span>
          </Typography>
        )}
      </Box>
      <Box sx={{ p: 1.5, borderTop: '1px solid var(--rule)', display: 'flex', flexDirection: 'column', gap: 0.75 }}>
        {/* Print barcode — hidden for warehouse frame type which have no scannable barcode */}
        {zone.type !== 'warehouse' && (
          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 0.75, py: 1, borderRadius: 1.5, bgcolor: 'var(--accent)', color: '#fff', fontSize: 11, fontWeight: 600, cursor: 'pointer', '&:hover': { opacity: 0.9 }, transition: 'opacity 0.15s' }}>
            <Tag size={12} /> Print barcode
          </Box>
        )}
        <Box sx={{ display: 'flex', gap: 0.75 }}>
          <Box sx={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 0.5, py: 0.75, borderRadius: 1.5, border: '1px solid var(--rule)', fontSize: 11, fontWeight: 500, color: 'var(--ink-3)', cursor: 'pointer', '&:hover': { borderColor: 'var(--accent)', color: 'var(--accent)' }, transition: 'all 0.15s' }}>
            <Copy size={11} /> Duplicate
          </Box>
          <Box onClick={handleDelete}
            sx={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 0.5, py: 0.75, borderRadius: 1.5, border: '1px solid var(--rule)', fontSize: 11, fontWeight: 500, color: 'var(--ink-3)', cursor: 'pointer', '&:hover': { borderColor: 'rgba(239,68,68,0.6)', color: 'rgba(239,68,68,0.9)' }, transition: 'all 0.15s' }}>
            <Trash2 size={11} /> Delete
          </Box>
        </Box>
      </Box>
    </Box>
  );
}

// ── Metre ruler ───────────────────────────────────────────────────────────────
function Ruler({ length, horizontal, scale, offset: off, zoom }: {
  length: number; horizontal: boolean; scale: number; offset: number; zoom: number;
}) {
  const step   = zoom < 0.6 ? 2 : 1;
  const ticks  = Math.ceil(length / step) + 1;
  const tickPx = step * scale * zoom;
  return (
    <svg width={horizontal ? '100%' : RULER_SIZE} height={horizontal ? RULER_SIZE : '100%'} style={{ display: 'block', flexShrink: 0 }}>
      <rect width="100%" height="100%" fill="var(--bg-2)" />
      {Array.from({ length: ticks }, (_, i) => {
        const pos = off + i * tickPx;
        if (pos < 0) return null;
        const label = `${i * step}m`;
        return horizontal ? (
          <g key={i} transform={`translate(${pos},0)`}>
            <line x1="0" y1={RULER_SIZE - 6} x2="0" y2={RULER_SIZE} stroke="var(--rule)" strokeWidth="1" />
            <text x="3" y={RULER_SIZE - 8} fontSize="8" fill="var(--ink-4)" fontFamily="monospace">{label}</text>
          </g>
        ) : (
          <g key={i} transform={`translate(0,${pos})`}>
            <line x1={RULER_SIZE - 6} y1="0" x2={RULER_SIZE} y2="0" stroke="var(--rule)" strokeWidth="1" />
            <text x="2" y="8" fontSize="8" fill="var(--ink-4)" fontFamily="monospace" transform={`rotate(-90,2,8)`}>{label}</text>
          </g>
        );
      })}
      <line x1={horizontal ? 0 : RULER_SIZE} y1={horizontal ? RULER_SIZE : 0}
        x2={horizontal ? '100%' : RULER_SIZE} y2={horizontal ? RULER_SIZE : '100%'}
        stroke="var(--rule)" strokeWidth="1" />
    </svg>
  );
}

// ── CanvasEditor ──────────────────────────────────────────────────────────────
export function CanvasEditor({ zones, onUpdateZone, onDeleteZone }: CanvasEditorProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [zoom, setZoom]         = useState(1);
  const [offset, setOffset]     = useState({ x: 40, y: 40 });
  const [selected, setSelected] = useState<string | null>(null);
  const [localPositions, setLocalPositions] = useState<Record<string, { x: number; y: number }>>({});
  const [localSizes, setLocalSizes]         = useState<Record<string, { w: number; h: number }>>({});
  // Optimistic placement: zones placed this session before props re-render with new coordinates
  const [placedCoords, setPlacedCoords] = useState<Record<string, { x: number; y: number }>>({});
  const [lastSaved, setLastSaved] = useState<Date | null>(null);

  const dragRef   = useRef<DragState | null>(null);
  const panRef    = useRef<PanState | null>(null);
  const resizeRef = useRef<ResizeState | null>(null);
  const savingRef = useRef<Set<string>>(new Set());
  // Merge prop-positioned zones with optimistically placed zones
  const positionedZones = [
    ...zones.filter(z => z.position_x != null && z.position_y != null),
    ...zones.filter(z => z.position_x == null && placedCoords[z.location_code] != null).map(z => ({
      ...z,
      position_x: placedCoords[z.location_code].x,
      position_y: placedCoords[z.location_code].y,
    })),
  ];
  // Refs for latest values — avoids stale closure captures inside useEffect mousemove handler
  const positionedZonesRef = useRef(positionedZones);
  const localSizesRef      = useRef(localSizes);
  const localPositionsRef  = useRef(localPositions);
  // Sync refs synchronously on every render — avoids stale closure in mousemove handler
  positionedZonesRef.current = positionedZones;
  localSizesRef.current      = localSizes;
  localPositionsRef.current  = localPositions;
  const unpositionedCount = zones.filter(z => z.position_x == null && !placedCoords[z.location_code]).length;
  const selectedZone = selected
    ? positionedZones.find(z => z.location_code === selected) ?? zones.find(z => z.location_code === selected)
    : null;

  const toSvg = useCallback((metres: number) => metres * SCALE * zoom, [zoom]);

  /**
   * Clamp position so zone (code, w, h) doesn't overlap any other zone.
   * warehouse-type zones are frames — excluded from collision.
   * Snaps dragged zone to the nearest non-overlapping edge of each blocker.
   */
  function clampPosition(code: string, x: number, y: number, w: number, h: number): { x: number; y: number } {
    // Frame zones (warehouse/lane/shelf) move freely — only bins are collision-clamped
    const dragged = positionedZonesRef.current.find(z => z.location_code === code);
    if (dragged && (dragged.type === 'warehouse' || dragged.type === 'lane' || dragged.type === 'shelf')) {
      return { x, y };
    }
    let cx = x;
    let cy = y;
    // Multi-pass: repeat until stable or max iterations reached
    // Single-pass misses cascading overlaps at corners where two blockers meet
    for (let pass = 0; pass < 10; pass++) {
      let moved = false;
      for (const z of positionedZones) {
        // warehouse/lane/shelf are container frames — bins sit inside them, no collision
      if (z.location_code === code || z.type === 'warehouse' || z.type === 'lane' || z.type === 'shelf') continue;
        const zx = localPositionsRef.current[z.location_code]?.x ?? parseFloat(String(z.position_x ?? 0));
        const zy = localPositionsRef.current[z.location_code]?.y ?? parseFloat(String(z.position_y ?? 0));
        const zw = localSizesRef.current[z.location_code]?.w ?? parseFloat(String(z.width  ?? 1));
        const zh = localSizesRef.current[z.location_code]?.h ?? parseFloat(String(z.depth  ?? 0.8));
        const TOL = 0.05;
        if (!(cx < zx + zw - TOL && cx + w - TOL > zx && cy < zy + zh - TOL && cy + h - TOL > zy)) continue;
        const snapLeft  = zx - w;
        const snapRight = zx + zw;
        const snapUp    = zy - h;
        const snapDown  = zy + zh;
        const dLeft  = Math.abs(cx - snapLeft);
        const dRight = Math.abs(cx - snapRight);
        const dUp    = Math.abs(cy - snapUp);
        const dDown  = Math.abs(cy - snapDown);
        const minD   = Math.min(dLeft, dRight, dUp, dDown);
        if      (minD === dLeft)  cx = snapV(Math.max(0, snapLeft));
        else if (minD === dRight) cx = snapV(snapRight);
        else if (minD === dUp)    cy = snapV(Math.max(0, snapUp));
        else                      cy = snapV(snapDown);
        moved = true;
      }
      if (!moved) break; // stable — no more overlaps
    }
    return { x: cx, y: cy };
  }

  // ── Drag handlers ──────────────────────────────────────────────────────────
  function onRackMouseDown(e: React.MouseEvent, zone: WarehouseZone) {
    e.stopPropagation();
    setSelected(zone.location_code);
    dragRef.current = {
      locationCode: zone.location_code,
      startMouseX:  e.clientX,
      startMouseY:  e.clientY,
      startPosX:    localPositions[zone.location_code]?.x ?? parseFloat(String(zone.position_x ?? placedCoords[zone.location_code]?.x ?? 0)),
      startPosY:    localPositions[zone.location_code]?.y ?? parseFloat(String(zone.position_y ?? placedCoords[zone.location_code]?.y ?? 0)),
    };
  }

  function onCanvasMouseDown(e: React.MouseEvent) {
    if (dragRef.current) return;
    setSelected(null);
    panRef.current = {
      startMouseX:  e.clientX,
      startMouseY:  e.clientY,
      startOffsetX: offset.x,
      startOffsetY: offset.y,
    };
  }

  useEffect(() => {
    function onMouseMove(e: MouseEvent) {
      // Resize — clamp to nearest blocker edge
      if (resizeRef.current) {
        const r    = resizeRef.current;
        const dxM  = (e.clientX - r.startMouseX) / (SCALE * zoom);
        const dyM  = (e.clientY - r.startMouseY) / (SCALE * zoom);
        const rawW = snapV(Math.max(0.5, r.startW + (r.edge !== 's' ? dxM : 0)));
        const rawH = snapV(Math.max(0.5, r.startD + (r.edge !== 'e' ? dyM : 0)));
        const zone = positionedZonesRef.current.find(z => z.location_code === r.locationCode);
        const curX = localPositionsRef.current[r.locationCode]?.x ?? parseFloat(String(zone?.position_x ?? 0));
        const curY = localPositionsRef.current[r.locationCode]?.y ?? parseFloat(String(zone?.position_y ?? 0));
        // Frame zones resize freely — no collision clamping
        if (zone && (zone.type === 'warehouse' || zone.type === 'lane' || zone.type === 'shelf')) {
          setLocalSizes(prev => ({ ...prev, [r.locationCode]: { w: Math.max(0.5, rawW), h: Math.max(0.5, rawH) } }));
          return;
        }
        let clampedW = rawW;
        let clampedH = rawH;
        for (const z of positionedZonesRef.current) {
          // warehouse/lane/shelf are container frames — bins sit inside them, no collision
          if (z.location_code === r.locationCode || z.type === 'warehouse' || z.type === 'lane' || z.type === 'shelf') continue;
          const zx = localPositionsRef.current[z.location_code]?.x ?? parseFloat(String(z.position_x ?? 0));
          const zy = localPositionsRef.current[z.location_code]?.y ?? parseFloat(String(z.position_y ?? 0));
          const zw = localSizesRef.current[z.location_code]?.w    ?? parseFloat(String(z.width  ?? 1));
          const zh = localSizesRef.current[z.location_code]?.h    ?? parseFloat(String(z.depth  ?? 0.8));
          if (zx > curX + 0.05 && curY < zy + zh - 0.05 && curY + clampedH - 0.05 > zy)
            clampedW = Math.min(clampedW, snapV(zx - curX));
          if (zy > curY + 0.05 && curX < zx + zw - 0.05 && curX + rawW - 0.05 > zx)
            clampedH = Math.min(clampedH, snapV(zy - curY));
        }
        setLocalSizes(prev => ({ ...prev, [r.locationCode]: { w: Math.max(0.5, clampedW), h: Math.max(0.5, clampedH) } }));
        return;
      }
      // Drag — clamped to nearest non-overlapping position
      if (dragRef.current) {
        const d    = dragRef.current;
        const dxM  = (e.clientX - d.startMouseX) / (SCALE * zoom);
        const dyM  = (e.clientY - d.startMouseY) / (SCALE * zoom);
        const rawX = snapV(Math.max(0, d.startPosX + dxM));
        const rawY = snapV(Math.max(0, d.startPosY + dyM));
        const zone = positionedZonesRef.current.find(z => z.location_code === d.locationCode);
        const w    = localSizesRef.current[d.locationCode]?.w ?? parseFloat(String(zone?.width  ?? 1));
        const h    = localSizesRef.current[d.locationCode]?.h ?? parseFloat(String(zone?.depth  ?? 0.8));
        const { x: newX, y: newY } = clampPosition(d.locationCode, rawX, rawY, w, h);
        setLocalPositions(prev => ({ ...prev, [d.locationCode]: { x: newX, y: newY } }));
        return;
      }
      // Pan
      if (panRef.current) {
        const p = panRef.current;
        setOffset({ x: p.startOffsetX + (e.clientX - p.startMouseX), y: p.startOffsetY + (e.clientY - p.startMouseY) });
      }
    }

    async function onMouseUp() {
      if (resizeRef.current) {
        const r     = resizeRef.current;
        const local = localSizesRef.current[r.locationCode];
        if (local && onUpdateZone && !savingRef.current.has(r.locationCode)) {
          savingRef.current.add(r.locationCode);
          try { await onUpdateZone(r.locationCode, { width: local.w, depth: local.h }); setLastSaved(new Date()); }
          finally { savingRef.current.delete(r.locationCode); }
        }
        resizeRef.current = null;
        return;
      }
      if (dragRef.current) {
        const d     = dragRef.current;
        const local = localPositionsRef.current[d.locationCode];
        if (local && onUpdateZone && !savingRef.current.has(d.locationCode)) {
          // Final clamp before persist — guards against any residual overlap from rapid drag
          const zone    = positionedZonesRef.current.find(z => z.location_code === d.locationCode);
          const w       = localSizesRef.current[d.locationCode]?.w ?? parseFloat(String(zone?.width  ?? 1));
          const h       = localSizesRef.current[d.locationCode]?.h ?? parseFloat(String(zone?.depth  ?? 0.8));
          const { x: safeX, y: safeY } = clampPosition(d.locationCode, local.x, local.y, w, h);
          // Update local state to reflect final safe position
          setLocalPositions(prev => ({ ...prev, [d.locationCode]: { x: safeX, y: safeY } }));
          savingRef.current.add(d.locationCode);
          try { await onUpdateZone(d.locationCode, { position_x: safeX, position_y: safeY }); setLastSaved(new Date()); }
          finally { savingRef.current.delete(d.locationCode); }
        }
        dragRef.current = null;
      }
      panRef.current = null;
    }

    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup',   onMouseUp);
    return () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup',   onMouseUp);
    };
  }, [zoom, localPositions, localSizes, onUpdateZone]);

  function onWheel(e: React.WheelEvent) {
    e.preventDefault();
    setZoom(z => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z * (e.deltaY < 0 ? 1.1 : 0.91))));
  }

  const canvasW = toSvg(CANVAS_W);
  const canvasH = toSvg(CANVAS_H);

  return (
    <Box sx={{ display: 'flex', width: '100%', height: 560, border: '1px solid var(--rule)', borderRadius: 2, overflow: 'hidden', bgcolor: 'var(--bg)' }}>

      {/* LEFT — palette */}
      <ComponentPalette
        unpositionedZones={zones.filter(z => z.position_x == null)}
        onPlace={(zone) => {
          const centreX = snapV(Math.max(0, (-offset.x + 200) / (SCALE * zoom)));
          const centreY = snapV(Math.max(0, (-offset.y + 150) / (SCALE * zoom)));
          setPlacedCoords(prev => ({ ...prev, [zone.location_code]: { x: centreX, y: centreY } }));
          onUpdateZone?.(zone.location_code, { position_x: centreX, position_y: centreY });
        }}
      />

      {/* CENTER — canvas */}
      <Box sx={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', bgcolor: 'var(--bg-2)' }}>

        {/* Toolbar */}
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, px: 2, py: 1, borderBottom: '1px solid var(--rule)', bgcolor: 'var(--bg)', flexShrink: 0 }}>
          <Typography sx={{ fontSize: 10, fontWeight: 500, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--ink-4)' }}>
            Floor 1 · {CANVAS_W * CANVAS_H}m² · Top-down
          </Typography>
          <Typography sx={{ fontSize: 10, color: 'var(--ink-4)' }}>·</Typography>
          {lastSaved && (
            <Typography sx={{ fontSize: 10, color: 'var(--ink-4)', fontStyle: 'italic' }}>
              Saved {Math.floor((Date.now() - lastSaved.getTime()) / 60000) < 1 ? 'just now' : `${Math.floor((Date.now() - lastSaved.getTime()) / 60000)}m ago`}
            </Typography>
          )}
          <Typography sx={{ fontSize: 10, color: 'var(--ink-3)' }}>
            {positionedZones.length} components
            {unpositionedCount > 0 && <span style={{ color: 'var(--ink-4)' }}> · {unpositionedCount} unpositioned</span>}
          </Typography>
          {/* 2D/3D toggle stub — Phase 3 activates ThreeRenderer */}
          <Box sx={{ display: 'flex', border: '1px solid var(--rule)', borderRadius: 1.5, overflow: 'hidden', mr: 1 }}>
            {(['2D', '3D'] as const).map((mode) => (
              <Box key={mode} title={mode === '3D' ? 'Three.js renderer — Phase 3' : 'SVG floor plan — current'}
                sx={{ px: 1.25, py: 0.4, fontSize: 10, fontWeight: 600, letterSpacing: '0.04em',
                  cursor: mode === '3D' ? 'not-allowed' : 'default',
                  bgcolor: mode === '2D' ? 'var(--accent)' : 'transparent',
                  color:   mode === '2D' ? '#fff' : 'var(--ink-4)',
                  opacity: mode === '3D' ? 0.5 : 1, transition: 'all 0.15s' }}>
                {mode}
              </Box>
            ))}
          </Box>
          <Box sx={{ ml: 'auto', display: 'flex', alignItems: 'center', gap: 0.5 }}>
            {[{ label: '−', delta: -0.15 }, { label: '+', delta: 0.15 }].map(({ label, delta }) => (
              <Box key={label} onClick={() => setZoom(z => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z + delta)))}
                sx={{ width: 22, height: 22, display: 'flex', alignItems: 'center', justifyContent: 'center', border: '1px solid var(--rule)', borderRadius: 1, cursor: 'pointer', fontSize: 13, color: 'var(--ink-3)', bgcolor: 'var(--bg)', '&:hover': { borderColor: 'var(--accent)', color: 'var(--accent)' } }}>
                {label}
              </Box>
            ))}
            <Box sx={{ px: 1, height: 22, display: 'flex', alignItems: 'center', border: '1px solid var(--rule)', borderRadius: 1, fontSize: 10, color: 'var(--ink-3)', bgcolor: 'var(--bg)', fontFamily: 'monospace', minWidth: 40, justifyContent: 'center' }}>
              {Math.round(zoom * 100)}%
            </Box>
            <Box onClick={() => { setZoom(1); setOffset({ x: 40, y: 40 }); }}
              sx={{ px: 1, height: 22, display: 'flex', alignItems: 'center', border: '1px solid var(--rule)', borderRadius: 1, fontSize: 10, color: 'var(--ink-3)', bgcolor: 'var(--bg)', cursor: 'pointer', '&:hover': { borderColor: 'var(--accent)', color: 'var(--accent)' } }}>
              Reset
            </Box>
          </Box>
        </Box>

        {/* Rulers + SVG */}
        <Box sx={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          <Box sx={{ display: 'flex', flexShrink: 0 }}>
            <Box sx={{ width: RULER_SIZE, height: RULER_SIZE, bgcolor: 'var(--bg-2)', borderRight: '1px solid var(--rule)', borderBottom: '1px solid var(--rule)', flexShrink: 0 }} />
            <Box sx={{ flex: 1, overflow: 'hidden' }}>
              <Ruler length={CANVAS_W} horizontal={true} scale={SCALE} offset={offset.x} zoom={zoom} />
            </Box>
          </Box>
          <Box sx={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
            <Box sx={{ width: RULER_SIZE, flexShrink: 0, overflow: 'hidden' }}>
              <Ruler length={CANVAS_H} horizontal={false} scale={SCALE} offset={offset.y} zoom={zoom} />
            </Box>
            <Box sx={{ flex: 1, overflow: 'hidden', position: 'relative' }}>
              <svg ref={svgRef} width="100%" height="100%"
                style={{ cursor: 'grab', userSelect: 'none', display: 'block' }}
                onMouseDown={onCanvasMouseDown} onWheel={onWheel}>
                <g transform={`translate(${offset.x},${offset.y})`}>
                  <defs>
                    <pattern id="grid-dots" x="0" y="0" width={SCALE * zoom * SNAP} height={SCALE * zoom * SNAP} patternUnits="userSpaceOnUse">
                      <circle cx="1" cy="1" r="1" fill="var(--rule)" opacity="0.5" />
                    </pattern>
                  </defs>
                  <rect x="0" y="0" width={canvasW} height={canvasH} fill="url(#grid-dots)" />
                  <rect x="0" y="0" width={canvasW} height={canvasH} fill="none" stroke="var(--rule)" strokeWidth="1" />

                  {/* Render order: warehouse first (back), then lanes, then bins — SVG painters model */}
                  {[...positionedZones].sort((a, b) => {
                    const order = { warehouse: 0, lane: 1, shelf: 2, bin: 3 };
                    return (order[a.type] ?? 3) - (order[b.type] ?? 3);
                  }).map((zone) => {
                    const lp  = localPositions[zone.location_code];
                    const ls  = localSizes[zone.location_code];
                    const px  = toSvg(lp?.x ?? parseFloat(String(zone.position_x!)));
                    const py  = toSvg(lp?.y ?? parseFloat(String(zone.position_y!)));
                    const pw  = toSvg(ls?.w ?? parseFloat(String(zone.width  ?? 1)));
                    const ph  = toSvg(ls?.h ?? parseFloat(String(zone.depth  ?? 0.8)));
                    // Frame types (lane/warehouse/shelf) use type-based colour regardless of zone_type
                    const colorKey = (zone.type === 'lane' || zone.type === 'warehouse' || zone.type === 'shelf')
                      ? zone.type
                      : (zone.zone_type ?? 'storage');
                    const fill   = ZONE_COLORS[colorKey] ?? ZONE_COLORS.storage;
                    const stroke = ZONE_STROKE[colorKey] ?? ZONE_STROKE.storage;
                    const isSelected = selected === zone.location_code;
                    const isDragging = dragRef.current?.locationCode === zone.location_code;
                    const HANDLE = 6;

                    return (
                      <g key={zone.location_code} transform={`translate(${px},${py})`}
                        onMouseDown={(e) => onRackMouseDown(e, zone)}
                        style={{ cursor: isDragging ? 'grabbing' : 'grab' }}>
                        {isSelected && (
                          <rect x="-2" y="-2" width={pw + 4} height={ph + 4} rx="5"
                            fill="none" stroke="var(--accent)" strokeWidth="2" opacity="0.5" strokeDasharray="4 2" />
                        )}
                        <rect x="0" y="0" width={pw} height={ph} rx="3"
                          fill={fill}
                          stroke={isSelected ? 'var(--accent)' : stroke}
                          strokeWidth={isSelected ? 1.5 : 1}
                          opacity={savingRef.current.has(zone.location_code) ? 0.5 : 1} />
                        {/* Frame label bar — always visible sticky tab at top of lane/warehouse/shelf */}
                        {(zone.type === 'lane' || zone.type === 'warehouse' || zone.type === 'shelf') ? (
                          <>
                            <rect x="0" y="0" width={Math.min(pw, 48)} height={14} rx="3"
                              fill={stroke} opacity={isSelected ? 0.9 : 0.7}
                              style={{ pointerEvents: 'none' }} />
                            <text x="6" y="7" dominantBaseline="middle"
                              fontSize="8" fontFamily="monospace" fontWeight={700}
                              fill="#fff"
                              style={{ pointerEvents: 'none', userSelect: 'none' }}>
                              {zone.location_code}
                            </text>
                          </>
                        ) : (
                          <text x={pw / 2} y={ph / 2} textAnchor="middle" dominantBaseline="middle"
                            fontSize={Math.max(8, Math.min(11, pw * 0.18))}
                            fontFamily="monospace" fontWeight={isSelected ? 700 : 500}
                            fill={isSelected ? 'var(--accent)' : 'var(--ink-2)'}
                            style={{ pointerEvents: 'none', userSelect: 'none' }}>
                            {zone.location_code}
                          </text>
                        )}
                        {zone.rack_levels != null && pw > 28 && (
                          <text x={pw - 4} y={ph - 4} textAnchor="end" dominantBaseline="auto"
                            fontSize="7" fontFamily="monospace" fill={stroke} opacity="0.8"
                            style={{ pointerEvents: 'none' }}>
                            L{zone.rack_levels}
                          </text>
                        )}
                        {/* Resize handles — selected zone only */}
                        {isSelected && (<>
                          <rect x={pw - HANDLE / 2} y={ph / 2 - HANDLE / 2} width={HANDLE} height={HANDLE} rx="1"
                            fill="var(--bg)" stroke="var(--accent)" strokeWidth="1.5" style={{ cursor: 'ew-resize' }}
                            onMouseDown={(e) => { e.stopPropagation(); resizeRef.current = { locationCode: zone.location_code, edge: 'e', startMouseX: e.clientX, startMouseY: e.clientY, startW: ls?.w ?? parseFloat(String(zone.width ?? 1)), startD: ls?.h ?? parseFloat(String(zone.depth ?? 0.8)) }; }} />
                          <rect x={pw / 2 - HANDLE / 2} y={ph - HANDLE / 2} width={HANDLE} height={HANDLE} rx="1"
                            fill="var(--bg)" stroke="var(--accent)" strokeWidth="1.5" style={{ cursor: 'ns-resize' }}
                            onMouseDown={(e) => { e.stopPropagation(); resizeRef.current = { locationCode: zone.location_code, edge: 's', startMouseX: e.clientX, startMouseY: e.clientY, startW: ls?.w ?? parseFloat(String(zone.width ?? 1)), startD: ls?.h ?? parseFloat(String(zone.depth ?? 0.8)) }; }} />
                          <rect x={pw - HANDLE / 2} y={ph - HANDLE / 2} width={HANDLE} height={HANDLE} rx="1"
                            fill="var(--accent)" stroke="var(--accent)" strokeWidth="1.5" style={{ cursor: 'nwse-resize' }}
                            onMouseDown={(e) => { e.stopPropagation(); resizeRef.current = { locationCode: zone.location_code, edge: 'se', startMouseX: e.clientX, startMouseY: e.clientY, startW: ls?.w ?? parseFloat(String(zone.width ?? 1)), startD: ls?.h ?? parseFloat(String(zone.depth ?? 0.8)) }; }} />
                        </>)}
                      </g>
                    );
                  })}
                </g>
              </svg>

              {/* Zone type legend */}
              <Box sx={{ position: 'absolute', bottom: 8, left: 8, display: 'flex', gap: 1, flexWrap: 'wrap', pointerEvents: 'none' }}>
                {Object.entries(ZONE_COLORS).map(([type, fill]) => (
                  <Box key={type} sx={{ display: 'flex', alignItems: 'center', gap: 0.4 }}>
                    <Box sx={{ width: 8, height: 8, borderRadius: 0.4, bgcolor: fill, border: `1px solid ${ZONE_STROKE[type]}` }} />
                    <Typography sx={{ fontSize: 8, fontWeight: 500, letterSpacing: '0.05em', textTransform: 'uppercase', color: 'var(--ink-4)' }}>{type}</Typography>
                  </Box>
                ))}
              </Box>
            </Box>
          </Box>
        </Box>

        {/* Zone tree breadcrumb */}
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0, px: 1, borderTop: '1px solid var(--rule)', bgcolor: 'var(--bg)', flexShrink: 0, overflowX: 'auto', height: 28 }}>
          <Typography sx={{ fontSize: 9, fontWeight: 600, letterSpacing: '0.06em', color: 'var(--ink-4)', textTransform: 'uppercase', mr: 1, flexShrink: 0 }}>
            Tree:
          </Typography>
          {positionedZones.filter(z => z.type === 'lane' || z.type === 'warehouse').map((z, i, arr) => (
            <Box key={z.location_code} sx={{ display: 'flex', alignItems: 'center', flexShrink: 0 }}>
              <Box onClick={() => setSelected(z.location_code)}
                sx={{ px: 1, py: 0.25, borderRadius: 0.75, cursor: 'pointer', fontSize: 10, fontFamily: 'monospace',
                  fontWeight: selected === z.location_code ? 700 : 400,
                  color: selected === z.location_code ? 'var(--accent)' : 'var(--ink-3)',
                  bgcolor: selected === z.location_code ? 'var(--accent-ghost)' : 'transparent',
                  '&:hover': { color: 'var(--accent)' } }}>
                {z.location_code}
              </Box>
              {i < arr.length - 1 && <Typography sx={{ fontSize: 10, color: 'var(--rule)', mx: 0.25 }}>/</Typography>}
            </Box>
          ))}
        </Box>
      </Box>

      {/* RIGHT — inspector */}
      {selectedZone ? (
        <RackInspector zone={selectedZone} onClose={() => setSelected(null)} onUpdateZone={onUpdateZone} onDeleteZone={onDeleteZone} />
      ) : (
        <Box sx={{ width: 220, flexShrink: 0, borderLeft: '1px solid var(--rule)', bgcolor: 'var(--bg)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 1, p: 2 }}>
          <Box sx={{ width: 32, height: 32, borderRadius: 1, border: '1.5px dashed var(--rule)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <Layers size={14} color="var(--ink-4)" />
          </Box>
          <Typography sx={{ fontSize: 11, color: 'var(--ink-4)', textAlign: 'center', lineHeight: 1.4 }}>
            Click a zone to inspect and edit
          </Typography>
        </Box>
      )}
    </Box>
  );
}