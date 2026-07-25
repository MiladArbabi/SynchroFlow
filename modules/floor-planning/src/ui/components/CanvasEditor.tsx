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
import { Box, Typography, Divider, Chip, IconButton, Paper, TextField, Dialog, DialogTitle, DialogActions, Button } from '@mui/material';
import { X, Layers, RotateCw, Copy, Trash2, Tag, Hand, MousePointer } from 'lucide-react';
import type { WarehouseZone } from '../pages/FloorPlanningModuleFT2.js';
import { WarehouseLocationType } from '@lasyncro/shared/ui';
import { IsometricCanvas } from './IsometricCanvas.js';

// ── Constants ────────────────────────────────────────────────────────────────
const SCALE      = 60;
const SNAP       = 0.1;
const MIN_ZOOM   = 0.3;
const MAX_ZOOM   = 3.0;
const CANVAS_W   = 20;
const CANVAS_H   = 15;
const RULER_SIZE = 24;

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

// Palette items — frame zones (lane) have no collision, operational zones (bin) are clamped
const PALETTE_ITEMS = [
  { type: 'lane', label: 'Aisle',      zone_type: 'pick',      defaultW: 4.4, defaultD: 1.0, defaultRackLevels: null },
  { type: 'bin',  label: 'Pick',       zone_type: 'pick',      defaultW: 1.0, defaultD: 0.5, defaultRackLevels: 3    },
  { type: 'bin',  label: 'Pack',       zone_type: 'pack',      defaultW: 2.0, defaultD: 1.5, defaultRackLevels: 2    },
  { type: 'bin',  label: 'Receive',    zone_type: 'receive',   defaultW: 3.0, defaultD: 3.0, defaultRackLevels: 1    },
  { type: 'bin',  label: 'Ship',       zone_type: 'ship',      defaultW: 4.0, defaultD: 3.0, defaultRackLevels: 1    },
  { type: 'bin',  label: 'Returns',    zone_type: 'returns',   defaultW: 3.0, defaultD: 2.0, defaultRackLevels: 1    },
  { type: 'bin',  label: 'Quarantine', zone_type: 'quarantine',defaultW: 2.0, defaultD: 2.0, defaultRackLevels: 1    },
  { type: 'bin',  label: 'Materials',  zone_type: 'kitting',   defaultW: 2.0, defaultD: 1.0, defaultRackLevels: 2    },
] as const;

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
  onPrintBarcode?: (locationCode: string) => Promise<void>;
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
}
// ── ComponentPalette ─────────────────────────────────────────────────────────
function ComponentPalette({ zones, unpositionedZones, onPlace, onCreateZone, canvasCentreX, canvasCentreY }: {
  zones: WarehouseZone[];
  unpositionedZones: WarehouseZone[];
  onPlace: (zone: WarehouseZone) => void;
  onCreateZone?: CanvasEditorProps['onCreateZone'];
  canvasCentreX: number;
  canvasCentreY: number;
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

  async function handleCreate(item: typeof PALETTE_ITEMS[number]) {
    if (!locationCode.trim() || !onCreateZone) return;
    setCreating(true);
    setError(null);
    try {
      await onCreateZone({
        location_code: locationCode.trim().toUpperCase(),
        type: item.type,
        zone_type: item.zone_type,
        position_x: canvasCentreX,
        position_y: canvasCentreY,
        width: item.defaultW,
        depth: item.defaultD,
        rack_levels: item.defaultRackLevels ?? undefined,
      });
      setActiveItem(null);
      setLocationCode('');
    } catch (e: any) {
      setError(e?.response?.data?.error ?? 'Failed to create');
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
      <Box sx={{ p: 1, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 0.75, overflowY: 'auto' }}>
        {PALETTE_ITEMS.map((item) => {
          // Frame types (lane) use type-based colour — matches canvas render
          const colorKey = item.type === 'lane' ? 'lane' : item.zone_type;
          const fill   = ZONE_COLORS[colorKey] ?? ZONE_COLORS.storage;
          const stroke = ZONE_STROKE[colorKey] ?? ZONE_STROKE.storage;
          return (
            <Box key={item.label}
              onClick={() => { setActiveItem(item.label); setLocationCode(''); setError(null); }}
              sx={{ p: 1, borderRadius: 1.5, border: `1px solid ${activeItem === item.label ? 'var(--accent)' : stroke}`,
                bgcolor: activeItem === item.label ? 'var(--accent-ghost)' : fill, cursor: 'pointer',
                display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 0.5, userSelect: 'none',
                '&:hover': { opacity: 0.8 }, transition: 'all 0.12s' }}>
              <Box sx={{ width: '100%', height: 20, borderRadius: 0.5, border: `1px solid ${stroke}`, bgcolor: fill }} />
              <Typography sx={{ fontSize: 9, fontWeight: 600, color: activeItem === item.label ? 'var(--accent)' : 'var(--ink-2)', textAlign: 'center', lineHeight: 1.2 }}>
                {item.label}
              </Typography>
              {activeItem === item.label && (
                <Box sx={{ width: '100%', mt: 0.5 }} onClick={e => e.stopPropagation()}>
                  <input
                    autoFocus
                    placeholder="Code e.g. D-1"
                    value={locationCode}
                    onChange={e => setLocationCode(e.target.value.toUpperCase())}
                    onKeyDown={e => { if (e.key === 'Enter') void handleCreate(item); if (e.key === 'Escape') setActiveItem(null); }}
                    style={{ width: '100%', fontSize: 9, fontFamily: 'monospace', padding: '2px 4px', borderRadius: 3, border: '1px solid var(--rule)', background: 'var(--bg)', color: 'var(--ink)', boxSizing: 'border-box' }}
                  />
                  {error && <Typography sx={{ fontSize: 8, color: 'rgba(239,68,68,0.9)', mt: 0.25 }}>{error}</Typography>}
                  <Box onClick={() => void handleCreate(item)}
                    sx={{ mt: 0.5, py: 0.25, borderRadius: 1, bgcolor: creating ? 'var(--ink-4)' : 'var(--accent)', color: '#fff', fontSize: 8, fontWeight: 600, textAlign: 'center', cursor: 'pointer' }}>
                    {creating ? '…' : 'Add'}
                  </Box>
                </Box>
              )}
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
        <Box sx={{ display: 'flex', gap: 2, alignItems: 'center' }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
            <Layers size={12} color="var(--ink-4)" />
            <TextField size="small" type="number"
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
              inputProps={{ min: 1, max: 20, style: { fontFamily: 'monospace', fontSize: 11, padding: '2px 4px', width: 36 } }}
              sx={{ '& fieldset': { border: 'none' }, '& .MuiInputBase-root': { bgcolor: 'var(--bg-2)', borderRadius: 1, border: '1px solid var(--rule)' } }}
            />
            <Typography sx={{ fontSize: 11, color: 'var(--ink-4)' }}>levels</Typography>
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
          <Box onClick={() => onPrintBarcode?.(zone.location_code)}
            sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 0.75, py: 1, borderRadius: 1.5, bgcolor: 'var(--accent)', color: '#fff', fontSize: 11, fontWeight: 600, cursor: 'pointer', '&:hover': { opacity: 0.9 }, transition: 'opacity 0.15s' }}>
            <Tag size={12} /> Print barcode
          </Box>
        )}
        <Box sx={{ display: 'flex', gap: 0.75 }}>
          <Box onClick={openDuplicate} sx={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 0.5, py: 0.75, borderRadius: 1.5, border: '1px solid var(--rule)', fontSize: 11, fontWeight: 500, color: 'var(--ink-3)', cursor: 'pointer', '&:hover': { borderColor: 'var(--accent)', color: 'var(--accent)' }, transition: 'all 0.15s' }}>
            <Copy size={11} /> Duplicate
          </Box>
          <Box onClick={handleDelete}
            sx={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 0.5, py: 0.75, borderRadius: 1.5, border: '1px solid var(--rule)', fontSize: 11, fontWeight: 500, color: 'var(--ink-3)', cursor: 'pointer', '&:hover': { borderColor: 'rgba(239,68,68,0.6)', color: 'rgba(239,68,68,0.9)' }, transition: 'all 0.15s' }}>
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

      {/* Delete confirmation — MUI Dialog replaces window.confirm() for design-system consistency */}
      <Dialog open={deleteOpen} onClose={() => setDeleteOpen(false)}>
        <DialogTitle sx={{ fontSize: 14 }}>
          Delete <strong>{zone.location_code}</strong>? This cannot be undone.
        </DialogTitle>
        <DialogActions>
          <Button size="small" onClick={() => setDeleteOpen(false)}>Cancel</Button>
          <Button size="small" color="error" variant="contained" onClick={confirmDelete}>Delete</Button>
        </DialogActions>
      </Dialog>
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
  onDeleteZone, 
  onCreateZone,
  onPrintBarcode,
}: CanvasEditorProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [zoom, setZoom]         = useState(1);
  const [offset, setOffset]     = useState({ x: 40, y: 40 });
  const [selected, setSelected] = useState<string | null>(null);
  const [flipped, setFlipped]   = useState(false); // angle preset: standard vs mirrored
  const [localPositions, setLocalPositions] = useState<Record<string, { x: number; y: number }>>({});
  const [localSizes, setLocalSizes]         = useState<Record<string, { w: number; h: number }>>({});
  // Optimistic placement: zones placed this session before props re-render with new coordinates
  const [placedCoords, setPlacedCoords] = useState<Record<string, { x: number; y: number }>>({});
  const [lastSaved, setLastSaved] = useState<Date | null>(null);
  const [renderMode, setRenderMode] = useState<'2D' | '3D'>('2D');
  // Interaction mode — pan (default) or select (marquee)
  const [mode, setMode] = useState<'pan' | 'select'>('pan');
  // Marquee selection rectangle — SVG canvas coordinates in pixels
  const [marquee, setMarquee] = useState<{ x1: number; y1: number; x2: number; y2: number } | null>(null);
  const marqueeRef    = useRef<{ x1: number; y1: number; x2: number; y2: number } | null>(null);
  const marqueeStartRef = useRef<{ x: number; y: number } | null>(null);

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
  const modeRef            = useRef(mode);
  const zoomRef            = useRef(zoom);
  const offsetRef          = useRef(offset);
  // Sync refs synchronously on every render — avoids stale closure in mousemove handler
  positionedZonesRef.current = positionedZones;
  localSizesRef.current      = localSizes;
  localPositionsRef.current  = localPositions;
  modeRef.current            = mode;
  zoomRef.current            = zoom;
  offsetRef.current          = offset;
  marqueeRef.current         = marquee;
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
    // In select mode: let event bubble to canvas so marquee can start over zones.
    // In pan mode: stop propagation to prevent canvas pan hijacking zone drag.
    if (modeRef.current === 'select') {
      setSelected(zone.location_code);
      return;
    }
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
    if (mode === 'select') {
      // Start marquee selection — record SVG canvas start point
      const rect = svgRef.current!.getBoundingClientRect();
      const sx = e.clientX - rect.left;
      const sy = e.clientY - rect.top;
      marqueeStartRef.current = { x: sx, y: sy };
      setMarquee({ x1: sx, y1: sy, x2: sx, y2: sy });
      return;
    }
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
      // Marquee update
      if (marqueeStartRef.current) {
        const rect = svgRef.current?.getBoundingClientRect();
        if (rect) {
          setMarquee({
            x1: marqueeStartRef.current.x,
            y1: marqueeStartRef.current.y,
            x2: e.clientX - rect.left,
            y2: e.clientY - rect.top,
          });
        }
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
      // Commit marquee selection — select all zones whose centre falls within the marquee rect
      if (marqueeStartRef.current && marqueeRef.current) {
        const minX = Math.min(marqueeRef.current.x1, marqueeRef.current.x2);
        const maxX = Math.max(marqueeRef.current.x1, marqueeRef.current.x2);
        const minY = Math.min(marqueeRef.current.y1, marqueeRef.current.y2);
        const maxY = Math.max(marqueeRef.current.y1, marqueeRef.current.y2);
        // Only select if marquee has meaningful size (not just a click)
        if (maxX - minX > 4 || maxY - minY > 4) {
          const hits = positionedZonesRef.current.filter(z => {
            const lp = localPositionsRef.current[z.location_code];
            const ls = localSizesRef.current[z.location_code];
            const zx = (lp?.x ?? parseFloat(String(z.position_x ?? 0)));
            const zy = (lp?.y ?? parseFloat(String(z.position_y ?? 0)));
            const zw = (ls?.w ?? parseFloat(String(z.width  ?? 1)));
            const zh = (ls?.h ?? parseFloat(String(z.depth  ?? 0.5)));
            // Centre of zone in SVG pixels
            const cx = offsetRef.current.x + (zx + zw / 2) * SCALE * zoomRef.current;
            const cy = offsetRef.current.y + (zy + zh / 2) * SCALE * zoomRef.current;
            return cx >= minX && cx <= maxX && cy >= minY && cy <= maxY;
          });
          if (hits.length >= 1) setSelected(hits[0].location_code);
          // Multi-select: for now select first hit — group select in future sprint
        }
        marqueeStartRef.current = null;
        setMarquee(null);
      }
      // Always clear marqueeStartRef on mouseup — prevents stale ref hijacking pan mode
      marqueeStartRef.current = null;
      setMarquee(null);
      panRef.current = null;
    }
    // Native wheel listener on SVG — { passive: false } required to call preventDefault()
    // React synthetic onWheel cannot reliably prevent page scroll in all browsers
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
    window.addEventListener('mouseup',   onMouseUp);
    return () => {
      if (svgEl) svgEl.removeEventListener('wheel', onWheel);
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup',   onMouseUp);
      };
  }, [zoom, localPositions, localSizes, onUpdateZone]);

  // onWheel is registered as a native listener in useEffect (passive: false required)
  const canvasW = toSvg(CANVAS_W);
  const canvasH = toSvg(CANVAS_H);

  return (
    <Box sx={{ display: 'flex', width: '100%', height: 560, border: '1px solid var(--rule)', borderRadius: 2, overflow: 'hidden', bgcolor: 'var(--bg)' }}>

      {/* LEFT — palette */}
      {renderMode === '2D' && <ComponentPalette
        zones={zones}
        unpositionedZones={zones.filter(z => z.position_x == null)}
        onPlace={(zone) => {
          const centreX = snapV(Math.max(0, (-offset.x + 200) / (SCALE * zoom)));
          const centreY = snapV(Math.max(0, (-offset.y + 150) / (SCALE * zoom)));
          setPlacedCoords(prev => ({ ...prev, [zone.location_code]: { x: centreX, y: centreY } }));
          onUpdateZone?.(zone.location_code, { position_x: centreX, position_y: centreY });
        }}
        onCreateZone={onCreateZone}
        canvasCentreX={snapV(Math.max(0, (-offset.x + 200) / (SCALE * zoom)))}
        canvasCentreY={snapV(Math.max(0, (-offset.y + 150) / (SCALE * zoom)))}
      />
      }

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
          {/* 2D/3D toggle — Phase 3: IsometricCanvas activates on 3D */}
          <Box sx={{ display: 'flex', border: '1px solid var(--rule)', borderRadius: 1.5, overflow: 'hidden', mr: 1 }}>
            {(['2D', '3D'] as const).map((m) => (
              <Box key={m} title={m === '3D' ? 'Isometric 2.5D view' : 'SVG floor plan'} onClick={() => setRenderMode(m)}
                sx={{ px: 1.25, py: 0.4, fontSize: 10, fontWeight: 600, letterSpacing: '0.04em',
                  cursor: 'pointer',
                  bgcolor: renderMode === m ? 'var(--accent)' : 'transparent',
                  color:   renderMode === m ? '#fff' : 'var(--ink-4)',
                  transition: 'all 0.15s' }}>
                {m}
              </Box>
            ))}
          </Box>
          {/* Mode toggle — Pan (default) or Select (marquee) */}
          <Box sx={{ display: 'flex', border: '1px solid var(--rule)', borderRadius: 1.5, overflow: 'hidden', mr: 1 }}>
            {([
              { m: 'pan'    as const, icon: <Hand size={12} />,          title: 'Pan mode — drag to pan canvas' },
              { m: 'select' as const, icon: <MousePointer size={12} />,  title: 'Select mode — click or drag to select zones' },
            ]).map(({ m, icon, title }) => (
              <Box key={m} title={title} onClick={() => setMode(m)}
                sx={{ px: 1.25, py: 0.4, display: 'flex', alignItems: 'center', cursor: 'pointer',
                  bgcolor: mode === m ? 'var(--accent)' : 'transparent',
                  color:   mode === m ? '#fff' : 'var(--ink-4)',
                  transition: 'all 0.15s' }}>
                {icon}
              </Box>
            ))}
          </Box>
          {renderMode === '2D' && <Box sx={{ ml: 'auto', display: 'flex', alignItems: 'center', gap: 0.5 }}>
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
          }
        </Box>

        {/* Rulers + SVG — 2D mode only */}
        {renderMode === '3D' && (
          <Box sx={{ flex: 1, overflow: 'hidden' }}>
            <IsometricCanvas zones={zones} onSelect={(code) => setSelected(code)} />
          </Box>
        )}
        {renderMode === '2D' && <Box sx={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
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
                style={{ cursor: mode === 'select' ? 'crosshair' : 'grab', userSelect: 'none', display: 'block' }}
                onMouseDown={onCanvasMouseDown}>
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
              {/* Marquee selection rectangle — rendered outside transform group in screen coords */}
                {marquee && (
                  <rect
                    x={Math.min(marquee.x1, marquee.x2)}
                    y={Math.min(marquee.y1, marquee.y2)}
                    width={Math.abs(marquee.x2 - marquee.x1)}
                    height={Math.abs(marquee.y2 - marquee.y1)}
                    fill="var(--accent-ghost)" stroke="var(--accent)"
                    strokeWidth="1" strokeDasharray="4 2"
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
        }

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
        <RackInspector zone={selectedZone} onClose={() => setSelected(null)}
          onUpdateZone={renderMode === '2D' ? onUpdateZone : undefined}
          onDeleteZone={renderMode === '2D' ? onDeleteZone : undefined}
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
    </Box>
  );
}