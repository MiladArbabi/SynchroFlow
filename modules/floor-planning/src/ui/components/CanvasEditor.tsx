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
import { Box, Typography, Divider, Chip, IconButton, Paper, TextField, Dialog, DialogTitle, DialogActions, Button, ToggleButton, ToggleButtonGroup } from '@mui/material';
import { X, Layers, RotateCw, Copy, Trash2, Tag, Settings2, MousePointer2, BoxSelect, Hand } from 'lucide-react';
import type { WarehouseZone } from '../pages/FloorPlanningModuleFT2.js';
import {
  DecisionConfirmationModal,
  WarehouseLocationType,
} from '@lasyncro/shared/ui';
import { IsometricCanvas } from './IsometricCanvas.js';
import {
  FLOOR_PLANNING_COMPONENT_GROUPS,
  FLOOR_PLANNING_COMPONENTS,
  nextFloorPlanningLocationCode,
  type FloorPlanningComponentDefinition,
} from './floorPlanningComponents.js';

// ── Constants ────────────────────────────────────────────────────────────────
const SCALE      = 60;
const SNAP       = 0.1;
const MIN_ZOOM   = 0.3;
const MAX_ZOOM   = 3.0;
const CANVAS_W   = 20;
const CANVAS_H   = 15;
const RULER_SIZE = 24;
const DEFAULT_VIEWPORT = { zoom: 1, offset: { x: 40, y: 40 } };
const VIEWPORT_PADDING_RATIO_PER_SIDE = 0.05;

export type FloorPlanningViewport = {
  zoom: number;
  offset: { x: number; y: number };
};

type WarehouseBounds = Pick<WarehouseZone, 'position_x' | 'position_y' | 'width' | 'depth'>;

function hasUsableWarehouseBounds(warehouse: WarehouseBounds | null | undefined): warehouse is WarehouseBounds {
  return !!warehouse
    && warehouse.position_x != null
    && warehouse.position_y != null
    && Number.isFinite(Number(warehouse.position_x))
    && Number.isFinite(Number(warehouse.position_y))
    && Number.isFinite(Number(warehouse.width))
    && Number(warehouse.width) > 0
    && Number.isFinite(Number(warehouse.depth))
    && Number(warehouse.depth) > 0;
}

export function fitWarehouseToViewport(
  warehouse: WarehouseBounds | null | undefined,
  viewportWidth: number,
  viewportHeight: number,
): FloorPlanningViewport | null {
  const x = Number(warehouse?.position_x);
  const y = Number(warehouse?.position_y);
  const width = Number(warehouse?.width);
  const depth = Number(warehouse?.depth);
  if (!hasUsableWarehouseBounds(warehouse)) {
    return DEFAULT_VIEWPORT;
  }

  if (
    !Number.isFinite(viewportWidth) || viewportWidth <= 0
    || !Number.isFinite(viewportHeight) || viewportHeight <= 0
  ) {
    return null;
  }

  const usableWidth = viewportWidth * (1 - VIEWPORT_PADDING_RATIO_PER_SIDE * 2);
  const usableHeight = viewportHeight * (1 - VIEWPORT_PADDING_RATIO_PER_SIDE * 2);
  const zoom = Math.min(
    MAX_ZOOM,
    Math.max(MIN_ZOOM, Math.min(usableWidth / (width * SCALE), usableHeight / (depth * SCALE))),
  );

  return {
    zoom,
    offset: {
      x: (viewportWidth - width * SCALE * zoom) / 2 - x * SCALE * zoom,
      y: (viewportHeight - depth * SCALE * zoom) / 2 - y * SCALE * zoom,
    },
  };
}

// Setup and Map share the same live semantic tokens; only face opacity differs.
function zoneRGBA(type: string, alpha: number): string {
  return `rgba(var(--zone-${type}, 100,116,139),${alpha})`;
}

// FP-01: exported so FloorPlanningModuleFT2.tsx (Setup > List view) can
// reuse the same zone_type -> colour mapping as the Canvas view, instead
// of duplicating a second colour map that could drift out of sync.

export const ZONE_COLORS: Record<string, string> = {
  lane:       zoneRGBA('lane', 0.12),
  warehouse:  zoneRGBA('warehouse', 0.08),
  shelf:      zoneRGBA('shelf', 0.10),
  pick:       zoneRGBA('pick', 0.22),
  pack:       zoneRGBA('pack', 0.25),
  receive:    zoneRGBA('receive', 0.22),
  ship:       zoneRGBA('ship', 0.22),
  returns:    zoneRGBA('returns', 0.25),
  problem:    zoneRGBA('problem', 0.30),
  quarantine: zoneRGBA('quarantine', 0.35),
  kitting:    zoneRGBA('kitting', 0.25),
  storage:    zoneRGBA('storage', 0.18),
};

export const ZONE_STROKE: Record<string, string> = {
  lane:       zoneRGBA('lane', 0.50),
  warehouse:  zoneRGBA('warehouse', 0.35),
  shelf:      zoneRGBA('shelf', 0.45),
  pick:       zoneRGBA('pick', 0.85),
  pack:       zoneRGBA('pack', 0.85),
  receive:    zoneRGBA('receive', 0.85),
  ship:       zoneRGBA('ship', 0.85),
  returns:    zoneRGBA('returns', 0.85),
  problem:    zoneRGBA('problem', 1.00),
  quarantine: zoneRGBA('quarantine', 1.00),
  kitting:    zoneRGBA('kitting', 0.85),
  storage:    zoneRGBA('storage', 0.60),
};

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
  groupStartPositions?: Record<string, { x: number; y: number }>;
}

interface PanState {
  startMouseX: number;
  startMouseY: number;
  startOffsetX: number;
  startOffsetY: number;
}

type CanvasMode = 'pointer' | 'marquee' | 'pan';

interface MarqueeState {
  startX: number;
  startY: number;
  currentX: number;
  currentY: number;
  shiftKey: boolean;
  baseSelection: Set<string>;
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
    dock_face?: 'north' | 'south' | 'east' | 'west' | 'none' | null;
  }) => Promise<void>;
  onUpdateZonePositions?: (positions: Array<{
    location_code: string;
    position_x: number;
    position_y: number;
  }>) => Promise<void>;
  onDeleteZone?: (locationCode: string) => Promise<void>;
  onDeleteZones?: (locationCodes: string[]) => Promise<{
    success: true;
    deleted: number;
  }>;
  onDuplicateZones?: (payload: {
    location_codes: string[];
    offset: { x: number; y: number };
  }) => Promise<{
    success: true;
    created: Array<{
      source_location_code: string;
      location_code: string;
    }>;
  }>;
  // FP-16 follow-up: mirrors the FloorPlanningModuleFT2 interface fix —
  // usePrintBarcode's mutationFn resolves the fetched label Blob
  // (responseType: 'blob'), not void. Usage at line 472 is fire-and-forget
  // (no await/.then chain), so widening this return type is safe.
  onPrintBarcode?: (locationCode: string) => Promise<Blob>;
  onCreateZone?: (payload: { 
    location_code: string; 
    type: WarehouseLocationType; 
    zone_type?: string; 
    position_x?: number; 
    position_y?: number; 
    width?: number; 
    depth?: number;
    rack_levels?: number
  }) => Promise<void>;
  // FP-04: Canvas no longer embeds its own 3D preview — IsometricCanvas
  // already renders full-featured (with occupancy/stock-out overlays) on
  // the Map tab. This callback lets Canvas hand off to that existing view
  // instead of duplicating a stripped-down copy of it.
  onViewIn3D?: () => void;
}

function isSelectableZone(zone: WarehouseZone | undefined): zone is WarehouseZone {
  return !!zone && zone.type !== 'warehouse';
}

