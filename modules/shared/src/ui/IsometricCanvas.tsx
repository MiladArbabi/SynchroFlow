// modules/floor-planning/src/ui/components/IsometricCanvas.tsx
/**
 * IsometricCanvas — 2.5D isometric SVG floor plan renderer (Phase 3)
 * -------------------------------------------------------------------
 * Pure SVG isometric projection — no Three.js dependency.
 * Read-only surface — editing remains in 2D mode.
 *
 * Coordinate system (world → screen):
 *   screenX = (worldX - worldY) * TILE_W / 2  + originX
 *   screenY = (worldX + worldY) * TILE_H / 2  - worldZ * LEVEL_H + originY
 *
 * Each zone renders as a 3-face isometric box:
 *   TOP   face — zone_type colour at full opacity
 *   LEFT  face — 70% opacity (shadow)
 *   RIGHT face — 50% opacity (deeper shadow)
 *
 * Frame zones (warehouse/lane/shelf) render as flat floor tiles (z=0).
 * Bins render with height = rack_levels × LEVEL_HEIGHT metres.
 *
 * Render order: painter's algorithm — sort by (x + y) ascending so
 * back zones render first and front zones paint over them correctly.
 */
import { useState, useRef, useCallback, useEffect } from 'react';
import { Box, Typography } from '@mui/material';
import type { WarehouseZone } from './IsometricCanvas.types.js';

// ── IsometricZoneView ─────────────────────────────────────────────────────────
/**
 * Embeddable presentational component — renders a single zone as an isometric box.
 * No pan/zoom/interaction. Intended for product/order detail page embeds.
 * Props:
 *   zone    — the zone to render (must have width, depth, rack_levels)
 *   width   — SVG viewport width in px (default 120)
 *   height  — SVG viewport height in px (default 90)
 */
export interface IsometricZoneViewProps {
  zone: WarehouseZone;
  width?: number;
  height?: number;
}

// ── Constants ────────────────────────────────────────────────────────────────
const ISO_SCALE    = 60;   // px per metre (world scale)
const LEVEL_HEIGHT = 0.5;  // metres per rack level
const TILE_W       = ISO_SCALE;       // width of one metre in screen px
const TILE_H       = TILE_W / 2;     // height of one metre in screen px (2:1 ratio)
const LEVEL_H      = ISO_SCALE * 0.6; // screen px per rack level height

// Zone colours — sourced from --zone-* brand tokens (themes/index.tsx) so the
// canvas, landing page, and OAuth scene stay in lockstep. Alpha math unchanged.
const ZONE_KEYS = ['lane','shelf','warehouse','storage','pick','pack','receive','ship','returns','kitting','quarantine'] as const;

const FILL_A: Record<string, number> = {
  warehouse: 0.15, shelf: 0.20, lane: 0.25, storage: 0.30,
  pick: 0.35, receive: 0.35, ship: 0.35, pack: 0.40,
  returns: 0.40, kitting: 0.40, quarantine: 0.50,
};

const STROKE_A: Record<string, number> = {
  warehouse: 0.4, shelf: 0.5, lane: 0.6, storage: 0.7,
  pick: 0.9, pack: 0.9, receive: 0.9, ship: 0.9,
  returns: 0.9, kitting: 0.9, quarantine: 1.0,
};

function readZoneRGB(key: string): string {
  if (typeof window === 'undefined') return '100,116,139';
  const v = getComputedStyle(document.documentElement)
    .getPropertyValue(`--zone-${key}`).trim();
  return v || '100,116,139';
}

const ZONE_COLORS: Record<string, string> = Object.fromEntries(
  ZONE_KEYS.map(k => [k, `rgba(${readZoneRGB(k)},${FILL_A[k] ?? 0.30})`])
);

const ZONE_STROKE: Record<string, string> = Object.fromEntries(
  ZONE_KEYS.map(k => [k, `rgba(${readZoneRGB(k)},${STROKE_A[k] ?? 0.7})`])
);

// ── Isometric projection ──────────────────────────────────────────────────────
/**
 * Project a 3D world point to 2D screen coordinates.
 * @param wx  world X (metres, rightward)
 * @param wy  world Y (metres, downward/depth)
 * @param wz  world Z (metres, upward height)
 * @param zoom current zoom level
 */
