// modules/floor-planning/src/ui/components/CanvasEditor.tsx
/**
 * CanvasEditor — 2D SVG floor plan editor (Phase 2)
 * ---------------------------------------------------
 * Renders warehouse_locations as positioned footprints on a free-form canvas.
 * Coordinates are in metres; rendered at SCALE px/m.
 *
 * Interactions:
 *   - Click rack    → select (shows RackInspector)
 *   - Drag rack     → reposition, writes position_x/y via onUpdateZone on drag-end
 *   - Drag canvas   → pan
 *   - Scroll        → zoom (Ctrl+scroll) or pan (scroll)
 *
 * Phase 3: same WarehouseLocation data feeds Three.js renderer unchanged.
 */
import { useState, useRef, useCallback, useEffect } from 'react';
import { Box, Typography, Divider, Chip, IconButton, Paper } from '@mui/material';
import { X, Move, RotateCw, Layers } from 'lucide-react';
import type { WarehouseZone } from '../pages/FloorPlanningModuleFT2.js';

// ── Constants ────────────────────────────────────────────────────────────────
const SCALE         = 60;   // pixels per metre
const SNAP          = 0.5;  // snap grid in metres
const MIN_ZOOM      = 0.4;
const MAX_ZOOM      = 3.0;
const CANVAS_W      = 20;   // metres — virtual canvas width
const CANVAS_H      = 15;   // metres — virtual canvas height

// Zone type → fill colour (all via opacity on accent or fixed semantic tokens)
const ZONE_COLORS: Record<string, string> = {
  pick:        'rgba(99,102,241,0.18)',
  pack:        'rgba(245,158,11,0.18)',
  receive:     'rgba(34,197,94,0.18)',
  ship:        'rgba(59,130,246,0.18)',
  returns:     'rgba(239,68,68,0.18)',
  quarantine:  'rgba(239,68,68,0.32)',
  kitting:     'rgba(168,85,247,0.18)',
  storage:     'rgba(156,163,175,0.14)',
};

const ZONE_STROKE: Record<string, string> = {
  pick:        'rgba(99,102,241,0.6)',
  pack:        'rgba(245,158,11,0.6)',
  receive:     'rgba(34,197,94,0.6)',
  ship:        'rgba(59,130,246,0.6)',
  returns:     'rgba(239,68,68,0.6)',
  quarantine:  'rgba(239,68,68,0.9)',
  kitting:     'rgba(168,85,247,0.6)',
  storage:     'rgba(156,163,175,0.4)',
};

function snap(v: number): number {
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
}