function selectableCodes(codes: Iterable<string>, zones: readonly WarehouseZone[]): Set<string> {
  const zoneByCode = new Map(zones.map((zone) => [zone.location_code, zone]));
  return new Set([...codes].filter((code) => isSelectableZone(zoneByCode.get(code))));
}
// ── ComponentPalette ─────────────────────────────────────────────────────────
function ComponentPalette({ zones, codeSourceZones, unpositionedZones, onPlace, onCreateComponent }: {
  zones: WarehouseZone[];
  codeSourceZones: readonly Pick<WarehouseZone, 'location_code'>[];
  unpositionedZones: WarehouseZone[];
  onPlace: (zone: WarehouseZone) => void;
  onCreateComponent: (item: FloorPlanningComponentDefinition, locationCode: string) => Promise<void>;
}) {
  // Layout health — real checks computed from live zone state (WMS-FP-06).
  const healthIssues: string[] = [];
  const unpositioned = zones.filter((z) => z.position_x == null).length;
  if (unpositioned > 0) healthIssues.push(`${unpositioned} zone${unpositioned !== 1 ? 's' : ''} not placed on the floor`);
  const detachedBins = zones.filter((z) => z.type === 'bin' && z.zone_type !== 'quarantine' && z.parent_location_code == null).length;
  if (detachedBins > 0) healthIssues.push(`${detachedBins} bin${detachedBins !== 1 ? 's' : ''} with no parent aisle`);
  const unbarcoded = zones.filter((z) => z.type !== 'warehouse' && z.barcode == null).length;
  if (unbarcoded > 0) healthIssues.push(`${unbarcoded} location${unbarcoded !== 1 ? 's' : ''} without a barcode`);
  const [activeItem, setActiveItem] = useState<string | null>(null);
  const [locationCode, setLocationCode] = useState('');
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function openCreate(item: FloorPlanningComponentDefinition) {
    if (creating) return;
    setActiveItem(item.id);
    setLocationCode(nextFloorPlanningLocationCode(item.codePrefix, codeSourceZones));
    setError(null);
  }

  async function handleCreate(item: FloorPlanningComponentDefinition) {
    const normalizedCode = locationCode.trim().toUpperCase();
    if (!normalizedCode || creating) return;
    setCreating(true);
    setError(null);
    try {
      await onCreateComponent(item, normalizedCode);
      setActiveItem(null);
      setLocationCode('');
    } catch (createError: any) {
      setError(createError?.response?.data?.error ?? 'Failed to create');
    } finally {
      setCreating(false);
    }
  }

  return (
    <Box sx={{
      width: 160, flexShrink: 0, borderRight: '1px solid var(--rule)',
      bgcolor: 'var(--bg)', display: 'flex', flexDirection: 'column', overflow: 'hidden',
    }}>
      <Box sx={{ p: 1.5, borderBottom: '1px solid var(--rule)' }}>
        <Typography sx={{ fontSize: 9, fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--ink-4)' }}>
          Click to add
        </Typography>
      </Box>
      <Box sx={{ p: 1, overflowY: 'auto' }}>
        {FLOOR_PLANNING_COMPONENT_GROUPS.map((group) => (
          <Box key={group} sx={{ mb: 1.25 }}>
            <Typography sx={{ px: 0.25, mb: 0.5, fontSize: 8, fontWeight: 700, letterSpacing: '0.08em', color: 'var(--ink-4)' }}>
              {group}
            </Typography>
            <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 0.75 }}>
              {FLOOR_PLANNING_COMPONENTS.filter((item) => item.group === group).map((item) => {
                // Frame types (lane) use type-based colour — matches canvas render.
                const colorKey = item.type === 'lane' ? 'lane' : item.zone_type;
                const fill = ZONE_COLORS[colorKey] ?? ZONE_COLORS.storage;
                const stroke = ZONE_STROKE[colorKey] ?? ZONE_STROKE.storage;
                const isActive = activeItem === item.id;
                return (
                  <Box key={item.id}
                    role="button"
                    tabIndex={0}
                    aria-label={`Add ${item.label}`}
                    aria-disabled={creating}
                    onClick={() => openCreate(item)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' || event.key === ' ') openCreate(item);
                    }}
                    sx={{ p: 1, borderRadius: 1.5, border: `1px solid ${isActive ? 'var(--accent)' : stroke}`,
                      bgcolor: isActive ? 'var(--accent-ghost)' : fill, cursor: creating ? 'wait' : 'pointer',
                      display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 0.5, userSelect: 'none',
                      '&:hover': { opacity: creating ? 1 : 0.8 }, transition: 'all 0.12s' }}>
                    <Box sx={{ width: '100%', height: 20, borderRadius: 0.5, border: `1px solid ${stroke}`, bgcolor: fill }} />
                    <Typography sx={{ fontSize: 9, fontWeight: 600, color: isActive ? 'var(--accent)' : 'var(--ink-2)', textAlign: 'center', lineHeight: 1.2 }}>
                      {item.label}
                    </Typography>
                    {isActive && (
                      <Box sx={{ width: '100%', mt: 0.5 }} onClick={(event) => event.stopPropagation()}>
                        <Typography component="label" htmlFor={`location-code-${item.id}`} sx={{ display: 'block', fontSize: 8, color: 'var(--ink-4)', mb: 0.25 }}>
                          Location code
                        </Typography>
                        <input
                          id={`location-code-${item.id}`}
                          autoFocus
                          required
                          value={locationCode}
                          placeholder={`${item.codePrefix}-02`}
                          onChange={(event) => setLocationCode(event.target.value.toUpperCase())}
                          onKeyDown={(event) => {
                            event.stopPropagation();
                            if (event.key === 'Enter') void handleCreate(item);
                          }}
                          style={{ width: '100%', fontSize: 9, fontFamily: 'monospace', padding: '3px 4px', borderRadius: 3, border: '1px solid var(--rule)', background: 'var(--bg)', color: 'var(--ink)', boxSizing: 'border-box' }}
                        />
                        {error && (
                          <Typography role="alert" sx={{ fontSize: 8, color: 'rgba(239,68,68,0.9)', mt: 0.25, textAlign: 'center' }}>{error}</Typography>
                        )}
                        <Button
                          size="small"
                          variant="contained"
                          disabled={creating || !locationCode.trim()}
                          onClick={() => void handleCreate(item)}
                          sx={{ width: '100%', minWidth: 0, mt: 0.5, py: 0.25, fontSize: 8 }}
                        >
                          {creating ? 'Adding…' : 'Add'}
                        </Button>
                      </Box>
                    )}
                  </Box>
                );
              })}
            </Box>
          </Box>
        ))}
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
      <Box sx={{ p: 1.5, mt: 'auto', borderTop: '1px solid var(--rule)', bgcolor: 'var(--bg-2)' }}>
        <Typography sx={{ fontSize: 9, fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--ink-4)', mb: 0.75 }}>
          Layout health
        </Typography>
        {healthIssues.length === 0 ? (
          <Typography sx={{ fontSize: 10, color: 'var(--ink-4)', fontStyle: 'italic', lineHeight: 1.4 }}>
            All good — no issues detected.
          </Typography>
        ) : (
          healthIssues.map((issue, i) => (
            <Box key={i} sx={{ display: 'flex', alignItems: 'flex-start', gap: 0.5, mb: 0.5 }}>
              <Box sx={{ width: 4, height: 4, borderRadius: '50%', bgcolor: 'var(--accent)', flexShrink: 0, mt: 0.5 }} />
              <Typography sx={{ fontSize: 10, color: 'var(--ink-3)', lineHeight: 1.4 }}>{issue}</Typography>
            </Box>
          ))
        )}
      </Box>
    </Box>
  );
}

// ── FloorSettingsPanel ────────────────────────────────────────────────────────
function FloorSettingsPanel({ root, onClose, onUpdateZone }: {
  root: WarehouseZone;
  onClose: () => void;
  onUpdateZone?: CanvasEditorProps['onUpdateZone'];
}) {
  const [saving, setSaving] = useState(false);
  const [width, setWidth] = useState(String(root.width ?? ''));
  const [depth, setDepth] = useState(String(root.depth ?? ''));

  useEffect(() => {
    setWidth(String(root.width ?? ''));
    setDepth(String(root.depth ?? ''));
  }, [root.location_code, root.width, root.depth]);

  async function commitDimension(field: 'width' | 'depth', raw: string) {
    const value = parseFloat(raw);
    if (isNaN(value) || !onUpdateZone) return;
    setSaving(true);
    try { await onUpdateZone(root.location_code, { [field]: snapV(value) }); }
    finally { setSaving(false); }
  }

  return (
    <Box data-testid="floor-settings-panel" sx={{ width: 220, flexShrink: 0, borderLeft: '1px solid var(--rule)', bgcolor: 'var(--bg)', display: 'flex', flexDirection: 'column' }}>
      <Box sx={{ px: 1.5, py: 1.25, borderBottom: '1px solid var(--rule)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <Box>
          <Typography sx={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--ink-4)' }}>Floor settings</Typography>
          <Typography sx={{ mt: 0.25, fontFamily: 'monospace', fontSize: 12, fontWeight: 700, color: 'var(--ink)' }}>{root.location_code}</Typography>
        </Box>
        <IconButton size="small" title="Close floor settings" onClick={onClose} sx={{ color: 'var(--ink-4)' }}><X size={13} /></IconButton>
      </Box>
      <Box sx={{ p: 1.5, display: 'flex', flexDirection: 'column', gap: 1.25 }}>
        <TextField
          size="small"
          label="Code"
          value={root.location_code}
          inputProps={{ readOnly: true, 'aria-label': 'Floor code', style: { fontFamily: 'monospace', fontSize: 11 } }}
        />
        <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 1 }}>
          {([
            { label: 'Width', field: 'width' as const, value: width, set: setWidth },
            { label: 'Depth', field: 'depth' as const, value: depth, set: setDepth },
          ]).map((dimension) => (
            <TextField
              key={dimension.field}
              size="small"
              label={dimension.label}
              value={dimension.value}
              disabled={saving}
              onChange={(event) => dimension.set(event.target.value)}
              onBlur={() => void commitDimension(dimension.field, dimension.value)}
              onKeyDown={(event) => { if (event.key === 'Enter') void commitDimension(dimension.field, dimension.value); }}
              inputProps={{ 'aria-label': `Floor ${dimension.label.toLowerCase()}`, style: { fontFamily: 'monospace', fontSize: 11, padding: '6px 8px' } }}
              InputProps={{ endAdornment: <Typography sx={{ fontSize: 9, color: 'var(--ink-4)' }}>m</Typography> }}
            />
          ))}
        </Box>
      </Box>
    </Box>
  );
}

function BulkSelectionPanel({
  zones,
  onClear,
  onDuplicate,
  onDelete,
  pending,
}: {
  zones: WarehouseZone[];
  onClear: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
  pending: boolean;
}) {
  const summary = [...zones.reduce((counts, zone) => {
    const role = zone.type === 'lane' || zone.type === 'shelf'
      ? zone.type
      : (zone.zone_type ?? zone.type);
    counts.set(role, (counts.get(role) ?? 0) + 1);
    return counts;
  }, new Map<string, number>())]
    .sort(([left], [right]) => left.localeCompare(right));

  return (
    <Box data-testid="bulk-selection-panel" sx={{ width: 220, flexShrink: 0, borderLeft: '1px solid var(--rule)', bgcolor: 'var(--bg)', display: 'flex', flexDirection: 'column' }}>
      <Box sx={{ px: 1.5, py: 1.25, borderBottom: '1px solid var(--rule)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <Box>
          <Typography sx={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--ink-4)' }}>Selection</Typography>
          <Typography sx={{ mt: 0.25, fontSize: 13, fontWeight: 700, color: 'var(--ink)' }}>{zones.length} selected</Typography>
        </Box>
        <IconButton size="small" title="Deselect all" onClick={onClear} sx={{ color: 'var(--ink-4)' }}><X size={13} /></IconButton>
      </Box>
      <Box sx={{ p: 1.5, display: 'flex', flexDirection: 'column', gap: 0.75 }}>
        {summary.map(([role, count]) => (
          <Box key={role} sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1 }}>
            <Typography sx={{ fontSize: 10, textTransform: 'capitalize', color: 'var(--ink-3)' }}>{role}</Typography>
            <Typography sx={{ fontSize: 10, fontFamily: 'monospace', fontWeight: 700, color: 'var(--ink-2)' }}>{count}</Typography>
          </Box>
        ))}
        <Button
          size="small"
          variant="outlined"
          onClick={onClear}
          disabled={pending}
          sx={{ mt: 0.75, textTransform: 'none', fontSize: 10 }}
        >
          Deselect all
        </Button>
        <Button
          size="small"
          variant="outlined"
          startIcon={<Copy size={12} />}
          onClick={onDuplicate}
          disabled={pending}
          sx={{ textTransform: 'none', fontSize: 10 }}
        >
          Duplicate selected
        </Button>
        <Button
          size="small"
          variant="outlined"
          color="error"
          startIcon={<Trash2 size={12} />}
          onClick={onDelete}
          disabled={pending}
          sx={{ textTransform: 'none', fontSize: 10 }}
        >
          Delete selected
        </Button>
      </Box>
    </Box>
  );
}