function project(wx: number, wy: number, wz: number, zoom: number, flipped = false): { sx: number; sy: number } {
  const tw = TILE_W * zoom;
  const th = TILE_H * zoom;
  const lh = LEVEL_H * zoom;
  const sx = flipped ? (wy - wx) * tw / 2 : (wx - wy) * tw / 2;
  return {
    sx,
    sy: (wx + wy) * th / 2 - wz * lh,
  };
}

/** Convert 6 projected corners to SVG polygon points string */
function pts(...coords: { sx: number; sy: number }[]): string {
  return coords.map(c => `${c.sx.toFixed(1)},${c.sy.toFixed(1)}`).join(' ');
}

// ── IsometricBox ──────────────────────────────────────────────────────────────
interface BoxProps {
  wx: number; wy: number;       // world position (metres)
  ww: number; wd: number;       // world width/depth (metres)
  wh: number;                   // world height (metres, = rack_levels * LEVEL_HEIGHT)
  colorKey: string;
  isSelected: boolean;
  /** Occupancy 0-1 fraction — overrides fill for bin zones when provided */
  occupancyFraction?: number;
  isFrame: boolean;
  /** Dimmed when a highlight set is active and this zone is not in it */
  isDimmed?: boolean;
  label: string;
  rackLevels: number | null;
  zoom: number;
  flipped: boolean;
  onClick: () => void;
}