// ── RackInspector ────────────────────────────────────────────────────────────
function RackInspector({ zone, onClose }: { zone: WarehouseZone; onClose: () => void }) {
  const zoneColor = ZONE_STROKE[zone.zone_type ?? 'storage'] ?? ZONE_STROKE.storage;
  return (
    <Paper
      variant="outlined"
      sx={{
        position: 'absolute', top: 12, right: 12, width: 220, zIndex: 10,
        p: 2, borderRadius: 2, bgcolor: 'var(--bg)',
        boxShadow: '0 4px 24px rgba(0,0,0,0.10)',
      }}
    >
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1.5 }}>
        <Typography sx={{ fontSize: 10, fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--ink-4)' }}>
          Selected
        </Typography>
        <IconButton size="small" onClick={onClose} sx={{ color: 'var(--ink-4)' }}>
          <X size={13} />
        </IconButton>
      </Box>

      <Typography sx={{ fontFamily: 'monospace', fontSize: 18, fontWeight: 700, color: 'var(--ink)', lineHeight: 1.2, mb: 0.5 }}>
        {zone.location_code}
      </Typography>

      <Box sx={{ display: 'flex', gap: 0.75, mb: 2, flexWrap: 'wrap' }}>
        <Chip label={zone.type} size="small" sx={{ fontSize: 10, height: 20 }} />
        {zone.zone_type && (
          <Chip
            label={zone.zone_type}
            size="small"
            sx={{ fontSize: 10, height: 20, bgcolor: ZONE_COLORS[zone.zone_type] ?? 'transparent', color: zoneColor, border: `1px solid ${zoneColor}` }}
          />
        )}
      </Box>

      <Divider sx={{ mb: 1.5 }} />

      {/* Dimensions */}
      <Typography sx={{ fontSize: 10, fontWeight: 500, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--ink-4)', mb: 1 }}>
        Dimensions
      </Typography>
      <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 1, mb: 1.5 }}>
        {[
          { label: 'W',  value: zone.width != null    ? `${zone.width}m`       : '—' },
          { label: 'D',  value: zone.depth != null    ? `${zone.depth}m`       : '—' },
          { label: 'X',  value: zone.position_x != null ? `${zone.position_x}m` : '—' },
          { label: 'Y',  value: zone.position_y != null ? `${zone.position_y}m` : '—' },
        ].map(({ label, value }) => (
          <Box key={label} sx={{ p: 1, bgcolor: 'var(--bg-2)', borderRadius: 1 }}>
            <Typography sx={{ fontSize: 9, fontWeight: 600, letterSpacing: '0.08em', color: 'var(--ink-4)', textTransform: 'uppercase' }}>{label}</Typography>
            <Typography sx={{ fontSize: 13, fontWeight: 600, fontFamily: 'monospace', color: 'var(--ink)' }}>{value}</Typography>
          </Box>
        ))}
      </Box>

      <Divider sx={{ mb: 1.5 }} />

      {/* Rack info */}
      <Box sx={{ display: 'flex', gap: 2 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
          <Layers size={12} color="var(--ink-4)" />
          <Typography sx={{ fontSize: 11, color: 'var(--ink-3)' }}>
            {zone.rack_levels ?? '—'} levels
          </Typography>
        </Box>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
          <RotateCw size={12} color="var(--ink-4)" />
          <Typography sx={{ fontSize: 11, color: 'var(--ink-3)' }}>
            {zone.orientation ?? 0}°
          </Typography>
        </Box>
      </Box>

      {zone.parent_location_code && (
        <Typography sx={{ fontSize: 10, color: 'var(--ink-4)', mt: 1.5 }}>
          Parent: <span style={{ fontFamily: 'monospace' }}>{zone.parent_location_code}</span>
        </Typography>
      )}

      <Box sx={{ mt: 2, pt: 1.5, borderTop: '1px solid var(--rule)' }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
          <Move size={11} color="var(--ink-4)" />
          <Typography sx={{ fontSize: 10, color: 'var(--ink-4)', fontStyle: 'italic' }}>
            Drag to reposition
          </Typography>
        </Box>
      </Box>
    </Paper>
  );
}

// ── CanvasEditor ─────────────────────────────────────────────────────────────
export function CanvasEditor({ zones, onUpdateZone }: CanvasEditorProps) {
  const svgRef                  = useRef<SVGSVGElement>(null);
  const [zoom, setZoom]         = useState(1);
  const [offset, setOffset]     = useState({ x: 24, y: 24 });
  const [selected, setSelected] = useState<string | null>(null);
  // Local position overrides while dragging — avoids prop re-render lag
  const [localPositions, setLocalPositions] = useState<Record<string, { x: number; y: number }>>({});

  const dragRef = useRef<DragState | null>(null);
  const panRef  = useRef<PanState | null>(null);
  const savingRef = useRef<Set<string>>(new Set());

  // Only render zones that have coordinates
  const positionedZones = zones.filter(z => z.position_x != null && z.position_y != null);
  const unpositionedCount = zones.filter(z => z.position_x == null).length;

  const selectedZone = selected
    ? zones.find(z => z.location_code === selected)
    : null;

  // ── Coordinate helpers ───────────────────────────────────────────────────
  const toSvg = useCallback((metres: number) => metres * SCALE * zoom, [zoom]);

  function svgPoint(e: React.MouseEvent): { x: number; y: number } {
    const rect = svgRef.current!.getBoundingClientRect();
    return {
      x: (e.clientX - rect.left - offset.x) / (SCALE * zoom),
      y: (e.clientY - rect.top  - offset.y) / (SCALE * zoom),
    };
  }

  // ── Drag handlers ────────────────────────────────────────────────────────
  function onRackMouseDown(e: React.MouseEvent, zone: WarehouseZone) {
    e.stopPropagation();
    setSelected(zone.location_code);
    dragRef.current = {
      locationCode: zone.location_code,
      startMouseX:  e.clientX,
      startMouseY:  e.clientY,
      startPosX:    localPositions[zone.location_code]?.x ?? zone.position_x!,
      startPosY:    localPositions[zone.location_code]?.y ?? zone.position_y!,
    };
  }

  // ── Pan handlers ─────────────────────────────────────────────────────────
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
      // Rack drag
      if (dragRef.current) {
        const d = dragRef.current;
        const dxM = (e.clientX - d.startMouseX) / (SCALE * zoom);
        const dyM = (e.clientY - d.startMouseY) / (SCALE * zoom);
        const newX = snap(Math.max(0, d.startPosX + dxM));
        const newY = snap(Math.max(0, d.startPosY + dyM));
        setLocalPositions(prev => ({ ...prev, [d.locationCode]: { x: newX, y: newY } }));
        return;
      }
      // Canvas pan
      if (panRef.current) {
        const p = panRef.current;
        setOffset({
          x: p.startOffsetX + (e.clientX - p.startMouseX),
          y: p.startOffsetY + (e.clientY - p.startMouseY),
        });
      }
    }

    async function onMouseUp() {
      if (dragRef.current) {
        const d    = dragRef.current;
        const local = localPositions[d.locationCode];
        if (local && onUpdateZone && !savingRef.current.has(d.locationCode)) {
          savingRef.current.add(d.locationCode);
          try {
            await onUpdateZone(d.locationCode, { position_x: local.x, position_y: local.y });
          } finally {
            savingRef.current.delete(d.locationCode);
          }
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
  }, [zoom, localPositions, onUpdateZone]);

  // ── Zoom on scroll ───────────────────────────────────────────────────────
  function onWheel(e: React.WheelEvent) {
    e.preventDefault();
    const factor = e.deltaY < 0 ? 1.1 : 0.91;
    setZoom(z => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z * factor)));
  }

  // ── Render ───────────────────────────────────────────────────────────────
  const canvasW = toSvg(CANVAS_W);
  const canvasH = toSvg(CANVAS_H);

  return (
    <Box sx={{ position: 'relative', width: '100%', height: 520, bgcolor: 'var(--bg-2)', borderRadius: 2, border: '1px solid var(--rule)', overflow: 'hidden' }}>

      {/* Toolbar */}
      <Box sx={{ position: 'absolute', top: 10, left: 10, zIndex: 10, display: 'flex', alignItems: 'center', gap: 1 }}>
        <Typography sx={{ fontSize: 10, fontWeight: 500, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--ink-4)' }}>
          Canvas · {positionedZones.length} placed
          {unpositionedCount > 0 && ` · ${unpositionedCount} unpositioned`}
        </Typography>
        <Box sx={{ display: 'flex', gap: 0.5, ml: 1 }}>
          {[{ label: '−', delta: -0.2 }, { label: '+', delta: 0.2 }].map(({ label, delta }) => (
            <Box
              key={label}
              onClick={() => setZoom(z => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z + delta)))}
              sx={{ width: 24, height: 24, display: 'flex', alignItems: 'center', justifyContent: 'center', border: '1px solid var(--rule)', borderRadius: 1, cursor: 'pointer', fontSize: 14, color: 'var(--ink-3)', bgcolor: 'var(--bg)', '&:hover': { borderColor: 'var(--accent)', color: 'var(--accent)' } }}
            >
              {label}
            </Box>
          ))}
          <Box sx={{ px: 1, height: 24, display: 'flex', alignItems: 'center', border: '1px solid var(--rule)', borderRadius: 1, fontSize: 11, color: 'var(--ink-3)', bgcolor: 'var(--bg)', fontFamily: 'monospace' }}>
            {Math.round(zoom * 100)}%
          </Box>
          <Box
            onClick={() => { setZoom(1); setOffset({ x: 24, y: 24 }); }}
            sx={{ px: 1, height: 24, display: 'flex', alignItems: 'center', border: '1px solid var(--rule)', borderRadius: 1, fontSize: 10, color: 'var(--ink-3)', bgcolor: 'var(--bg)', cursor: 'pointer', '&:hover': { borderColor: 'var(--accent)', color: 'var(--accent)' } }}
          >
            Reset
          </Box>
        </Box>
      </Box>

      {/* Zone type legend */}
      <Box sx={{ position: 'absolute', bottom: 10, left: 10, zIndex: 10, display: 'flex', gap: 1.5, flexWrap: 'wrap' }}>
        {Object.entries(ZONE_COLORS).map(([type, fill]) => (
          <Box key={type} sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
            <Box sx={{ width: 10, height: 10, borderRadius: 0.5, bgcolor: fill, border: `1px solid ${ZONE_STROKE[type]}` }} />
            <Typography sx={{ fontSize: 9, fontWeight: 500, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--ink-4)' }}>{type}</Typography>
          </Box>
        ))}
      </Box>

      {/* SVG Canvas */}
      <svg
        ref={svgRef}
        width="100%"
        height="100%"
        style={{ cursor: panRef.current ? 'grabbing' : 'grab', userSelect: 'none' }}
        onMouseDown={onCanvasMouseDown}
        onWheel={onWheel}
      >
        <g transform={`translate(${offset.x},${offset.y})`}>

          {/* Grid dots */}
          <defs>
            <pattern id="grid-dots" x="0" y="0" width={SCALE * zoom * SNAP} height={SCALE * zoom * SNAP} patternUnits="userSpaceOnUse">
              <circle cx="1" cy="1" r="1" fill="var(--rule)" opacity="0.6" />
            </pattern>
          </defs>
          <rect x="0" y="0" width={canvasW} height={canvasH} fill="url(#grid-dots)" rx="4" />

          {/* Canvas border */}
          <rect x="0" y="0" width={canvasW} height={canvasH} fill="none" stroke="var(--rule)" strokeWidth="1" rx="4" />

          {/* Zones */}
          {positionedZones.map((zone) => {
            const lp      = localPositions[zone.location_code];
            const px      = toSvg(lp?.x ?? zone.position_x!);
            const py      = toSvg(lp?.y ?? zone.position_y!);
            const pw      = toSvg(zone.width  ?? 1);
            const ph      = toSvg(zone.depth  ?? 0.8);
            const fill    = ZONE_COLORS[zone.zone_type ?? 'storage']  ?? ZONE_COLORS.storage;
            const stroke  = ZONE_STROKE[zone.zone_type ?? 'storage']  ?? ZONE_STROKE.storage;
            const isSelected = selected === zone.location_code;
            const isSaving   = savingRef.current.has(zone.location_code);
            const isDragging = dragRef.current?.locationCode === zone.location_code;

            return (
              <g
                key={zone.location_code}
                transform={`translate(${px},${py})`}
                onMouseDown={(e) => onRackMouseDown(e, zone)}
                style={{ cursor: isDragging ? 'grabbing' : 'grab' }}
              >
                {/* Shadow on selected */}
                {isSelected && (
                  <rect x="-2" y="-2" width={pw + 4} height={ph + 4} rx="5" fill="none"
                    stroke="var(--accent)" strokeWidth="2" opacity="0.4" strokeDasharray="4 2" />
                )}
                {/* Rack footprint */}
                <rect
                  x="0" y="0" width={pw} height={ph} rx="3"
                  fill={fill}
                  stroke={isSelected ? 'var(--accent)' : stroke}
                  strokeWidth={isSelected ? 1.5 : 1}
                  opacity={isSaving ? 0.5 : 1}
                />
                {/* Location code label */}
                <text
                  x={pw / 2} y={ph / 2}
                  textAnchor="middle" dominantBaseline="middle"
                  fontSize={Math.max(8, Math.min(11, pw * 0.18))}
                  fontFamily="monospace"
                  fontWeight={isSelected ? 700 : 500}
                  fill={isSelected ? 'var(--accent)' : 'var(--ink-2)'}
                  style={{ pointerEvents: 'none', userSelect: 'none' }}
                >
                  {zone.location_code}
                </text>
                {/* rack_levels badge */}
                {zone.rack_levels != null && pw > 28 && (
                  <text
                    x={pw - 4} y={ph - 4}
                    textAnchor="end" dominantBaseline="auto"
                    fontSize="7" fontFamily="monospace"
                    fill={stroke} opacity="0.8"
                    style={{ pointerEvents: 'none' }}
                  >
                    L{zone.rack_levels}
                  </text>
                )}
              </g>
            );
          })}
        </g>
      </svg>

      {/* Inspector panel */}
      {selectedZone && (
        <RackInspector zone={selectedZone} onClose={() => setSelected(null)} />
      )}
    </Box>
  );
}