// ── RackInspector ─────────────────────────────────────────────────────────────
function RackInspector({ zone, onClose, onUpdateZone, onDeleteZone, onPrintBarcode, onCreateZone }: {
  zone: WarehouseZone;
  onClose: () => void;
  onUpdateZone?: CanvasEditorProps['onUpdateZone'];
  onDeleteZone?: CanvasEditorProps['onDeleteZone'];
  onPrintBarcode?: CanvasEditorProps['onPrintBarcode'];
  // onCreateZone: required to power the Duplicate action — offsets copy by 1.1m to avoid overlap
  onCreateZone?: CanvasEditorProps['onCreateZone'];
}) {
  const zoneColor = ZONE_STROKE[zone.zone_type ?? 'storage'] ?? ZONE_STROKE.storage;
  const roleLabel = FLOOR_PLANNING_COMPONENTS.find(
    (item) => item.type === zone.type && item.zone_type === zone.zone_type,
  )?.label ?? zone.zone_type ?? zone.type;
  const [saving, setSaving]           = useState(false);
  const [deleteOpen, setDeleteOpen]   = useState(false);
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
    setDeleteOpen(true);
  }

  async function confirmDelete() {
    if (!onDeleteZone) return;
    setDeleteOpen(false);
    await onDeleteZone(zone.location_code);
    onClose();
  }

  // Duplicate: opens a Dialog so the user can set a unique code before creation.
  // location_code is the PK and immutable post-creation — must be set here.
  const [duplicateOpen, setDuplicateOpen]   = useState(false);
  const [duplicateCode, setDuplicateCode]   = useState('');
  const [duplicating, setDuplicating]       = useState(false);
  const [duplicateError, setDuplicateError] = useState<string | null>(null);

  function openDuplicate() {
    setDuplicateCode(`${zone.location_code}-COPY`);
    setDuplicateError(null);
    setDuplicateOpen(true);
  }

  async function confirmDuplicate() {
    if (!onCreateZone || !duplicateCode.trim()) return;
    setDuplicating(true);
    setDuplicateError(null);
    try {
      await onCreateZone({
        location_code: duplicateCode.trim().toUpperCase(),
        type: zone.type as WarehouseLocationType,
        zone_type: zone.zone_type ?? undefined,
        position_x: (parseFloat(String(zone.position_x ?? 0)) + 1.1),
        position_y: parseFloat(String(zone.position_y ?? 0)),
        width: parseFloat(String(zone.width ?? 1)),
        depth: parseFloat(String(zone.depth ?? 0.5)),
        rack_levels: zone.rack_levels ?? undefined,
      });
      setDuplicateOpen(false);
    } catch {
      setDuplicateError('Code already exists or is invalid.');
    } finally {
      setDuplicating(false);
    }
  }

  return (
    <Box sx={{ width: 240, flexShrink: 0, borderLeft: '1px solid var(--rule)', bgcolor: 'var(--bg)', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <Box sx={{ px: 1.5, py: 1, borderBottom: '1px solid var(--rule)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <Box sx={{ minWidth: 0 }}>
          <Typography sx={{ fontSize: 8, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--ink-4)' }}>
            {zone.type} · {roleLabel}
          </Typography>
          <Typography sx={{ mt: 0.2, fontFamily: 'monospace', fontSize: 12, fontWeight: 700, color: 'var(--ink)', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {zone.location_code}
          </Typography>
        </Box>
        <IconButton size="small" title="Close inspector" onClick={onClose} sx={{ color: 'var(--ink-4)' }}>
          <X size={13} />
        </IconButton>
      </Box>
      <Box data-testid="zone-inspector-content" sx={{ p: 1.25, display: 'flex', flexDirection: 'column', gap: 0.9 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, flexWrap: 'wrap' }}>
            <Typography sx={{ mr: 0.25, fontSize: 8, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--ink-4)' }}>Role</Typography>
            <Chip label={roleLabel} size="small" sx={{ fontSize: 10, height: 20, bgcolor: zone.zone_type ? ZONE_COLORS[zone.zone_type] : 'transparent', color: zoneColor, border: `1px solid ${zoneColor}` }} />
            <Chip label={zone.type} size="small" sx={{ fontSize: 10, height: 20 }} />
        </Box>
        <Box>
          <Typography sx={{ fontSize: 8, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--ink-4)', mb: 0.5 }}>Geometry</Typography>
          {([
            { testId: 'geometry-size-row', fields: [
              { label: 'Width', field: 'width' as const, value: editW, set: setEditW },
              { label: 'Depth', field: 'depth' as const, value: editD, set: setEditD },
            ] },
            { testId: 'geometry-position-row', fields: [
              { label: 'Position X', field: 'position_x' as const, value: editX, set: setEditX },
              { label: 'Position Y', field: 'position_y' as const, value: editY, set: setEditY },
            ] },
          ]).map((row) => (
            <Box key={row.testId} data-testid={row.testId} sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 1, mb: 1 }}>
              {row.fields.map(({ label, field, value, set }) => (
                <TextField key={field} size="small" label={label} value={value} onChange={(e) => set(e.target.value)}
                  onBlur={() => void commitField(field, value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') void commitField(field, value); }}
                  disabled={saving}
                  inputProps={{ 'aria-label': label, style: { fontFamily: 'monospace', fontSize: 11, padding: '6px 8px' } }}
                  InputProps={{ endAdornment: <Typography sx={{ fontSize: 9, color: 'var(--ink-4)' }}>m</Typography> }} />
              ))}
            </Box>
          ))}
          <Box data-testid="geometry-levels-row" sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 1 }}>
            <TextField size="small" type="number" label="Levels"
              key={`${zone.location_code}:${zone.rack_levels ?? 'none'}`}
              defaultValue={zone.rack_levels ?? ''}
              placeholder="—"
              onBlur={(e) => {
                const val = parseInt(e.target.value);
                if (!isNaN(val) && val >= 1 && val <= 20) onUpdateZone?.(zone.location_code, { rack_levels: val });
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  const val = parseInt((e.target as HTMLInputElement).value);
                  if (!isNaN(val) && val >= 1 && val <= 20) onUpdateZone?.(zone.location_code, { rack_levels: val });
                }
              }}
              inputProps={{ min: 1, max: 20, 'aria-label': 'Levels', style: { fontFamily: 'monospace', fontSize: 11, padding: '6px 8px' } }} />
            <Box sx={{ minHeight: 32, px: 1, border: '1px solid var(--rule)', borderRadius: 1, display: 'flex', alignItems: 'center', gap: 0.5 }}>
              <RotateCw size={11} color="var(--ink-4)" />
              <Box>
                <Typography sx={{ fontSize: 8, color: 'var(--ink-4)', lineHeight: 1 }}>Orientation</Typography>
                <Typography sx={{ mt: 0.25, fontSize: 11, color: 'var(--ink-3)', lineHeight: 1 }}>{zone.orientation ?? 0}°</Typography>
              </Box>
            </Box>
          </Box>
        </Box>

        {(zone.zone_type === 'ship' || zone.zone_type === 'receive') && (
          <Box>
            <Typography
              sx={{
                fontSize: 9,
                fontWeight: 600,
                letterSpacing: '0.08em',
                textTransform: 'uppercase',
                color: 'var(--ink-4)',
                mb: 0.5,
              }}
            >
              Dock opening
            </Typography>

            <TextField
              select
              size="small"
              value={zone.dock_face ?? ''}
              onChange={(e) => {
                const value = e.target.value;
                void onUpdateZone?.(zone.location_code, {
                  dock_face: value === ''
                    ? null
                    : value as 'north' | 'south' | 'east' | 'west' | 'none',
                });
              }}
              SelectProps={{ native: true }}
              inputProps={{ 'aria-label': 'Dock opening' }}
              sx={{ width: '100%', '& .MuiInputBase-input': { py: 0.75, fontSize: 11 } }}
            >
              <option value="">Auto</option>
              <option value="north">North</option>
              <option value="south">South</option>
              <option value="east">East</option>
              <option value="west">West</option>
              <option value="none">None</option>
            </TextField>
          </Box>
        )}
        {(zone.barcode || zone.parent_location_code) && (
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.35, p: 0.75, bgcolor: 'var(--bg-2)', borderRadius: 1, border: '1px solid var(--rule)' }}>
            {zone.barcode && <Typography sx={{ fontFamily: 'monospace', fontSize: 9, color: 'var(--ink-3)' }}>Barcode: {zone.barcode}</Typography>}
            {zone.parent_location_code && <Typography sx={{ fontFamily: 'monospace', fontSize: 9, color: 'var(--ink-3)' }}>Parent: {zone.parent_location_code}</Typography>}
          </Box>
        )}

        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5, pt: 0.15 }}>
          <Box
            title="Duplicate zone"
            role="button"
            onClick={openDuplicate}
            sx={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 0.5,
              py: 0.65,
              borderRadius: 1,
              border: '1px solid var(--rule)',
              fontSize: 10,
              fontWeight: 500,
              color: 'var(--ink-3)',
              cursor: 'pointer',
              '&:hover': { borderColor: 'var(--accent)', color: 'var(--accent)' },
              transition: 'all 0.15s',
            }}
          >
            <Copy size={11} /> Duplicate
          </Box>

          {zone.type !== 'warehouse' && (
            <Box
              onClick={() => onPrintBarcode?.(zone.location_code)}
              sx={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 0.5,
                py: 0.65,
                borderRadius: 1,
                bgcolor: 'var(--accent)',
                color: '#fff',
                fontSize: 10,
                fontWeight: 600,
                cursor: 'pointer',
                '&:hover': { opacity: 0.9 },
                transition: 'opacity 0.15s',
              }}
            >
              <Tag size={11} /> Print barcode
            </Box>
          )}

          <Box
            onClick={handleDelete}
            sx={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 0.5,
              py: 0.65,
              borderRadius: 1,
              border: '1px solid var(--rule)',
              fontSize: 10,
              fontWeight: 500,
              color: 'var(--ink-3)',
              cursor: 'pointer',
              '&:hover': {
                borderColor: 'rgba(239,68,68,0.6)',
                color: 'rgba(239,68,68,0.9)',
              },
              transition: 'all 0.15s',
            }}
          >
            <Trash2 size={11} /> Delete
          </Box>
        </Box>
      </Box>
      {/* Duplicate — user sets a unique code before creation; location_code is immutable PK post-create */}
      <Dialog open={duplicateOpen} onClose={() => setDuplicateOpen(false)}>
        <DialogTitle sx={{ fontSize: 14 }}>Duplicate <strong>{zone.location_code}</strong></DialogTitle>
        <Box sx={{ px: 3, pb: 1 }}>
          <TextField
            autoFocus
            size="small"
            label="New name"
            value={duplicateCode}
            onChange={e => { setDuplicateCode(e.target.value.toUpperCase()); setDuplicateError(null); }}
            onKeyDown={e => { if (e.key === 'Enter') confirmDuplicate(); }}
            error={!!duplicateError}
            helperText={duplicateError ?? ' '}
            inputProps={{ style: { fontFamily: 'monospace' } }}
            fullWidth
          />
        </Box>
        <DialogActions>
          <Button size="small" onClick={() => setDuplicateOpen(false)}>Cancel</Button>
          <Button size="small" variant="contained" onClick={confirmDuplicate} disabled={duplicating || !duplicateCode.trim()}>
            {duplicating ? 'Creating…' : 'Duplicate'}
          </Button>
        </DialogActions>
      </Dialog>

      <DecisionConfirmationModal
        open={deleteOpen}
        onClose={() => setDeleteOpen(false)}
        onConfirm={confirmDelete}
        title={<>Delete <strong>{zone.location_code}</strong>?</>}
        description="This component will be removed. This action cannot be undone."
        confirmLabel="Delete"
        tone="destructive"
      />
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
export function CanvasEditor({ 
  zones, 
  onUpdateZone,
  onUpdateZonePositions,
  onDeleteZone,
  onDeleteZones,
  onDuplicateZones,
  onCreateZone,
  onPrintBarcode,
  onViewIn3D,
}: CanvasEditorProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [zoom, setZoom]         = useState(1);
  const [offset, setOffset]     = useState({ x: 40, y: 40 });
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [mode, setMode] = useState<CanvasMode>('pointer');
  const [marquee, setMarquee] = useState<MarqueeState | null>(null);
  const [floorSettingsOpen, setFloorSettingsOpen] = useState(false);
  const [optimisticCreatedZones, setOptimisticCreatedZones] = useState<WarehouseZone[]>([]);
  const [bulkDuplicateOpen, setBulkDuplicateOpen] = useState(false);
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false);
  const [bulkActionPending, setBulkActionPending] = useState(false);
  const [flipped, setFlipped]   = useState(false); // angle preset: standard vs mirrored
  const [localPositions, setLocalPositions] = useState<Record<string, { x: number; y: number }>>({});
  const [localSizes, setLocalSizes]         = useState<Record<string, { w: number; h: number }>>({});
  // Optimistic placement: zones placed this session before props re-render with new coordinates
  const [placedCoords, setPlacedCoords] = useState<Record<string, { x: number; y: number }>>({});
  const [lastSaved, setLastSaved] = useState<Date | null>(null);
  const dragRef   = useRef<DragState | null>(null);
  const panRef    = useRef<PanState | null>(null);
  const resizeRef = useRef<ResizeState | null>(null);
  const marqueeRef = useRef<MarqueeState | null>(null);
  const initialViewportAppliedRef = useRef(false);
  const savingRef = useRef<Set<string>>(new Set());
  // FP-11: alignment guide lines, shown while dragging a frame zone
  // (warehouse/lane/shelf) if it lines up with a sibling frame zone's
  // left/center/right or top/center/bottom edge. Scoped to frame zones
  // only — they currently get zero positioning assistance (clampPosition
  // skips them entirely), unlike bins which already have collision-snap.
  // x/y are in SVG canvas coordinates (post-toSvg), null when no snap active.
  const [alignGuides, setAlignGuides] = useState<{ x: number | null; y: number | null }>({ x: null, y: null });
  // Merge prop-positioned zones with optimistically placed zones
  const positionedZones = [
    ...zones.filter(z => z.position_x != null && z.position_y != null),
    ...zones.filter(z => z.position_x == null && placedCoords[z.location_code] != null).map(z => ({
      ...z,
      position_x: placedCoords[z.location_code].x,
      position_y: placedCoords[z.location_code].y,
    })),
    ...optimisticCreatedZones.filter(
      (optimisticZone) => !zones.some((zone) => zone.location_code === optimisticZone.location_code),
    ),
  ];
  useEffect(() => {
    setOptimisticCreatedZones((current) => current.filter(
      (optimisticZone) => !zones.some((zone) => zone.location_code === optimisticZone.location_code),
    ));
  }, [zones]);
  useEffect(() => {
    setSelected((current) => {
      const next = selectableCodes(current, zones);
      return next.size === current.size && [...next].every((code) => current.has(code)) ? current : next;
    });
  }, [zones]);
  // Refs for latest values — avoids stale closure captures inside useEffect mousemove handler
  const positionedZonesRef = useRef(positionedZones);
  const localSizesRef      = useRef(localSizes);
  const localPositionsRef  = useRef(localPositions);
  const zoomRef             = useRef(zoom);
  const offsetRef          = useRef(offset);
  const selectedRef        = useRef(selected);
  // Sync refs synchronously on every render — avoids stale closure in mousemove handler
  positionedZonesRef.current = positionedZones;
  localSizesRef.current      = localSizes;
  localPositionsRef.current  = localPositions;
  zoomRef.current            = zoom;
  offsetRef.current          = offset;
  selectedRef.current        = selected;
  const unpositionedCount = zones.filter(z => z.position_x == null && !placedCoords[z.location_code]).length;
  const selectedZones = positionedZones.filter((zone) => selected.has(zone.location_code) && isSelectableZone(zone));
  const selectedZone = selectedZones.length === 1 ? selectedZones[0] : null;

  const warehouseRoots = zones.filter((zone) => zone.type === 'warehouse');
  const warehouseRoot = warehouseRoots.length === 1 ? warehouseRoots[0] : null;

  const fitCurrentWarehouse = useCallback(() => {
    const rect = svgRef.current?.getBoundingClientRect();
    const viewport = fitWarehouseToViewport(
      warehouseRoot,
      rect?.width ?? 0,
      rect?.height ?? 0,
    );
    if (!viewport) return false;
    setZoom(viewport.zoom);
    setOffset(viewport.offset);
    return true;
  }, [warehouseRoot]);

  useEffect(() => {
    if (initialViewportAppliedRef.current) return;
    if (!hasUsableWarehouseBounds(warehouseRoot)) return;

    let animationFrame: number | undefined;
    let observer: ResizeObserver | undefined;

    const applyWhenMeasurable = () => {
      const fitted = fitCurrentWarehouse();
      if (!fitted) {
        animationFrame = window.requestAnimationFrame(applyWhenMeasurable);
      }
      return fitted;
    };

    applyWhenMeasurable();

    if (typeof ResizeObserver !== 'undefined' && svgRef.current) {
      observer = new ResizeObserver(() => {
        if (fitCurrentWarehouse()) {
          initialViewportAppliedRef.current = true;
          observer?.disconnect();
        }
      });
      observer.observe(svgRef.current);
    }

    return () => {
      if (animationFrame !== undefined) {
        window.cancelAnimationFrame(animationFrame);
      }
      observer?.disconnect();
    };
  }, [fitCurrentWarehouse, warehouseRoot]);

  const toSvg = useCallback((metres: number) => metres * SCALE * zoom, [zoom]);

  async function createPaletteComponent(item: FloorPlanningComponentDefinition, locationCode: string) {
    if (!onCreateZone) return;
    const x = snapV(Math.max(0, (-offset.x + 200) / (SCALE * zoom)));
    const y = snapV(Math.max(0, (-offset.y + 150) / (SCALE * zoom)));
    await onCreateZone({
      location_code: locationCode,
      type: item.type,
      zone_type: item.zone_type,
      position_x: x,
      position_y: y,
      width: item.defaultW,
      depth: item.defaultD,
      rack_levels: item.defaultRackLevels ?? undefined,
    });
    const createdZone: WarehouseZone = {
      location_code: locationCode,
      type: item.type,
      parent_location_code: null,
      barcode: null,
      active: true,
      children_count: 0,
      position_x: x,
      position_y: y,
      width: item.defaultW,
      depth: item.defaultD,
      orientation: 0,
      rack_levels: item.defaultRackLevels,
      zone_type: item.zone_type,
      last_printed_at: null,
      warehouse_name: null,
    };
    setOptimisticCreatedZones((current) => [...current, createdZone]);
    setFloorSettingsOpen(false);
    setSelected(selectableCodes([locationCode], [...positionedZones, createdZone]));
  }

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

  /**
   * C2a.2 — validate one common transform for a multi-selection.
   *
   * Selected components never collide with each other because their relative
   * geometry is preserved. warehouse/lane/shelf retain the existing
   * frame semantics and therefore do not participate in bin collision.
   *
   * Operational/bin-like selected zones are checked only against unselected
   * operational/bin-like blockers.
   */
  function isGroupDeltaValid(
    starts: Record<string, { x: number; y: number }>,
    dx: number,
    dy: number,
    ignoreSourceBlockers = true,
  ): boolean {
    const selectedCodes = new Set(Object.keys(starts));
    const TOL = 0.05;

    for (const [code, start] of Object.entries(starts)) {
      const zone = positionedZonesRef.current.find(
        (candidate) => candidate.location_code === code,
      );
      if (!zone || !isSelectableZone(zone)) return false;

      const candidateX = snapV(start.x + dx);
      const candidateY = snapV(start.y + dy);

      // Keep the complete group inside the same lower-bound contract used by
      // existing single-zone dragging.
      if (candidateX < 0 || candidateY < 0) return false;

      // Frame-like zones move freely under the existing collision model.
      if (zone.type === 'lane' || zone.type === 'shelf') continue;

      const w =
        localSizesRef.current[code]?.w
        ?? parseFloat(String(zone.width ?? 1));
      const h =
        localSizesRef.current[code]?.h
        ?? parseFloat(String(zone.depth ?? 0.8));

      for (const blocker of positionedZonesRef.current) {
        if (
          (ignoreSourceBlockers && selectedCodes.has(blocker.location_code))
          || blocker.type === 'warehouse'
          || blocker.type === 'lane'
          || blocker.type === 'shelf'
        ) {
          continue;
        }

        const bx =
          localPositionsRef.current[blocker.location_code]?.x
          ?? parseFloat(String(blocker.position_x ?? 0));
        const by =
          localPositionsRef.current[blocker.location_code]?.y
          ?? parseFloat(String(blocker.position_y ?? 0));
        const bw =
          localSizesRef.current[blocker.location_code]?.w
          ?? parseFloat(String(blocker.width ?? 1));
        const bh =
          localSizesRef.current[blocker.location_code]?.h
          ?? parseFloat(String(blocker.depth ?? 0.8));

        const overlaps =
          candidateX < bx + bw - TOL
          && candidateX + w - TOL > bx
          && candidateY < by + bh - TOL
          && candidateY + h - TOL > by;

        if (overlaps) return false;
      }
    }

    return true;
  }

  /**
   * Sweep from the group's start geometry toward the requested delta in
   * grid-sized increments. Stop at the last valid transform so a fast pointer
   * movement cannot tunnel the selection through an unselected blocker.
   *
   * One accepted dx/dy is returned for the whole group.
   */
  function clampGroupDelta(
    starts: Record<string, { x: number; y: number }>,
    requestedDx: number,
    requestedDy: number,
  ): { dx: number; dy: number } {
    const startPositions = Object.values(starts);
    if (startPositions.length === 0) return { dx: 0, dy: 0 };

    const minStartX = Math.min(...startPositions.map((position) => position.x));
    const minStartY = Math.min(...startPositions.map((position) => position.y));

    const boundedDx = snapV(Math.max(-minStartX, requestedDx));
    const boundedDy = snapV(Math.max(-minStartY, requestedDy));

    const distance = Math.max(Math.abs(boundedDx), Math.abs(boundedDy));
    if (distance === 0) return { dx: 0, dy: 0 };

    const steps = Math.max(1, Math.ceil(distance / SNAP));
    let acceptedDx = 0;
    let acceptedDy = 0;

    for (let step = 1; step <= steps; step++) {
      const ratio = step / steps;
      const candidateDx = snapV(boundedDx * ratio);
      const candidateDy = snapV(boundedDy * ratio);

      if (!isGroupDeltaValid(starts, candidateDx, candidateDy)) {
        break;
      }

      acceptedDx = candidateDx;
      acceptedDy = candidateDy;
    }

    return { dx: acceptedDx, dy: acceptedDy };
  }


  function currentSelectionStarts(): Record<string, { x: number; y: number }> {
    return Object.fromEntries(
      selectedZones.map((zone) => [
        zone.location_code,
        {
          x:
            localPositionsRef.current[zone.location_code]?.x
            ?? parseFloat(String(zone.position_x ?? 0)),
          y:
            localPositionsRef.current[zone.location_code]?.y
            ?? parseFloat(String(zone.position_y ?? 0)),
        },
      ]),
    );
  }

  /**
   * Find one deterministic common translation for a duplicate group.
   *
   * Unlike group movement, the original selected components remain in place,
   * so they participate in collision checks here.
   */
  function findDuplicateGroupDelta(
    starts: Record<string, { x: number; y: number }>,
  ): { dx: number; dy: number } | null {
    if (Object.keys(starts).length === 0) return null;

    // Prefer nearby placements in a predictable order.
    // Search progressively farther from the source group while preserving
    // one common transform for the complete selection.
    for (let distance = 0.5; distance <= 10; distance += 0.5) {
      const candidates = [
        { dx: distance, dy: 0 },
        { dx: 0, dy: distance },
        { dx: distance, dy: distance },
        { dx: -distance, dy: 0 },
        { dx: 0, dy: -distance },
        { dx: -distance, dy: distance },
        { dx: distance, dy: -distance },
        { dx: -distance, dy: -distance },
      ];

      for (const candidate of candidates) {
        const dx = snapV(candidate.dx);
        const dy = snapV(candidate.dy);

        if (isGroupDeltaValid(starts, dx, dy, false)) {
          return { dx, dy };
        }
      }
    }

    return null;
  }

  function openBulkDuplicate() {
    if (!onDuplicateZones || selectedZones.length < 2 || bulkActionPending) return;
    setBulkDuplicateOpen(true);
  }

  function openBulkDelete() {
    if (!onDeleteZones || selectedZones.length < 2 || bulkActionPending) return;
    setBulkDeleteOpen(true);
  }

  async function confirmBulkDuplicate() {
    if (!onDuplicateZones || selectedZones.length < 2) return;

    const sourceZones = [...selectedZones];
    const starts = currentSelectionStarts();
    const delta = findDuplicateGroupDelta(starts);

    if (!delta) {
      // No mutation has happened, so leave the selection untouched.
      setBulkDuplicateOpen(false);
      return;
    }

    setBulkActionPending(true);

    try {
      const result = await onDuplicateZones({
        location_codes: sourceZones.map((zone) => zone.location_code),
        offset: {
          x: delta.dx,
          y: delta.dy,
        },
      });

      const createdBySource = new Map(
        result.created.map((entry) => [
          entry.source_location_code,
          entry.location_code,
        ]),
      );

      const duplicatedZones: WarehouseZone[] = sourceZones.flatMap((source) => {
        const locationCode = createdBySource.get(source.location_code);
        if (!locationCode) return [];

        const sourcePosition = starts[source.location_code];
        const sourceSize = localSizesRef.current[source.location_code];

        return [{
          ...source,
          location_code: locationCode,
          barcode: null,
          children_count: 0,
          position_x: snapV(sourcePosition.x + delta.dx),
          position_y: snapV(sourcePosition.y + delta.dy),
          width: sourceSize?.w ?? source.width,
          depth: sourceSize?.h ?? source.depth,
          last_printed_at: null,
        }];
      });

      setOptimisticCreatedZones((current) => [
        ...current,
        ...duplicatedZones,
      ]);

      setFloorSettingsOpen(false);
      setSelected(new Set(
        duplicatedZones.map((zone) => zone.location_code),
      ));

      setBulkDuplicateOpen(false);
    } catch {
      // The mutation owner surfaces transport/server failure.
      // Keep the original selection and confirmation context intact.
    } finally {
      setBulkActionPending(false);
    }
  }

  async function confirmBulkDelete() {
    if (!onDeleteZones || selectedZones.length < 2) return;

    const codes = selectedZones.map((zone) => zone.location_code);

    setBulkActionPending(true);

    try {
      await onDeleteZones(codes);
      setSelected(new Set());
      setBulkDeleteOpen(false);
    } catch {
      // Atomic server failure means nothing was deleted.
      // Preserve selection so the merchant can resolve the blocker.
    } finally {
      setBulkActionPending(false);
    }
  }

  // FP-11: alignment snap for frame zones (warehouse/lane/shelf) only.
  // Unlike clampPosition, this ignores collision and only checks whether
  // the dragged zone's edges/center line up with a sibling frame zone's
  // edges/center — the goal is visual alignment (e.g. lanes A/B/C sharing
  // the same X), not overlap prevention. Threshold is in metres, converted
  // from a fixed pixel tolerance so it feels consistent at any zoom level.
  const SNAP_PX = 6;
  function getFrameAlignmentSnap(
    code: string, x: number, y: number, w: number, h: number
  ): { x: number; y: number; guideX: number | null; guideY: number | null } {
    const tol = SNAP_PX / (SCALE * zoomRef.current);
    let snappedX = x;
    let snappedY = y;
    let guideX: number | null = null;
    let guideY: number | null = null;
    let bestDx = tol;
    let bestDy = tol;

    for (const z of positionedZonesRef.current) {
      if (z.location_code === code) continue;
      if (z.type !== 'warehouse' && z.type !== 'lane' && z.type !== 'shelf') continue;
      const zx = localPositionsRef.current[z.location_code]?.x ?? parseFloat(String(z.position_x ?? 0));
      const zy = localPositionsRef.current[z.location_code]?.y ?? parseFloat(String(z.position_y ?? 0));
      const zw = localSizesRef.current[z.location_code]?.w ?? parseFloat(String(z.width ?? 1));
      const zh = localSizesRef.current[z.location_code]?.h ?? parseFloat(String(z.depth ?? 0.8));

      // X axis: compare left/center/right of dragged zone against left/center/right of sibling
      const candidatesX = [
        { dragEdge: x,             targetEdge: zx },
        { dragEdge: x,             targetEdge: zx + zw },
        { dragEdge: x + w,         targetEdge: zx },
        { dragEdge: x + w,         targetEdge: zx + zw },
        { dragEdge: x + w / 2,     targetEdge: zx + zw / 2 },
      ];
      for (const { dragEdge, targetEdge } of candidatesX) {
        const d = Math.abs(dragEdge - targetEdge);
        if (d < bestDx) {
          bestDx = d;
          snappedX = x + (targetEdge - dragEdge);
          guideX = toSvg(targetEdge);
        }
      }

      // Y axis: same, top/center/bottom
      const candidatesY = [
        { dragEdge: y,             targetEdge: zy },
        { dragEdge: y,             targetEdge: zy + zh },
        { dragEdge: y + h,         targetEdge: zy },
        { dragEdge: y + h,         targetEdge: zy + zh },
        { dragEdge: y + h / 2,     targetEdge: zy + zh / 2 },
      ];
      for (const { dragEdge, targetEdge } of candidatesY) {
        const d = Math.abs(dragEdge - targetEdge);
        if (d < bestDy) {
          bestDy = d;
          snappedY = y + (targetEdge - dragEdge);
          guideY = toSvg(targetEdge);
        }
      }
    }

    return { x: snappedX, y: snappedY, guideX, guideY };
  }

  // FP-14: alignment snap for bins and other non-frame zones — mirrors
  // FP-11's frame alignment snap, comparing against sibling collidable
  // zones instead of frames. Runs before clampPosition, which still has
  // final say — an aligned position that would overlap a neighbor is
  // resolved by clampPosition exactly as before, so this never weakens
  // collision, it only tries alignment first.
  function getBinAlignmentSnap(
    code: string, x: number, y: number, w: number, h: number
  ): { x: number; y: number; guideX: number | null; guideY: number | null } {
    const tol = SNAP_PX / (SCALE * zoomRef.current);
    let snappedX = x;
    let snappedY = y;
    let guideX: number | null = null;
    let guideY: number | null = null;
    let bestDx = tol;
    let bestDy = tol;

    for (const z of positionedZonesRef.current) {
      if (z.location_code === code) continue;
      if (z.type === 'warehouse' || z.type === 'lane' || z.type === 'shelf') continue;
      const zx = localPositionsRef.current[z.location_code]?.x ?? parseFloat(String(z.position_x ?? 0));
      const zy = localPositionsRef.current[z.location_code]?.y ?? parseFloat(String(z.position_y ?? 0));
      const zw = localSizesRef.current[z.location_code]?.w ?? parseFloat(String(z.width ?? 1));
      const zh = localSizesRef.current[z.location_code]?.h ?? parseFloat(String(z.depth ?? 0.8));

      const candidatesX = [
        { dragEdge: x,         targetEdge: zx },
        { dragEdge: x,         targetEdge: zx + zw },
        { dragEdge: x + w,     targetEdge: zx },
        { dragEdge: x + w,     targetEdge: zx + zw },
        { dragEdge: x + w / 2, targetEdge: zx + zw / 2 },
      ];
      for (const { dragEdge, targetEdge } of candidatesX) {
        const d = Math.abs(dragEdge - targetEdge);
        if (d < bestDx) {
          bestDx = d;
          snappedX = x + (targetEdge - dragEdge);
          guideX = toSvg(targetEdge);
        }
      }

      const candidatesY = [
        { dragEdge: y,         targetEdge: zy },
        { dragEdge: y,         targetEdge: zy + zh },
        { dragEdge: y + h,     targetEdge: zy },
        { dragEdge: y + h,     targetEdge: zy + zh },
        { dragEdge: y + h / 2, targetEdge: zy + zh / 2 },
      ];
      for (const { dragEdge, targetEdge } of candidatesY) {
        const d = Math.abs(dragEdge - targetEdge);
        if (d < bestDy) {
          bestDy = d;
          snappedY = y + (targetEdge - dragEdge);
          guideY = toSvg(targetEdge);
        }
      }
    }

    return { x: snappedX, y: snappedY, guideX, guideY };
  }

  // FP-12: alignment snap for resizing frame zones — extends FP-11's drag
  // snap to the resize handles. Only the far edge being dragged moves
  // (near edge/position is fixed), so this checks a single edge per axis
  // against sibling frame zones, rather than the multi-candidate set
  // getFrameAlignmentSnap uses for whole-shape dragging.
  function getFrameResizeSnap(
    code: string, curX: number, curY: number, rawW: number, rawH: number, edge: 'se' | 'e' | 's'
  ): { w: number; h: number; guideX: number | null; guideY: number | null } {
    const tol = SNAP_PX / (SCALE * zoomRef.current);
    let snappedW = rawW;
    let snappedH = rawH;
    let guideX: number | null = null;
    let guideY: number | null = null;
    let bestDx = tol;
    let bestDy = tol;

    const checkX = edge === 'e' || edge === 'se';
    const checkY = edge === 's' || edge === 'se';
    if (!checkX && !checkY) return { w: snappedW, h: snappedH, guideX, guideY };

    const farX = curX + rawW;
    const farY = curY + rawH;

    for (const z of positionedZonesRef.current) {
      if (z.location_code === code) continue;
      if (z.type !== 'warehouse' && z.type !== 'lane' && z.type !== 'shelf') continue;
      const zx = localPositionsRef.current[z.location_code]?.x ?? parseFloat(String(z.position_x ?? 0));
      const zy = localPositionsRef.current[z.location_code]?.y ?? parseFloat(String(z.position_y ?? 0));
      const zw = localSizesRef.current[z.location_code]?.w ?? parseFloat(String(z.width ?? 1));
      const zh = localSizesRef.current[z.location_code]?.h ?? parseFloat(String(z.depth ?? 0.8));

      if (checkX) {
        // FP-12b: curX + zw is a *dimension* match (same width as this
        // sibling, regardless of its position) — distinct from zx/zx+zw
        // which are positional edge matches. Same candidate mechanism,
        // just one more target to check.
        for (const targetEdge of [zx, zx + zw, curX + zw]) {
          const d = Math.abs(farX - targetEdge);
          if (d < bestDx) {
            bestDx = d;
            snappedW = targetEdge - curX;
            guideX = toSvg(targetEdge);
          }
        }
      }
      if (checkY) {
        // FP-12b: curY + zh is a depth-match candidate (same depth as
        // this sibling lane), independent of that sibling's own position.
        for (const targetEdge of [zy, zy + zh, curY + zh]) {
          const d = Math.abs(farY - targetEdge);
          if (d < bestDy) {
            bestDy = d;
            snappedH = targetEdge - curY;
            guideY = toSvg(targetEdge);
          }
        }
      }
    }

    return { w: Math.max(0.5, snappedW), h: Math.max(0.5, snappedH), guideX, guideY };
  }

  // ── Drag handlers ──────────────────────────────────────────────────────────
  function onRackMouseDown(e: React.MouseEvent, zone: WarehouseZone) {
    if (!isSelectableZone(zone) || mode === 'pan') return;
    e.stopPropagation();
    if (mode === 'marquee') return;
    setFloorSettingsOpen(false);
    if (e.shiftKey) {
      setSelected((current) => {
        const next = selectableCodes(current, positionedZonesRef.current);
        if (next.has(zone.location_code)) next.delete(zone.location_code);
        else next.add(zone.location_code);
        return next;
      });
      return;
    }

    const currentSelection = selectableCodes(
      selectedRef.current,
      positionedZonesRef.current,
    );
    const draggingExistingGroupMember =
      currentSelection.size > 1 && currentSelection.has(zone.location_code);

    if (!draggingExistingGroupMember) {
      setSelected(selectableCodes([zone.location_code], positionedZonesRef.current));
    }

    const groupStartPositions = draggingExistingGroupMember
      ? Object.fromEntries(
          [...currentSelection].map((code) => {
            const selectedZone = positionedZonesRef.current.find(
              (candidate) => candidate.location_code === code,
            );
            const position = localPositionsRef.current[code];
            return [
              code,
              {
                x: position?.x
                  ?? parseFloat(String(selectedZone?.position_x ?? placedCoords[code]?.x ?? 0)),
                y: position?.y
                  ?? parseFloat(String(selectedZone?.position_y ?? placedCoords[code]?.y ?? 0)),
              },
            ];
          }),
        )
      : undefined;

    dragRef.current = {
      locationCode: zone.location_code,
      startMouseX: e.clientX,
      startMouseY: e.clientY,
      startPosX:
        localPositionsRef.current[zone.location_code]?.x
        ?? parseFloat(String(zone.position_x ?? placedCoords[zone.location_code]?.x ?? 0)),
      startPosY:
        localPositionsRef.current[zone.location_code]?.y
        ?? parseFloat(String(zone.position_y ?? placedCoords[zone.location_code]?.y ?? 0)),
      groupStartPositions,
    };
  }

  function onCanvasMouseDown(e: React.MouseEvent) {
    if (dragRef.current) return;
    if (mode === 'pointer') {
      setSelected(new Set());
      return;
    }
    if (mode === 'marquee') {
      const rect = svgRef.current?.getBoundingClientRect();
      if (!rect) return;
      const next: MarqueeState = {
        startX: e.clientX - rect.left,
        startY: e.clientY - rect.top,
        currentX: e.clientX - rect.left,
        currentY: e.clientY - rect.top,
        shiftKey: e.shiftKey,
        baseSelection: selectableCodes(selectedRef.current, positionedZonesRef.current),
      };
      marqueeRef.current = next;
      setMarquee(next);
      return;
    }
    panRef.current = {
      startMouseX:  e.clientX,
      startMouseY:  e.clientY,
      startOffsetX: offset.x,
      startOffsetY: offset.y,
    };
  }

  // FP-05: keeps at least MARGIN px of canvas content visible on every side,
  // regardless of pan direction or zoom level, so the user can never scroll
  // the floor plan fully off-screen and lose track of where it went.
  const PAN_MARGIN = 100;
  function clampOffset(x: number, y: number, currentZoom: number) {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect) return { x, y };
    const cw = CANVAS_W * SCALE * currentZoom;
    const ch = CANVAS_H * SCALE * currentZoom;
    return {
      x: Math.min(rect.width - PAN_MARGIN, Math.max(PAN_MARGIN - cw, x)),
      y: Math.min(rect.height - PAN_MARGIN, Math.max(PAN_MARGIN - ch, y)),
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
        // Frame zones resize freely — no collision clamping.
        // FP-12: alignment snap applied here, mirroring FP-11's drag snap.
        if (zone && (zone.type === 'warehouse' || zone.type === 'lane' || zone.type === 'shelf')) {
          const snap = getFrameResizeSnap(r.locationCode, curX, curY, rawW, rawH, r.edge);
          setAlignGuides({ x: snap.guideX, y: snap.guideY });
          setLocalSizes(prev => ({ ...prev, [r.locationCode]: { w: snap.w, h: snap.h } }));
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

        // C2a: multi-selection group transform preview.
        // Every selected member receives exactly the same delta, preserving
        // relative spacing. Persistence is intentionally deferred to C2b.
        if (d.groupStartPositions && Object.keys(d.groupStartPositions).length > 1) {
          const { dx: groupDx, dy: groupDy } = clampGroupDelta(
            d.groupStartPositions,
            dxM,
            dyM,
          );

          setAlignGuides({ x: null, y: null });
          setLocalPositions((current) => {
            const next = { ...current };
            for (const [code, start] of Object.entries(d.groupStartPositions!)) {
              next[code] = {
                x: snapV(start.x + groupDx),
                y: snapV(start.y + groupDy),
              };
            }
            return next;
          });
          return;
        }

        const rawX = snapV(Math.max(0, d.startPosX + dxM));
        const rawY = snapV(Math.max(0, d.startPosY + dyM));
        const zone = positionedZonesRef.current.find(z => z.location_code === d.locationCode);
        const w    = localSizesRef.current[d.locationCode]?.w ?? parseFloat(String(zone?.width  ?? 1));
        const h    = localSizesRef.current[d.locationCode]?.h ?? parseFloat(String(zone?.depth  ?? 0.8));
        // FP-11: alignment snap runs first for frame zones (lane/warehouse/
        // shelf) — clampPosition already returns {x,y} unchanged for these
        // types, so this is purely additive, never fighting the existing
        // bin collision-snap below.
        let finalX = rawX;
        let finalY = rawY;
        if (zone && (zone.type === 'warehouse' || zone.type === 'lane' || zone.type === 'shelf')) {
          const snap = getFrameAlignmentSnap(d.locationCode, rawX, rawY, w, h);
          finalX = snap.x;
          finalY = snap.y;
          setAlignGuides({ x: snap.guideX, y: snap.guideY });
        } else {
          const snap = getBinAlignmentSnap(d.locationCode, rawX, rawY, w, h);
          finalX = snap.x;
          finalY = snap.y;
          setAlignGuides({ x: snap.guideX, y: snap.guideY });
        }
        const { x: newX, y: newY } = clampPosition(d.locationCode, finalX, finalY, w, h);
        setLocalPositions(prev => ({ ...prev, [d.locationCode]: { x: newX, y: newY } }));
        return;
      }
      if (marqueeRef.current) {
        const rect = svgRef.current?.getBoundingClientRect();
        if (!rect) return;
        const next = {
          ...marqueeRef.current,
          currentX: e.clientX - rect.left,
          currentY: e.clientY - rect.top,
        };
        marqueeRef.current = next;
        setMarquee(next);
        return;
      }
      // Pan — FP-05: clamped so the floor plan can't be dragged fully off-screen
      if (panRef.current) {
        const p = panRef.current;
        const next = clampOffset(
          p.startOffsetX + (e.clientX - p.startMouseX),
          p.startOffsetY + (e.clientY - p.startMouseY),
          zoom
        );
        setOffset(next);
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
        // FP-12: clear alignment guides on resize-end — resize returns
        // early above drag's guide-clear, so it needs its own.
        setAlignGuides({ x: null, y: null });
        return;
      }
      if (dragRef.current) {
        const d = dragRef.current;

        // C2b — persist the complete transform through one transactional
        // backend operation. Never degrade to N independent zone PATCHes.
        if (d.groupStartPositions && Object.keys(d.groupStartPositions).length > 1) {
          const starts = d.groupStartPositions;

          const positions = Object.entries(starts).map(([code, start]) => {
            const local = localPositionsRef.current[code] ?? start;

            return {
              location_code: code,
              position_x: local.x,
              position_y: local.y,
            };
          });

          // Clear the gesture before awaiting so a second mouse-up cannot
          // submit the same transform while the network request is pending.
          dragRef.current = null;
          setAlignGuides({ x: null, y: null });

          if (!onUpdateZonePositions) {
            // The module may be embedded without a persistence callback.
            // In that case preserve the previous safe C2a behavior.
            setLocalPositions((current) => {
              const next = { ...current };
              for (const [code, start] of Object.entries(starts)) {
                next[code] = { ...start };
              }
              return next;
            });
            return;
          }

          const codes = Object.keys(starts);
          for (const code of codes) savingRef.current.add(code);

          try {
            await onUpdateZonePositions(positions);
            setLastSaved(new Date());
          } catch {
            // HTTP/cache rollback happens in the page mutation; Canvas owns
            // its own local drag geometry and must roll that back as well.
            setLocalPositions((current) => {
              const next = { ...current };
              for (const [code, start] of Object.entries(starts)) {
                next[code] = { ...start };
              }
              return next;
            });
          } finally {
            for (const code of codes) savingRef.current.delete(code);
          }

          // Selection intentionally stays active after success or failure.
          return;
        }

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
      // FP-11: clear alignment guides on drag-end regardless of which
      // branch fired above — avoids a stale guide line lingering after
      // the drag stops.
      setAlignGuides({ x: null, y: null });
      if (marqueeRef.current) {
        const selectionRect = marqueeRef.current;
        const left = Math.min(selectionRect.startX, selectionRect.currentX);
        const right = Math.max(selectionRect.startX, selectionRect.currentX);
        const top = Math.min(selectionRect.startY, selectionRect.currentY);
        const bottom = Math.max(selectionRect.startY, selectionRect.currentY);
        const hits = positionedZonesRef.current.filter((zone) => {
          if (!isSelectableZone(zone) || zone.position_x == null || zone.position_y == null) return false;
          const localPosition = localPositionsRef.current[zone.location_code];
          const localSize = localSizesRef.current[zone.location_code];
          const zoneLeft = offsetRef.current.x + (localPosition?.x ?? Number(zone.position_x)) * SCALE * zoomRef.current;
          const zoneTop = offsetRef.current.y + (localPosition?.y ?? Number(zone.position_y)) * SCALE * zoomRef.current;
          const zoneRight = zoneLeft + (localSize?.w ?? Number(zone.width ?? 1)) * SCALE * zoomRef.current;
          const zoneBottom = zoneTop + (localSize?.h ?? Number(zone.depth ?? 0.8)) * SCALE * zoomRef.current;
          return left <= zoneRight && right >= zoneLeft && top <= zoneBottom && bottom >= zoneTop;
        });
        const next = selectionRect.shiftKey
          ? selectableCodes(selectionRect.baseSelection, positionedZonesRef.current)
          : new Set<string>();
        for (const zone of hits) {
          if (selectionRect.shiftKey && next.has(zone.location_code)) next.delete(zone.location_code);
          else next.add(zone.location_code);
        }
        setSelected(selectableCodes(next, positionedZonesRef.current));
        marqueeRef.current = null;
        setMarquee(null);

        // Marquee is a transient selection gesture. Once selection finishes,
        // return to Pointer so the user can immediately drag the group.
        setMode('pointer');
      }
      panRef.current = null;
    }
    // Native wheel listener on SVG — { passive: false } required to call preventDefault()
    // React synthetic onWheel cannot reliably prevent page scroll in all browsers
    // FP-05: clamped so wheel-panning can't scroll the floor plan fully off-screen
    function onWheel(e: WheelEvent) {
      e.preventDefault();
      setOffset(prev => clampOffset(
        prev.x - (e.shiftKey ? e.deltaY : e.deltaX) * 0.8,
        prev.y - (e.shiftKey ? 0 : e.deltaY) * 0.8,
        zoom
      ));
    }
    const svgEl = svgRef.current;
    if (svgEl) svgEl.addEventListener('wheel', onWheel, { passive: false });
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup',   onMouseUp);
    return () => {
      if (svgEl) svgEl.removeEventListener('wheel', onWheel);
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup',   onMouseUp);
      };
  }, [zoom, localPositions, localSizes, onUpdateZone, onUpdateZonePositions]);

  // onWheel is registered as a native listener in useEffect (passive: false required)
  const canvasW = toSvg(CANVAS_W);
  const canvasH = toSvg(CANVAS_H);

  return (
    <Box sx={{ display: 'flex', width: '100%', height: 560, border: '1px solid var(--rule)', borderRadius: 2, overflow: 'hidden', bgcolor: 'var(--bg)' }}>

      {/* LEFT — palette */}
      <ComponentPalette
        zones={zones}
        codeSourceZones={[...zones, ...optimisticCreatedZones]}
        unpositionedZones={zones.filter(z => z.position_x == null)}
        onPlace={(zone) => {
          const centreX = snapV(Math.max(0, (-offset.x + 200) / (SCALE * zoom)));
          const centreY = snapV(Math.max(0, (-offset.y + 150) / (SCALE * zoom)));
          setPlacedCoords(prev => ({ ...prev, [zone.location_code]: { x: centreX, y: centreY } }));
          onUpdateZone?.(zone.location_code, { position_x: centreX, position_y: centreY });
        }}
        onCreateComponent={createPaletteComponent}
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
          {/* FP-04: View in 3D — links out to Map instead of re-rendering
              a props-stripped IsometricCanvas inline. Only shown when the
              parent wires a handler; degrades gracefully if not. */}
          {onViewIn3D && (
            <Box onClick={onViewIn3D} title="View this layout in 3D on the Map tab"
              sx={{ display: 'flex', alignItems: 'center', gap: 0.5, px: 1.25, py: 0.4, mr: 1,
                border: '1px solid var(--rule)', borderRadius: 1.5, cursor: 'pointer',
                fontSize: 10, fontWeight: 600, letterSpacing: '0.04em', color: 'var(--ink-3)',
                '&:hover': { borderColor: 'var(--accent)', color: 'var(--accent)' } }}>
              View in 3D
            </Box>
          )}
          <Box sx={{ ml: 'auto', display: 'flex', alignItems: 'center', gap: 0.5 }}>
            <ToggleButtonGroup
              exclusive
              size="small"
              value={mode}
              aria-label="Canvas interaction mode"
              onChange={(_, nextMode: CanvasMode | null) => {
                if (!nextMode) return;
                dragRef.current = null;
                panRef.current = null;
                resizeRef.current = null;
                marqueeRef.current = null;
                setMarquee(null);
                setAlignGuides({ x: null, y: null });
                setMode(nextMode);
              }}
              sx={{ height: 24, mr: 0.5, '& .MuiToggleButton-root': { px: 0.75, py: 0, gap: 0.4, fontSize: 9, lineHeight: 1, textTransform: 'none' } }}
            >
              <ToggleButton value="pointer" aria-label="Pointer mode"><MousePointer2 size={11} />Pointer</ToggleButton>
              <ToggleButton value="marquee" aria-label="Marquee mode"><BoxSelect size={11} />Marquee</ToggleButton>
              <ToggleButton value="pan" aria-label="Pan mode"><Hand size={11} />Pan</ToggleButton>
            </ToggleButtonGroup>
            <Button
              size="small"
              variant={floorSettingsOpen ? 'contained' : 'outlined'}
              startIcon={<Settings2 size={12} />}
              disabled={!warehouseRoot}
              onClick={() => { setSelected(new Set()); setFloorSettingsOpen(true); }}
              sx={{ height: 22, minWidth: 0, px: 1, fontSize: 9, textTransform: 'none', '& .MuiButton-startIcon': { mr: 0.5 } }}
            >
              Floor settings
            </Button>
            {[{ label: '−', delta: -0.15 }, { label: '+', delta: 0.15 }].map(({ label, delta }) => (
              <Box key={label} onClick={() => setZoom(z => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z + delta)))}
                sx={{ width: 22, height: 22, display: 'flex', alignItems: 'center', justifyContent: 'center', border: '1px solid var(--rule)', borderRadius: 1, cursor: 'pointer', fontSize: 13, color: 'var(--ink-3)', bgcolor: 'var(--bg)', '&:hover': { borderColor: 'var(--accent)', color: 'var(--accent)' } }}>
                {label}
              </Box>
            ))}
            <Box sx={{ px: 1, height: 22, display: 'flex', alignItems: 'center', border: '1px solid var(--rule)', borderRadius: 1, fontSize: 10, color: 'var(--ink-3)', bgcolor: 'var(--bg)', fontFamily: 'monospace', minWidth: 40, justifyContent: 'center' }}>
              {Math.round(zoom * 100)}%
            </Box>
            <Box onClick={fitCurrentWarehouse}
              sx={{ px: 1, height: 22, display: 'flex', alignItems: 'center', border: '1px solid var(--rule)', borderRadius: 1, fontSize: 10, color: 'var(--ink-3)', bgcolor: 'var(--bg)', cursor: 'pointer', '&:hover': { borderColor: 'var(--accent)', color: 'var(--accent)' } }}>
              Reset
            </Box>
          </Box>
        </Box>

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
                data-testid="floor-planning-canvas"
                style={{ cursor: mode === 'pan' ? 'grab' : mode === 'marquee' ? 'crosshair' : 'default', userSelect: 'none', display: 'block' }}
                onMouseDown={onCanvasMouseDown}>
                <g data-testid="floor-plan-viewport" transform={`translate(${offset.x},${offset.y})`}>
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
                    const isSelected = selected.has(zone.location_code);
                    const isDragging = dragRef.current?.locationCode === zone.location_code;
                    const isWarehouse = zone.type === 'warehouse';
                    const HANDLE = 6;

                    return (
                      <g key={zone.location_code} transform={`translate(${px},${py})`}
                        data-zone-code={zone.location_code}
                        data-zone-type={zone.type}
                        onMouseDown={isWarehouse ? undefined : (e) => onRackMouseDown(e, zone)}
                        opacity={isWarehouse ? 0.55 : undefined}
                        style={{ cursor: isWarehouse ? 'default' : mode === 'pan' ? 'grab' : mode === 'marquee' ? 'default' : isDragging ? 'grabbing' : 'grab', pointerEvents: isWarehouse ? 'none' : undefined }}>
                        {isSelected && !isWarehouse && (
                          <rect x="-2" y="-2" width={pw + 4} height={ph + 4} rx="5"
                            fill="none" stroke="var(--accent)" strokeWidth="2" opacity="0.5" strokeDasharray="4 2" />
                        )}
                        {/* FP-214: three states — saving (0.5), inactive (0.35 + dashed),
                            normal (1). Saving already owned 0.5, so inactive uses a lower
                            value plus a dashed stroke to stay distinguishable mid-save. */}
                        <rect x="0" y="0" width={pw} height={ph} rx="3"
                          fill={fill}
                          stroke={isSelected ? 'var(--accent)' : stroke}
                          strokeWidth={isWarehouse ? 0.75 : isSelected ? 1.5 : 1}
                          strokeDasharray={zone.active === false ? '4 3' : undefined}
                          opacity={
                            savingRef.current.has(zone.location_code) ? 0.5
                            : zone.active === false ? 0.35
                            : 1
                          } />
                        {/* Frame label bar — always visible sticky tab at top of lane/warehouse/shelf */}
                        {(zone.type === 'lane' || zone.type === 'warehouse' || zone.type === 'shelf') ? (
                          <>
                            <rect x="0" y="0" width={Math.min(pw, 48)} height={14} rx="3"
                              fill={stroke} opacity={isWarehouse ? 0.45 : isSelected ? 0.9 : 0.7}
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
                        {isSelected && selected.size === 1 && !isWarehouse && (<>
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
                {marquee && (
                  <rect
                    data-testid="selection-marquee"
                    x={Math.min(marquee.startX, marquee.currentX)}
                    y={Math.min(marquee.startY, marquee.currentY)}
                    width={Math.abs(marquee.currentX - marquee.startX)}
                    height={Math.abs(marquee.currentY - marquee.startY)}
                    fill="var(--accent-ghost)"
                    stroke="var(--accent)"
                    strokeWidth="1.5"
                    strokeDasharray="5 3"
                    style={{ pointerEvents: 'none' }}
                  />
                )}
              {/* FP-11: alignment guide lines render outside the transformed
                  group, so offset must be added to their local coordinates. */}
                {alignGuides.x !== null && (
                  <line
                    x1={alignGuides.x + offset.x} y1={0}
                    x2={alignGuides.x + offset.x} y2={canvasH + offset.y}
                    stroke="var(--accent)" strokeWidth="1" strokeDasharray="4 3"
                    style={{ pointerEvents: 'none' }}
                  />
                )}
                {alignGuides.y !== null && (
                  <line
                    x1={0} y1={alignGuides.y + offset.y}
                    x2={canvasW + offset.x} y2={alignGuides.y + offset.y}
                    stroke="var(--accent)" strokeWidth="1" strokeDasharray="4 3"
                    style={{ pointerEvents: 'none' }}
                  />
                )}
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
              <Box onClick={z.type === 'warehouse' ? undefined : () => { setFloorSettingsOpen(false); setSelected(selectableCodes([z.location_code], positionedZones)); }}
                sx={{ px: 1, py: 0.25, borderRadius: 0.75, cursor: z.type === 'warehouse' ? 'default' : 'pointer', fontSize: 10, fontFamily: 'monospace',
                  opacity: z.type === 'warehouse' ? 0.55 : 1,
                  fontWeight: selected.has(z.location_code) ? 700 : 400,
                  color: selected.has(z.location_code) ? 'var(--accent)' : 'var(--ink-3)',
                  bgcolor: selected.has(z.location_code) ? 'var(--accent-ghost)' : 'transparent',
                  '&:hover': { color: 'var(--accent)' } }}>
                {z.location_code}
              </Box>
              {i < arr.length - 1 && <Typography sx={{ fontSize: 10, color: 'var(--rule)', mx: 0.25 }}>/</Typography>}
            </Box>
          ))}
        </Box>
      </Box>

      {/* RIGHT — inspector */}
      {floorSettingsOpen && warehouseRoot ? (
        <FloorSettingsPanel root={warehouseRoot} onClose={() => setFloorSettingsOpen(false)} onUpdateZone={onUpdateZone} />
      ) : selectedZones.length > 1 ? (
        <BulkSelectionPanel
          zones={selectedZones}
          onClear={() => setSelected(new Set())}
          onDuplicate={openBulkDuplicate}
          onDelete={openBulkDelete}
          pending={bulkActionPending}
        />
      ) : selectedZone ? (
        <RackInspector zone={selectedZone} onClose={() => setSelected(new Set())}
          onUpdateZone={onUpdateZone}
          onDeleteZone={onDeleteZone}
          onPrintBarcode={onPrintBarcode}
          onCreateZone={onCreateZone} />
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

      <DecisionConfirmationModal
        open={bulkDuplicateOpen}
        onClose={() => setBulkDuplicateOpen(false)}
        onConfirm={confirmBulkDuplicate}
        title={`Duplicate ${selectedZones.length} components?`}
        description={`${selectedZones.length} new components will be created. The originals will stay unchanged.`}
        confirmLabel="Duplicate"
        isPending={bulkActionPending}
      />

      <DecisionConfirmationModal
        open={bulkDeleteOpen}
        onClose={() => setBulkDeleteOpen(false)}
        onConfirm={confirmBulkDelete}
        title={`Delete ${selectedZones.length} components?`}
        description="The selected components will be removed. Locations with stock or dependent components outside this selection cannot be deleted."
        confirmLabel="Delete"
        tone="destructive"
        isPending={bulkActionPending}
      />
    </Box>
  );
}