function IsometricBox({ wx, wy, ww, wd, wh, colorKey, isSelected, isFrame, isDimmed, label, rackLevels, zoom, onClick, flipped, occupancyFraction }: BoxProps) {
  const baseFill   = ZONE_COLORS[colorKey] ?? ZONE_COLORS.storage;
  const stroke     = ZONE_STROKE[colorKey] ?? ZONE_STROKE.storage;
  const selStroke  = 'var(--accent)';
  // Occupancy overlay: interpolate from empty (blue) → full (accent red) for bins.
  const fillOverride = occupancyFraction != null
    ? occupancyFraction >= 0.85 ? `rgba(${readZoneRGB('quarantine')},0.75)`
    : occupancyFraction >= 0.5  ? `rgba(${readZoneRGB('pack')},0.65)`
    : occupancyFraction > 0     ? `rgba(${readZoneRGB('receive')},0.55)`
    : 'rgba(100,116,139,0.25)'
    : null;

  // Per-level fill: cycle dark→light→default repeating every 3 levels.
  // Achieved by modulating the alpha of the base rgba color.
  // Pattern: level 0 (bottom) = 0.85×, level 1 = 0.55×, level 2 = 1.0× (default), repeat.
  const LEVEL_ALPHA_FACTORS = [0.85, 0.55, 1.0];
  function levelFill(levelIndex: number): string {
    const factor = LEVEL_ALPHA_FACTORS[levelIndex % 3];
    return baseFill.replace(/[\d.]+\)$/, m => `${Math.min(1, parseFloat(m) * factor * 2.5)})`);
  }

  // Apply occupancy overlay for bins; fall back to zone-type color otherwise.
  const fill = fillOverride ?? baseFill;

  // 8 corners of the box in world space → projected
  // Bottom face corners
  const b00 = project(wx,      wy,      0,  zoom, flipped);
  const b10 = project(wx + ww, wy,      0,  zoom, flipped);
  const b11 = project(wx + ww, wy + wd, 0,  zoom, flipped);
  const b01 = project(wx,      wy + wd, 0,  zoom, flipped);
  // Top face corners
  const t00 = project(wx,      wy,      wh, zoom, flipped);
  const t10 = project(wx + ww, wy,      wh, zoom, flipped);
  const t11 = project(wx + ww, wy + wd, wh, zoom, flipped);
  const t01 = project(wx,      wy + wd, wh, zoom, flipped);

  // Darken side faces
  const leftFill   = fill.replace(/[\d.]+\)$/, m => `${Math.min(1, parseFloat(m) * 1.4)})`).replace('rgba', 'rgba').replace(/,[\d.]+\)/, `,${0.55})`);
  const rightFill  = fill.replace(/,[\d.]+\)/, `,${0.40})`);

  const isFlat = wh < 0.01;

  return (
    <g onClick={onClick} style={{ cursor: 'pointer' }}>
      {/* Left and right faces are now rendered as per-level slices below.
          Full-height polygons removed to avoid double-painting over level bands. */}
      {/* Top face */}
      <polygon
        points={pts(t00, t10, t11, t01)}
        fill={fill}
        stroke={isSelected ? selStroke : stroke}
        strokeWidth={isSelected ? 2 : 1}
        opacity={isDimmed ? 0.25 : isFlat ? 0.6 : 1}
      />
      {/* Selection highlight */}
      {isSelected && (
        <polygon
          points={pts(t00, t10, t11, t01)}
          fill="none"
          stroke={selStroke}
          strokeWidth="2"
          strokeDasharray="4 2"
          opacity="0.8"
        />
      )}
      {/* Label on top face */}
      {(() => {
        const centre = project(wx + ww / 2, wy + wd / 2, wh + 0.05, zoom, flipped);
        const fontSize = Math.max(7, Math.min(10, TILE_W * zoom * ww * 0.12));
        return (
          <text
            x={centre.sx} y={centre.sy}
            textAnchor="middle" dominantBaseline="middle"
            fontSize={fontSize}
            fontFamily="monospace" fontWeight={isSelected ? 700 : 600}
            fill={isSelected ? 'var(--accent)' : isFrame ? `rgba(${readZoneRGB('lane')},0.9)` : 'var(--ink)'}
            style={{ pointerEvents: 'none', userSelect: 'none' }}>
            {label}
          </text>
        );
      })()}
      {/* Rack level bands — each level rendered as a distinct filled slice on left+right faces.
          Alpha cycles dark→light→default every 3 levels so operators can count levels visually. */}
      {!isFlat && rackLevels != null && rackLevels > 1 && Array.from({ length: rackLevels }, (_, i) => {
        const z0 = i * LEVEL_HEIGHT;
        const z1 = (i + 1) * LEVEL_HEIGHT;
        const lFill = levelFill(i);
        const lFillDark  = lFill.replace(/[\d.]+\)$/, m => `${Math.min(1, parseFloat(m) * 0.75)})`);
        // Left face slice corners
        const ll0 = project(wx,      wy + wd, z0, zoom, flipped);
        const ll1 = project(wx + ww, wy + wd, z0, zoom, flipped);
        const lu0 = project(wx,      wy + wd, z1, zoom, flipped);
        const lu1 = project(wx + ww, wy + wd, z1, zoom, flipped);
        // Right face slice corners
        const rl0 = project(wx + ww, wy,      z0, zoom, flipped);
        const rl1 = project(wx + ww, wy + wd, z0, zoom, flipped);
        const ru0 = project(wx + ww, wy,      z1, zoom, flipped);
        const ru1 = project(wx + ww, wy + wd, z1, zoom, flipped);
        return (
          <g key={i}>
            <polygon points={pts(ll0, ll1, lu1, lu0)} fill={lFill}     stroke={stroke} strokeWidth="0.4" />
            <polygon points={pts(rl0, rl1, ru1, ru0)} fill={lFillDark} stroke={stroke} strokeWidth="0.4" />
          </g>
        );
      })}
    </g>
  );
}

// ── IsometricCanvas ───────────────────────────────────────────────────────────
export interface IsometricCanvasProps {
  zones: WarehouseZone[];
  onSelect?: (locationCode: string | null) => void;
  filteredCodes?: Set<string>;
  highlightZoneTypes?: Set<string>;
  occupancy?: Record<string, { on_hand_quantity: number }>;
  showFloor?: boolean;
  showBins?: boolean;
  /** Override default zoom for embedded contexts (default: 0.9) */
  initialZoom?: number;
  /** Override default pan offset for embedded contexts (default: { x:420, y: 120 }) */
  initialOffset?: { x: number; y: number };
  /** Auto-fit the whole layout to the container on mount/resize/zone-change (default: true) */
  autoFit?: boolean;
  /** Auto-fit density multiplier. Higher = less internal deadspace. Default preserves existing canvas behavior. */
  fitPadding?: number;
}
export function IsometricCanvas({ 
    zones, 
    onSelect, 
    filteredCodes, 
    highlightZoneTypes, 
    occupancy, 
    showFloor = true, 
    showBins = true, 
    initialZoom = 0.9, 
    initialOffset = { x: 420, y: 120 },
    autoFit = true,
    fitPadding = 0.85  }: 
  IsometricCanvasProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [zoom, setZoom]         = useState(initialZoom);
  const [offset, setOffset]     = useState(initialOffset);
  const [selected, setSelected] = useState<string | null>(null);
  const [flipped, setFlipped]   = useState(false);
  const [size, setSize]         = useState({ w: 0, h: 0 });
  const panRef = useRef<{ startX: number; startY: number; startOX: number; startOY: number } | null>(null);
  const zoomRef   = useRef(zoom);
  const offsetRef = useRef(offset);
  zoomRef.current   = zoom;
  offsetRef.current = offset;

  // Apply zone filter rail selection; if no filter provided, show all positioned zones.
  const isFrame = (z: WarehouseZone) => z.type === 'warehouse' || z.type === 'lane' || z.type === 'shelf';
  const positionedZones = zones.filter(z =>
    z.position_x != null && z.position_y != null &&
    (filteredCodes == null || filteredCodes.has(z.location_code)) &&
    (isFrame(z) ? showFloor : showBins)
  );

  // Painter's algorithm: sort by (position_x + position_y) ascending — back zones first
  // Painter's algorithm: ascending = back-to-front for standard view.
  // Flipped view mirrors the projection axis so sort must reverse to maintain correct occlusion.
  const sorted = [...positionedZones].sort((a, b) => {
    const da = parseFloat(String(a.position_x ?? 0)) + parseFloat(String(a.position_y ?? 0));
    const db = parseFloat(String(b.position_x ?? 0)) + parseFloat(String(b.position_y ?? 0));
    const typeOrder = { warehouse: 0, lane: 1, shelf: 2, bin: 3 };
    if (Math.abs(da - db) < 0.01) return (typeOrder[a.type] ?? 3) - (typeOrder[b.type] ?? 3);
    return flipped ? db - da : da - db;
  });

  function handleSelect(code: string) {
    const next = selected === code ? null : code;
    setSelected(next);
    onSelect?.(next);
  }

  function onCanvasMouseDown(e: React.MouseEvent) {
    panRef.current = { startX: e.clientX, startY: e.clientY, startOX: offset.x, startOY: offset.y };
  }

  useEffect(() => {
    function onMouseMove(e: MouseEvent) {
      if (!panRef.current) return;
      setOffset({
        x: panRef.current.startOX + (e.clientX - panRef.current.startX),
        y: panRef.current.startOY + (e.clientY - panRef.current.startY),
      });
    }
    function onMouseUp() { panRef.current = null; }
    function onWheel(e: WheelEvent) {
      e.preventDefault();
      setOffset(prev => ({
        x: prev.x - (e.shiftKey ? e.deltaY : e.deltaX) * 0.8,
        y: prev.y - (e.shiftKey ? 0 : e.deltaY) * 0.8,
      }));
    }
    const svgEl = svgRef.current;
    if (svgEl) svgEl.addEventListener('wheel', onWheel, { passive: false });
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
    return () => {
      if (svgEl) svgEl.removeEventListener('wheel', onWheel);
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };
  }, []);

  // Track the real rendered size of the canvas so the fit adapts to whatever
  // column / aspect ratio it lands in (Order Flow, detail embeds, etc.).
  useEffect(() => {
    const el = svgRef.current;
    if (!el) return;
    const ro = new ResizeObserver(entries => {
      const r = entries[0]?.contentRect;
      if (!r) return;
      const w = Math.round(r.width);
      const h = Math.round(r.height);
      setSize(prev => (prev.w === w && prev.h === h ? prev : { w, h }));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Signature of what's drawn — refit only when the layout actually changes,
  // never on every render (so manual pan/zoom survives between changes).
  const zoneSig = positionedZones
    .map(z => `${z.location_code}:${z.position_x},${z.position_y},${z.width},${z.depth},${z.rack_levels ?? ''}`)
    .join('|');

  // Auto-fit: centre + contain the whole warehouse in the current container.
  // Projection scales linearly with zoom and has no additive origin, so we
  // project all corners at zoom 1, take the screen-space bbox, then solve for
  // the zoom + offset that fits it with a margin.
  useEffect(() => {
    if (!autoFit || size.w === 0 || size.h === 0 || positionedZones.length === 0) return;

    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const z of positionedZones) {
      const wx = parseFloat(String(z.position_x ?? 0));
      const wy = parseFloat(String(z.position_y ?? 0));
      const ww = parseFloat(String(z.width  ?? 1));
      const wd = parseFloat(String(z.depth  ?? 0.5));
      const wh = isFrame(z) ? 0 : (z.rack_levels ?? 1) * LEVEL_HEIGHT;
      const corners: Array<[number, number, number]> = [
        [wx, wy, 0], [wx + ww, wy, 0], [wx + ww, wy + wd, 0], [wx, wy + wd, 0],
        [wx, wy, wh], [wx + ww, wy, wh], [wx + ww, wy + wd, wh], [wx, wy + wd, wh],
      ];
      for (const [px, py, pz] of corners) {
        const { sx, sy } = project(px, py, pz, 1, flipped);
        if (sx < minX) minX = sx;
        if (sx > maxX) maxX = sx;
        if (sy < minY) minY = sy;
        if (sy > maxY) maxY = sy;
      }
    }

    const bboxW = Math.max(1, maxX - minX);
    const bboxH = Math.max(1, maxY - minY);
    const fitZoom = Math.min(2.5, Math.max(0.3, Math.min(size.w / bboxW, size.h / bboxH) * fitPadding));

    const cx = ((minX + maxX) / 2) * fitZoom;
    const cy = ((minY + maxY) / 2) * fitZoom;
    setZoom(fitZoom);
    setOffset({ x: size.w / 2 - cx, y: size.h / 2 - cy });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoFit, size.w, size.h, flipped, zoneSig]);

  return (
    <Box sx={{ display: 'flex', width: '100%', height: '100%', position: 'relative', overflow: 'hidden', bgcolor: 'var(--bg-2)' }}>
      <svg ref={svgRef} width="100%" height="100%"
        style={{ cursor: 'grab', userSelect: 'none', display: 'block' }}
        onMouseDown={onCanvasMouseDown}>
        <g transform={`translate(${offset.x},${offset.y})`}>
          {sorted.map((zone) => {
            const wx = parseFloat(String(zone.position_x ?? 0));
            const wy = parseFloat(String(zone.position_y ?? 0));
            const ww = parseFloat(String(zone.width  ?? 1));
            const wd = parseFloat(String(zone.depth  ?? 0.5));
            const isFrame = zone.type === 'warehouse' || zone.type === 'lane' || zone.type === 'shelf';
            const rackLevels = zone.rack_levels ?? null;
            const wh = isFrame ? 0 : (rackLevels ?? 1) * LEVEL_HEIGHT;
            const colorKey = isFrame ? zone.type : (zone.zone_type ?? 'storage');
            // Occupancy fraction: bins only. Capacity = rack_levels × 10 units (fallback 10).
            const occ = !isFrame && occupancy ? occupancy[zone.location_code] : undefined;
            const capacity = (zone.rack_levels ?? 1) * 10;
            const occupancyFraction = occ != null ? Math.min(1, occ.on_hand_quantity / capacity) : undefined;
            return (
              <IsometricBox
                key={zone.location_code}
                wx={wx} wy={wy} ww={ww} wd={wd} wh={wh}
                colorKey={colorKey}
                isSelected={selected === zone.location_code}
                isDimmed={
                  highlightZoneTypes != null &&
                  highlightZoneTypes.size > 0 &&
                  !isFrame &&
                  !highlightZoneTypes.has(zone.zone_type ?? '')
                }
                isFrame={isFrame}
                label={zone.location_code}
                rackLevels={rackLevels}
                zoom={zoom}
                flipped={flipped}
                onClick={() => handleSelect(zone.location_code)}
                occupancyFraction={occupancyFraction}
              />
            );
          })}
        </g>
      </svg>

      {/* Zoom controls */}
      <Box sx={{ position: 'absolute', bottom: 12, right: 12, display: 'flex', flexDirection: 'column', gap: 0.5 }}>
        {[{ label: '+', delta: 0.15 }, { label: '−', delta: -0.15 }].map(({ label, delta }) => (
          <Box key={label} onClick={() => setZoom(z => Math.min(2.5, Math.max(0.3, z + delta)))}
            sx={{ width: 28, height: 28, display: 'flex', alignItems: 'center', justifyContent: 'center',
              border: '1px solid var(--rule)', borderRadius: 1, cursor: 'pointer', fontSize: 16,
              color: 'var(--ink-3)', bgcolor: 'var(--bg)', '&:hover': { borderColor: 'var(--accent)', color: 'var(--accent)' } }}>
            {label}
          </Box>
        ))}
       <Box onClick={() => { setZoom(0.9); setOffset({ x: 420, y: 120 }); }}
          sx={{ px: 0.5, height: 22, display: 'flex', alignItems: 'center', justifyContent: 'center',
            border: '1px solid var(--rule)', borderRadius: 1, fontSize: 9, color: 'var(--ink-4)',
            bgcolor: 'var(--bg)', cursor: 'pointer', fontFamily: 'monospace',
            '&:hover': { borderColor: 'var(--accent)', color: 'var(--accent)' } }}>
          Reset
        </Box>
        {/* Angle preset toggle */}
        <Box onClick={() => { setFlipped(f => !f); setOffset({ x: 420, y: 120 }); }}
          title={flipped ? 'Switch to standard view' : 'Switch to mirrored view'}
          sx={{ px: 0.5, height: 22, display: 'flex', alignItems: 'center', justifyContent: 'center',
            border: '1px solid var(--rule)', borderRadius: 1, fontSize: 9,
            color: flipped ? 'var(--accent)' : 'var(--ink-4)',
            borderColor: flipped ? 'var(--accent)' : 'var(--rule)',
            bgcolor: 'var(--bg)', cursor: 'pointer', fontFamily: 'monospace',
            '&:hover': { borderColor: 'var(--accent)', color: 'var(--accent)' } }}>
          {flipped ? '↙' : '↗'}
        </Box>
      </Box>

      {/* Legend */}
      <Box sx={{ position: 'absolute', top: 8, right: 8, display: 'flex', flexDirection: 'column', gap: 0.5,
        bgcolor: 'var(--bg)', border: '1px solid var(--rule)', borderRadius: 1.5, p: 1, opacity: 0.85 }}>
        <Typography sx={{ fontSize: 8, fontWeight: 600, color: 'var(--ink-4)', mb: 0.25 }}>FACES</Typography>
        {[{ label: 'Top', opacity: '100%' }, { label: 'Left', opacity: '70%' }, { label: 'Right', opacity: '50%' }].map(f => (
          <Box key={f.label} sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
            <Box sx={{ width: 10, height: 6, bgcolor: `rgba(${readZoneRGB('pick')},1)`, opacity: f.label === 'Top' ? 1 : f.label === 'Left' ? 0.7 : 0.5, borderRadius: 0.25 }} />
            <Typography sx={{ fontSize: 8, color: 'var(--ink-4)' }}>{f.label} · {f.opacity}</Typography>
          </Box>
        ))}
      </Box>
    </Box>
  );
}

export function IsometricZoneView({ zone, width = 120, height = 90 }: IsometricZoneViewProps) {
  const ww = parseFloat(String(zone.width  ?? 1));
  const wd = parseFloat(String(zone.depth  ?? 0.5));
  const wh = (zone.rack_levels ?? 1) * LEVEL_HEIGHT;
  const isFrame = zone.type === 'warehouse' || zone.type === 'lane' || zone.type === 'shelf';
  const colorKey = isFrame ? zone.type : (zone.zone_type ?? 'storage');

  // Fixed zoom to fit zone in viewport — scale to the smaller axis
  const zoom = Math.min((width * 0.5) / ((ww + wd) * TILE_W / 2), (height * 0.6) / ((ww + wd) * TILE_H / 2 + wh * LEVEL_H));

  // Centre the box in the viewport: project the centre bottom of the bounding diamond
  const cx = width  / 2;
  const cy = height * 0.65;

  // Render at world origin (0,0) then translate to centre via SVG transform
  const originPt = project(0, 0, 0, zoom);

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      xmlns="http://www.w3.org/2000/svg"
      style={{ display: 'block', overflow: 'visible' }}
    >
      <g transform={`translate(${cx - originPt.sx}, ${cy - originPt.sy})`}>
        <IsometricBox
          wx={0} wy={0}
          ww={ww} wd={wd} wh={wh}
          colorKey={colorKey}
          isSelected={false}
          isFrame={isFrame}
          label={zone.location_code}
          rackLevels={zone.rack_levels ?? null}
          zoom={zoom}
          flipped={false}
          onClick={() => {}}
        />
      </g>
    </svg>
  );
}