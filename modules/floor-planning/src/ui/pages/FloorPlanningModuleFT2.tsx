// modules/floor-planning/src/ui/pages/FloorPlanningModuleFT2.tsx
import { useState, useCallback, useMemo } from 'react';
import {
  Box,
  Paper,
  Typography,
  Alert,
  Chip,
  Divider,
  TextField,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Collapse,
  IconButton,
  Tab,
  Tabs,
  Checkbox,
  Button,
  FormControl,
  InputLabel,
  MenuItem,
  Select,
} from '@mui/material';
import { LayoutDashboard, Tag, PackageSearch, ChevronDown, ChevronUp, Map, RefreshCw, ScrollText, Eye, EyeOff, Trash2, Plus } from 'lucide-react';
import { ModuleErrorBoundary, ModuleLoadingSkeleton, WarehouseGrid } from '@lasyncro/shared/ui';
import type { WarehouseLocation, BinOccupancy, BinLogResponse, BinStats, WarehouseLocationType } from '@lasyncro/shared/ui';
import { PrintPreviewPanel } from '../components/PrintPreviewPanel.js';
import { BinLogDrawer } from '../components/BinLogDrawer.js';
import { CanvasEditor } from '../components/CanvasEditor.js';

/**
 * FLOOR PLANNING MODULE — FT2 SURFACE
 * -------------------------------------
 * Manages warehouse floor zones and barcode assignments
 * for floors (locations) and products (variants).
 *
 * All API data injected via props — module stays decoupled
 * from apps/frontend HTTP layer.
 *
 * Data model:
 *   warehouse_locations — location_code, type, barcode (system-generated)
 *   variants + external_product_identity_map — lasyncro_variant_id, sku, supplier barcode
 *
 * Theme-aware: Paper, theme.palette tokens, no hardcoded colors.
 */

export type LocationType = 'warehouse' | 'lane' | 'shelf' | 'bin';

export type WarehouseZone = {
  location_code: string;
  type: LocationType;
  parent_location_code: string | null;
  barcode: string | null;
  active: boolean;
  children_count: number;
  position_x: number | null;
  position_y: number | null;
  width: number | null;
  depth: number | null;
  orientation: number;
  rack_levels: number | null;
  zone_type: string | null;
};

export type ProductBarcode = {
  lasyncro_variant_id: string;
  sku: string | null;
  product_title: string;
  variant_title: string | null;
  barcode: string | null;
};

export type FloorPlanningData = {
  zones: WarehouseZone[];
  product_barcodes: ProductBarcode[];
} | null;

export type FloorPlanningPageProps = {
  data: FloorPlanningData;
  isLoading: boolean;
  isError: boolean;
  onRefresh: () => void;
  /** Grid data — loaded separately for fast layout paint */
  gridLocations?: WarehouseLocation[];
  gridOccupancy?: Record<string, BinOccupancy>;
  isGridLoading?: boolean;
  binLog?: BinLogResponse;
  isBinLogLoading?: boolean;
  onBinLogOpen?: (locationCode: string) => void;
  binStats?: BinStats;
  onBinSelect?: (locationCode: string) => void;
  variantFocusBins?: string[];
  onCreateZone?: (payload: { location_code: string; type: WarehouseLocationType; parent_location_code?: string }) => Promise<void>;
  onDeleteZone?: (locationCode: string) => Promise<void>;
  onToggleZoneActive?: (locationCode: string, active: boolean) => Promise<void>;
  onUpdateProductBarcode?: (lasyncroVariantId: string, barcode: string) => Promise<void>;
  /** Controlled tab — gate page syncs to URL search params for persistence across refreshes */
  activeTab?: 'map' | 'setup' | 'barcodes';
  onTabChange?: (tab: 'map' | 'setup' | 'barcodes') => void;
  activeView?: 'list' | 'canvas';
  onViewChange?: (view: 'list' | 'canvas') => void;
  activeSubTab?: 'locations' | 'products';
  onSubTabChange?: (subTab: 'locations' | 'products') => void;
  onUpdateZone?: (locationCode: string, payload: {
    position_x?: number | null;
    position_y?: number | null;
    width?: number | null;
    depth?: number | null;
    orientation?: number;
    rack_levels?: number | null;
    zone_type?: string | null;
  }) => Promise<void>;
};

const TYPE_LABELS: Record<LocationType, {
  label: string;
  color: 'default' | 'primary' | 'secondary' | 'warning' | 'info';
}> = {
  warehouse: { label: 'Warehouse', color: 'primary'   },
  lane:      { label: 'Lane',      color: 'secondary' },
  shelf:     { label: 'Shelf',     color: 'info'      },
  bin:       { label: 'Bin',       color: 'warning'   },
};

function ZoneCard({ zone, onDelete, onToggleActive }: {
  zone: WarehouseZone;
  onDelete?: (code: string) => void;
  onToggleActive?: (code: string, active: boolean) => void;
}) {
  const type = TYPE_LABELS[zone.type] ?? { label: zone.type, color: 'default' as const };
  return (
    <Paper variant="outlined" sx={{ p: 2, mb: 1.5, borderRadius: 2, opacity: zone.active ? 1 : 0.5 }}>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1 }}>
        <Typography variant="body2" fontWeight={700} sx={{ fontFamily: 'monospace' }}>
          {zone.location_code}
        </Typography>
        <Box sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
          {!zone.active && <Chip label="Inactive" size="small" color="default" />}
          <Chip label={type.label} size="small" color={type.color} />
          <IconButton
            size="small"
            title={zone.active ? 'Deactivate' : 'Activate'}
            onClick={() => onToggleActive?.(zone.location_code, !zone.active)}
            sx={{ color: zone.active ? 'var(--accent)' : 'var(--ink-4)' }}
          >
            {zone.active ? <EyeOff size={14} /> : <Eye size={14} />}
          </IconButton>
          <IconButton
            size="small"
            title="Delete zone"
            onClick={() => onDelete?.(zone.location_code)}
            sx={{ color: 'var(--ink-4)', '&:hover': { color: 'error.main' } }}
          >
            <Trash2 size={14} />
          </IconButton>
        </Box>
      </Box>

      {zone.parent_location_code && (
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.5 }}>
          Parent: {zone.parent_location_code}
        </Typography>
      )}
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mt: 1 }}>
        <Tag size={13} />
        <Typography variant="caption" sx={{ fontFamily: 'monospace' }} color={zone.barcode ? 'text.primary' : 'text.disabled'}>
          {zone.barcode ?? 'No barcode assigned'}
        </Typography>
      </Box>
      {zone.children_count > 0 && (
        <Typography variant="caption" color="text.secondary" sx={{ mt: 0.5, display: 'block' }}>
          {zone.children_count} child location{zone.children_count > 1 ? 's' : ''}
        </Typography>
      )}
    </Paper>
  );
}

function ProductBarcodesTable({ 
  items, onUpdateProductBarcode 
} : { items: ProductBarcode[]; onUpdateProductBarcode?: (
  lasyncroVariantId: string, 
  barcode: string) => Promise<void> 
}) {
  const [filter, setFilter]                 = useState('');
  const [showUnassigned, setShowUnassigned] = useState(false);
  // Inline edit state: tracks which variant is being edited and the draft value
  const [editingId, setEditingId]           = useState<string | null>(null);
  const [editValue, setEditValue]           = useState('');
  const [saving, setSaving]                 = useState(false);
  const [saveError, setSaveError]           = useState<string | null>(null);

  async function handleSave(lasyncroVariantId: string) {
    if (!editValue.trim() || !onUpdateProductBarcode) return;
    setSaving(true);
    setSaveError(null);
    try {
      await onUpdateProductBarcode(lasyncroVariantId, editValue.trim());
      setEditingId(null);
    } catch {
      setSaveError('Failed to save barcode');
    } finally {
      setSaving(false);
    }
  }

  const assigned = items.filter((i) => i.barcode !== null);
  const unassigned = items.filter((i) => i.barcode === null);

  const filtered = assigned.filter((i) => {
    const q = filter.toLowerCase();
    return (
      !q ||
      i.sku?.toLowerCase().includes(q) ||
      i.lasyncro_variant_id.toLowerCase().includes(q) ||
      i.barcode?.toLowerCase().includes(q)
    );
  });

  return (
    <Box>
      <TextField
        placeholder="Filter by SKU or barcode..."
        size="small"
        fullWidth
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
        sx={{ mb: 2 }}
        InputProps={{ sx: { fontFamily: 'monospace', fontSize: 13 } }}
      />

      {/* ASSIGNED BARCODES — compact table */}
      {assigned.length === 0 && unassigned.length === 0 ? (
        <Paper variant="outlined" sx={{ textAlign: 'center', py: 6, borderRadius: 2, borderStyle: 'dashed' }}>
          <PackageSearch size={36} style={{ opacity: 0.3 }} />
          <Typography variant="body2" color="text.secondary" sx={{ mt: 2 }}>
            No product barcodes found.
          </Typography>
        </Paper>
      ) : (
        <>
          {assigned.length > 0 && (
            <TableContainer component={Paper} variant="outlined" sx={{ borderRadius: 2, mb: 2 }}>
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell sx={{ fontWeight: 700, fontSize: 11 }}>LaSyncro ID</TableCell>
                    <TableCell sx={{ fontWeight: 700, fontSize: 11 }}>SKU</TableCell>
                    <TableCell sx={{ fontWeight: 700, fontSize: 11 }}>Supplier Barcode</TableCell>
                    <TableCell sx={{ fontWeight: 700, fontSize: 11, width: 80 }} />
                  </TableRow>
                </TableHead>
                <TableBody>
                  {filtered.map((item) => (
                    <TableRow key={item.lasyncro_variant_id} hover>
                      <TableCell sx={{ fontFamily: 'monospace', fontSize: 11 }}>
                        {item.lasyncro_variant_id.slice(0, 8)}…
                      </TableCell>
                      <TableCell sx={{ fontSize: 12 }}>
                        {item.sku ?? <Typography variant="caption" color="text.disabled">—</Typography>}
                      </TableCell>
                      <TableCell sx={{ fontFamily: 'monospace', fontSize: 12, fontWeight: 700 }}>
                        {editingId === item.lasyncro_variant_id ? (
                          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
                            <TextField
                              size="small"
                              value={editValue}
                              onChange={(e) => setEditValue(e.target.value)}
                              onKeyDown={(e) => { if (e.key === 'Enter') void handleSave(item.lasyncro_variant_id); if (e.key === 'Escape') setEditingId(null); }}
                              autoFocus
                              inputProps={{ style: { fontFamily: 'monospace', fontSize: 12, padding: '2px 6px' } }}
                              sx={{ width: 140 }}
                              error={!!saveError}
                              helperText={saveError ?? undefined}
                            />
                            <Box
                              onClick={() => void handleSave(item.lasyncro_variant_id)}
                              sx={{ px: 1, py: 0.25, borderRadius: 1, bgcolor: 'var(--accent)', color: '#fff', fontSize: 11, fontWeight: 600, cursor: saving ? 'not-allowed' : 'pointer', opacity: saving ? 0.6 : 1 }}
                            >
                              {saving ? '…' : 'Save'}
                            </Box>
                            <Box onClick={() => setEditingId(null)} sx={{ fontSize: 11, color: 'var(--ink-4)', cursor: 'pointer' }}>✕</Box>
                          </Box>
                        ) : (
                          item.barcode
                        )}
                      </TableCell>
                      {/* Edit action — only rendered when onUpdateProductBarcode is wired */}
                      <TableCell>
                        {onUpdateProductBarcode && editingId !== item.lasyncro_variant_id && (
                          <Box
                            onClick={() => { setEditingId(item.lasyncro_variant_id); setEditValue(item.barcode ?? ''); setSaveError(null); }}
                            sx={{ fontSize: 10, fontWeight: 600, color: 'var(--accent)', cursor: 'pointer', letterSpacing: '0.04em', '&:hover': { textDecoration: 'underline' } }}
                          >
                            Edit
                          </Box>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                  {filtered.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={4} sx={{ textAlign: 'center', color: 'text.secondary', py: 3 }}>
                        No results match your filter.
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </TableContainer>
          )}

          {/* UNASSIGNED — collapsed by default */}
          {unassigned.length > 0 && (
            <Paper variant="outlined" sx={{ borderRadius: 2 }}>
              <Box
                sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', px: 2, py: 1.5, cursor: 'pointer' }}
                onClick={() => setShowUnassigned((v) => !v)}
              >
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                  <Typography variant="body2" color="text.secondary">
                    {unassigned.length} product{unassigned.length > 1 ? 's' : ''} without barcode
                  </Typography>
                  <Chip label="No barcode" size="small" color="default" />
                </Box>
                <IconButton size="small">
                  {showUnassigned ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                </IconButton>
              </Box>
              <Collapse in={showUnassigned}>
                <Divider />
                <Table size="small">
                  <TableHead>
                    <TableRow>
                      <TableCell sx={{ fontWeight: 700, fontSize: 11 }}>LaSyncro ID</TableCell>
                      <TableCell sx={{ fontWeight: 700, fontSize: 11 }}>SKU</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {unassigned.map((item) => (
                      <TableRow key={item.lasyncro_variant_id} hover>
                        <TableCell sx={{ fontFamily: 'monospace', fontSize: 11 }}>
                          {item.lasyncro_variant_id.slice(0, 8)}…
                        </TableCell>
                        <TableCell sx={{ fontSize: 12 }}>
                          {item.sku ?? <Typography variant="caption" color="text.disabled">—</Typography>}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </Collapse>
            </Paper>
          )}
        </>
      )}
    </Box>
  );
}

/**
 * BarcodesTab — Locations + Products sub-tabs.
 * Locations data sourced from warehouse_locations (zones prop).
 * Products data sourced from variants + external_product_identity_map.
 */
type LocationFilter = 'all' | 'bin' | 'lane' | 'shelf' | 'warehouse' | 'tote' | 'dock' | 'ship' | 'pack' | 'ret' | 'kit';
const FILTER_PILLS: { label: string; value: LocationFilter }[] = [
  { label: 'ALL',       value: 'all'       },
  { label: 'BIN',       value: 'bin'       },
  { label: 'LANE',      value: 'lane'      },
  { label: 'SHELF',     value: 'shelf'     },
  { label: 'WAREHOUSE', value: 'warehouse' },
  { label: 'TOTE',      value: 'tote'      },
  { label: 'DOCK',      value: 'dock'      },
  { label: 'SHIP',      value: 'ship'      },
  { label: 'PACK',      value: 'pack'      },
  { label: 'RET',       value: 'ret'       },
  { label: 'KIT',       value: 'kit'       },
];

function BarcodesTab({ 
  zones, 
  productBarcodes, 
  onUpdateProductBarcode,
  activeSubTab,
  onSubTabChange,
}: { 
  zones: WarehouseZone[]; 
  productBarcodes: ProductBarcode[]; 
  onUpdateProductBarcode?: (lasyncroVariantId: string, barcode: string) => Promise<void>;
  activeSubTab?: 'locations' | 'products';
  onSubTabChange?: (subTab: 'locations' | 'products') => void;
}) {
  const [subTab, setSubTab] = useState<'locations' | 'products'>(activeSubTab ?? 'locations');
  const [locFilter, setLocFilter]     = useState<LocationFilter>('all');
  const [locSearch, setLocSearch]     = useState('');
  const [selected, setSelected]       = useState<Set<string>>(new Set());

  const toggleOne  = (code: string) => setSelected((prev) => { const s = new Set(prev); s.has(code) ? s.delete(code) : s.add(code); return s; });
  const toggleAll  = (codes: string[]) => setSelected((prev) => prev.size === codes.length ? new Set() : new Set(codes));

  const barcoded      = zones.filter((z) => z.barcode !== null);
  const missing       = zones.filter((z) => z.barcode === null);
  // Aisles fully labelled: lane-type zones that have a barcode assigned
  const aisles        = zones.filter((z) => z.type === 'lane');
  const aislesLabelled = aisles.filter((z) => z.barcode !== null);
  const fullLabelled = aisles.length;

  const filteredZones = zones.filter((z) => {
    const matchesType   = locFilter === 'all' || z.type === locFilter;
    const matchesSearch = !locSearch || z.location_code.toLowerCase().includes(locSearch.toLowerCase()) || z.barcode?.toLowerCase().includes(locSearch.toLowerCase());
    return matchesType && matchesSearch;
  });
  const selectedZoneObjects = zones.filter((z) => selected.has(z.location_code));
  const allFilteredCodes    = filteredZones.map((z) => z.location_code);
  const allSelected         = allFilteredCodes.length > 0 && allFilteredCodes.every((c) => selected.has(c));

  return (
    <Box>
      {/* Sub-tab toggle */}
      <Box sx={{ display: 'flex', gap: 1, mb: 3 }}>
        {(['locations', 'products'] as const).map((st) => (
          <Box
            key={st}
            onClick={() => { setSubTab(st); onSubTabChange?.(st); }}
            sx={{
              px: 2, py: 0.75, borderRadius: 1.5, cursor: 'pointer', fontSize: 13, fontWeight: 500,
              border: '1px solid',
              borderColor: subTab === st ? 'var(--accent)' : 'var(--rule)',
              color: subTab === st ? 'var(--accent)' : 'var(--ink-3)',
              bgcolor: subTab === st ? 'var(--accent-ghost)' : 'transparent',
              transition: 'all 0.15s',
            }}
          >
            {st === 'locations' ? `Locations  ${zones.length}` : `Products  ${productBarcodes.length}`}
          </Box>
        ))}
      </Box>

      {subTab === 'locations' && (
        <Box sx={{ display: 'flex', gap: 3, alignItems: 'flex-start' }}>
          <Box sx={{ flex: 1, minWidth: 0 }}>
          {/* Search + filter pills */}
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 2, flexWrap: 'wrap' }}>
            <TextField
              placeholder="Filter by code or zone..."
              size="small"
              value={locSearch}
              onChange={(e) => setLocSearch(e.target.value)}
              sx={{ width: 220 }}
              InputProps={{ sx: { fontFamily: 'monospace', fontSize: 12 } }}
            />
            <Box sx={{ display: 'flex', gap: 0.75 }}>
              {FILTER_PILLS.map(({ label, value }) => (
                <Box
                  key={value}
                  onClick={() => setLocFilter(value)}
                  sx={{
                    px: 1.25, py: 0.4, borderRadius: 1, cursor: 'pointer', fontSize: 11, fontWeight: 600, letterSpacing: '0.06em',
                    border: '1px solid',
                    borderColor: locFilter === value ? 'var(--accent)' : 'var(--rule)',
                    color: locFilter === value ? 'var(--accent)' : 'var(--ink-4)',
                    bgcolor: locFilter === value ? 'var(--accent-ghost)' : 'transparent',
                    transition: 'all 0.12s',
                  }}
                >
                  {label}
                </Box>
              ))}
            </Box>
          </Box>
          {/* Section label + print action — matches target design */}
          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1.5 }}>
            <Typography sx={{ fontSize: 10, fontWeight: 500, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--ink-4)' }}>
              Location Barcodes · This Floor
            </Typography>
          </Box>
          {/* Stat row */}
          <Box sx={{ display: 'flex', gap: 2, mb: 3 }}>
            {[
              { label: 'Total locations',     value: zones.length,          color: 'var(--ink)'    },
              { label: 'Barcoded',            value: barcoded.length,       color: 'var(--accent)' },
              { label: 'Missing barcode',     value: missing.length,        color: missing.length > 0 ? 'var(--accent)' : 'var(--ink-3)' },
              // Shows barcoded/total aisles fraction — matches target design "6/7" format
              { label: 'Aisles fully labelled', value: `${aislesLabelled.length}/${aisles.length}`, color: 'var(--ink)' },
            ].map(({ label, value, color }) => (
              <Box key={label} sx={{ flex: 1, p: 2, border: '1px solid var(--rule)', borderRadius: 2, bgcolor: 'var(--bg-2)' }}>
                <Typography sx={{ fontSize: 10, fontWeight: 500, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--ink-4)', mb: 0.5 }}>
                  {label}
                </Typography>
                <Typography sx={{ fontSize: 28, fontWeight: 500, color, lineHeight: 1.1, fontVariantNumeric: 'tabular-nums' }}>
                  {value}
                </Typography>
              </Box>
            ))}
          </Box>

          {/* Locations table */}
          <TableContainer component={Paper} variant="outlined" sx={{ borderRadius: 2 }}>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell padding="checkbox" sx={{ width: 40 }}>
                    <Checkbox
                      size="small"
                      checked={allSelected}
                      indeterminate={selected.size > 0 && !allSelected}
                      onChange={() => toggleAll(allFilteredCodes)}
                      sx={{ color: 'var(--ink-4)', '&.Mui-checked': { color: 'var(--accent)' }, '&.MuiCheckbox-indeterminate': { color: 'var(--accent)' } }}
                    />
                  </TableCell>
                    <TableCell sx={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--ink-4)' }}>Code</TableCell>
                    <TableCell sx={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--ink-4)' }}>Type</TableCell>
                    <TableCell sx={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--ink-4)' }}>Zone</TableCell>
                    <TableCell sx={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--ink-4)' }}>Barcode</TableCell>
                    <TableCell sx={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--ink-4)' }}>Last Printed</TableCell>
                    <TableCell sx={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--ink-4)' }}>Status</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {filteredZones.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={7} sx={{ textAlign: 'center', color: 'var(--ink-4)', py: 4 }}>
                      No locations configured. Add zones in Setup.
                    </TableCell>
                  </TableRow>
                ) : (
                  filteredZones.map((z) => (
                      <TableRow key={z.location_code} hover selected={selected.has(z.location_code)} onClick={() => toggleOne(z.location_code)} sx={{ cursor: 'pointer' }}>
                        <TableCell padding="checkbox">
                          <Checkbox
                            size="small"
                            checked={selected.has(z.location_code)}
                            onChange={() => toggleOne(z.location_code)}
                            onClick={(e) => e.stopPropagation()}
                            sx={{ color: 'var(--ink-4)', '&.Mui-checked': { color: 'var(--accent)' } }}
                          />
                        </TableCell>
                        <TableCell sx={{ fontFamily: 'monospace', fontSize: 12, fontWeight: 600 }}>{z.location_code}</TableCell>
                      <TableCell>
                        <Chip
                          label={TYPE_LABELS[z.type]?.label ?? z.type}
                          size="small"
                          color={TYPE_LABELS[z.type]?.color ?? 'default'}
                        />
                      </TableCell>
                      {/* Zone — zone_type from migration 0108, falls back to parent for structural types */}
                      <TableCell sx={{ fontSize: 11, color: 'var(--ink-3)', textTransform: 'capitalize' }}>
                        {z.zone_type ?? z.parent_location_code ?? <Typography component="span" sx={{ color: 'var(--ink-4)', fontSize: 11 }}>—</Typography>}
                      </TableCell>
                      <TableCell sx={{ fontFamily: 'monospace', fontSize: 11 }}>
                        {z.barcode ?? <Typography component="span" sx={{ color: 'var(--ink-4)', fontSize: 11 }}>No barcode</Typography>}
                      </TableCell>
                      {/* Last Printed — no data model yet, stub shows Never. Phase 3: add last_printed_at to warehouse_locations */}
                      <TableCell sx={{ fontSize: 11, color: 'var(--ink-4)' }}>
                        Never
                      </TableCell>
                      <TableCell>
                        {z.active
                          ? <Typography sx={{ fontSize: 11, fontWeight: 600, color: 'var(--accent)' }}>✓ ACTIVE</Typography>
                          : <Typography sx={{ fontSize: 11, color: 'var(--ink-4)' }}>INACTIVE</Typography>}
                      </TableCell>
                    </TableRow>
                  ))
                )}
               </TableBody>
             </Table>
            </TableContainer>
           </Box>
          <Box sx={{
            width: selected.size > 0 ? 260 : 0,
            opacity: selected.size > 0 ? 1 : 0,
            overflow: 'hidden',
            transition: 'width 0.25s ease, opacity 0.2s ease',
            flexShrink: 0,
          }}>
            <PrintPreviewPanel selectedZones={selectedZoneObjects} />
          </Box>
        </Box>
      )}

      {subTab === 'products' && (
        <Box>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2 }}>
            <PackageSearch size={18} />
            <Typography variant="subtitle1" fontWeight={700}>Product Barcodes</Typography>
            <Chip label={productBarcodes.length} size="small" />
          </Box>
          <ProductBarcodesTable 
            items={productBarcodes} 
            onUpdateProductBarcode={onUpdateProductBarcode} 
          />
        </Box>
      )}
    </Box>
  );
}

function FloorPlanningModuleFT2Inner({
  data,
  isLoading,
  isError,
  gridLocations,
  gridOccupancy,
  isGridLoading,
  onRefresh,
  binLog,
  isBinLogLoading,
  onBinLogOpen,
  binStats,
  onBinSelect,
  variantFocusBins,
  onCreateZone,
  onDeleteZone,
  onToggleZoneActive,
  onUpdateZone,
  onUpdateProductBarcode,
  onTabChange,
  activeTab,
  activeView,
  onViewChange,
  activeSubTab,
  onSubTabChange,
}: FloorPlanningPageProps) {
  const zones = data?.zones ?? [];
  const productBarcodes = data?.product_barcodes ?? [];
  const [tab, setTab] = useState<'map' | 'setup' | 'barcodes'>(activeTab ?? 'map');
  const [selectedBin, setSelectedBin] = useState<string | undefined>();
  type OverlayId = 'occupancy' | 'stockout' | 'empty' | 'none';
  const [overlay, setOverlay]         = useState<OverlayId>('occupancy');
  // Filter by zone_type (operational) not location type — matches target design filter rail
  const [zoneFilters, setZoneFilters] = useState<Set<string>>(new Set(['pick', 'pack', 'receive', 'ship', 'returns', 'quarantine', 'kitting', 'storage']));
  const [canvasView, setCanvasView] = useState(activeView === 'canvas');

  // Derive grid props from overlay selection
  const overlayGridMode = overlay === 'none' ? 'map' : overlay === 'stockout' || overlay === 'empty' ? 'focus' : 'heatmap';
  const overlayFocusedBins = useMemo(() => {
    if (overlay === 'empty') {
      return (gridLocations ?? [])
        .filter(l => l.type === 'bin' && ((gridOccupancy?.[l.location_code]?.on_hand_quantity ?? 0) === 0))
        .map(l => l.location_code);
    }
    if (overlay === 'stockout') {
      // Bins with stock but critically low — on_hand_quantity > 0 but <= 3 units
      return (gridLocations ?? [])
        .filter(l => l.type === 'bin') 
        .filter(l => {
          const qty = gridOccupancy?.[l.location_code]?.on_hand_quantity ?? 0;
          return qty > 0 && qty <= 3;
        })
        .map(l => l.location_code);
    }
    return undefined;
  }, [overlay, gridLocations, gridOccupancy]);

  const filteredGridLocations = useMemo(() =>
    // Filter by zone_type — matches filter rail zone checkboxes (pick/pack/receive etc.)
    // Falls back to showing location if zone_type is null (unclassified locations)
    (gridLocations ?? []).filter(l => l.zone_type == null || zoneFilters.has(l.zone_type)),
    [gridLocations, zoneFilters]
  );
  const handleBinSelect = useCallback((lc: string) => {
    setSelectedBin((p) => {
      const next = p === lc ? undefined : lc;
      onBinSelect?.(next ?? '');
      return next;
    });
  }, [onBinSelect]);
  const [logOpen, setLogOpen]           = useState(false);
  const [createOpen, setCreateOpen]     = useState(false);
  const [createType, setCreateType]     = useState<WarehouseLocationType>('bin');
  const [createCode, setCreateCode]     = useState('');
  const [createParent, setCreateParent] = useState('');
  const [createError, setCreateError]   = useState<string | null>(null);
  const [creating, setCreating]         = useState(false);
  const [createLoading, setCreateLoading] = useState(false);

  const binCount      = (gridLocations ?? []).filter((l) => l.type === 'bin').length;
  const setupCount    = zones.length;
  const barcodesCount = zones.filter((z) => z.barcode !== null).length + productBarcodes.filter((p) => p.barcode !== null).length;

    const handleCreate = async () => {
    if (!createCode.trim()) { setCreateError('Location code is required'); return; }
    setCreating(true);
    setCreateError(null);
    try {
      await onCreateZone?.({
        location_code: createCode.trim().toUpperCase(),
        type: createType,
        parent_location_code: createParent.trim() || undefined,
      });
      setCreateCode('');
      setCreateParent('');
      setCreateOpen(false);
    } catch (err: any) {
      setCreateError(err?.response?.data?.error ?? 'Failed to create zone');
    } finally {
      setCreating(false);
    }
  };
  
  return (
    <Box sx={{ p: '32px 40px', minHeight: '100%', bgcolor: 'var(--bg)' }}>

      {/* Per-tab header — serif pattern matches Overview/Orders modules */}
      {(() => {
        const now      = new Date();
        const dayLabel = now.toLocaleDateString('en-GB', { weekday: 'long', month: 'long', day: 'numeric' }).toUpperCase();
        return (
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1.5 }}>
            <Box sx={{ width: 6, height: 6, borderRadius: '50%', bgcolor: 'var(--accent)', flexShrink: 0 }} />
            <Typography sx={{ fontSize: 10, fontWeight: 500, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--ink-4)' }}>
              {dayLabel} · Warehouse · Floor 1
            </Typography>
          </Box>
        );
      })()}
      {tab === 'map' && (() => {
        const bins   = (gridLocations ?? []).filter((l) => l.type === 'bin');
        const aisles = new Set(bins.map((l) => l.location_code.split('-')[0])).size;
        const hot    = Object.values(gridOccupancy ?? {}).filter((o) => o.on_hand_quantity > 0).length;
        const subLine = bins.length > 0
          ? `${bins.length} bin${bins.length !== 1 ? 's' : ''} across ${aisles} aisle${aisles !== 1 ? 's' : ''} · ${hot} bin${hot !== 1 ? 's' : ''} with stock`
          : 'No bins configured yet — add aisles and bins in Setup.';
        return <>
          <Typography sx={{ fontFamily: '"DM Serif Display", serif', fontSize: 36, fontWeight: 400, color: 'var(--ink)', lineHeight: 1.15, display: 'inline' }}>Floor planning today.{' '}</Typography>
          <Typography sx={{ fontFamily: '"DM Serif Display", serif', fontSize: 36, fontWeight: 400, fontStyle: 'italic', color: 'var(--accent)', lineHeight: 1.15, display: 'inline' }}>Here's how the racks are running.</Typography>
          <Typography sx={{ fontSize: 13, color: 'var(--ink-3)', mt: 1, mb: 0.5 }}>{subLine}</Typography>
        </>;
      })()}
      {tab === 'setup' && <>
        <Typography sx={{ fontFamily: '"DM Serif Display", serif', fontSize: 36, fontWeight: 400, color: 'var(--ink)', lineHeight: 1.15, display: 'inline' }}>Build your warehouse.{' '}</Typography>
        <Typography sx={{ fontFamily: '"DM Serif Display", serif', fontSize: 36, fontWeight: 400, fontStyle: 'italic', color: 'var(--accent)', lineHeight: 1.15, display: 'inline' }}>One zone at a time.</Typography>
        <Typography sx={{ fontSize: 13, color: 'var(--ink-3)', mt: 1, mb: 0.5 }}>Configure aisles, shelves, and bins. Your layout is the foundation of every pick.</Typography>
      </>}
      {tab === 'barcodes' && (() => {
        const barcodedLocs     = zones.filter((z) => z.barcode !== null).length;
        const barcodedProducts = productBarcodes.filter((p) => p.barcode !== null).length;
        const missingProducts  = productBarcodes.filter((p) => p.barcode === null).length;
        const subLine = zones.length > 0 || productBarcodes.length > 0
          ? `${barcodedLocs} location${barcodedLocs !== 1 ? 's' : ''} barcoded · ${barcodedProducts} product${barcodedProducts !== 1 ? 's' : ''} barcoded · ${missingProducts} without — generate or import to clear.`
          : 'No locations or products found. Add zones in Setup and sync products.';
        return <>
          <Typography sx={{ fontFamily: '"DM Serif Display", serif', fontSize: 36, fontWeight: 400, color: 'var(--ink)', lineHeight: 1.15, display: 'inline' }}>Every location, every product.{' '}</Typography>
          <Typography sx={{ fontFamily: '"DM Serif Display", serif', fontSize: 36, fontWeight: 400, fontStyle: 'italic', color: 'var(--accent)', lineHeight: 1.15, display: 'inline' }}>Scannable in one pass.</Typography>
          <Typography sx={{ fontSize: 13, color: 'var(--ink-3)', mt: 1, mb: 0.5 }}>{subLine}</Typography>
        </>;
      })()}

      {/* Primary tab navigation */}
      <Tabs
        value={tab}
        onChange={(_, v) => { setTab(v); onTabChange?.(v); }}
        sx={{ mb: 3, borderBottom: 1, borderColor: 'divider' }}
      >
        <Tab icon={<Map size={15} />} iconPosition="start" value="map" sx={{ minHeight: 40, fontSize: 13 }}
          label={<Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>Map{binCount > 0 && <Box component="span" sx={{ px: 0.75, borderRadius: 1, bgcolor: 'var(--accent)', color: '#fff', fontSize: 10, fontWeight: 700, lineHeight: 1.6 }}>{binCount}</Box>}</Box>} />
        <Tab icon={<LayoutDashboard size={15} />} iconPosition="start" value="setup" sx={{ minHeight: 40, fontSize: 13 }}
          label={<Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>Setup{setupCount > 0 && <Box component="span" sx={{ px: 0.75, borderRadius: 1, bgcolor: 'var(--accent)', color: '#fff', fontSize: 10, fontWeight: 700, lineHeight: 1.6 }}>{setupCount}</Box>}</Box>} />
        <Tab icon={<Tag size={15} />} iconPosition="start" value="barcodes" sx={{ minHeight: 40, fontSize: 13 }}
          label={<Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>Barcodes{barcodesCount > 0 && <Box component="span" sx={{ px: 0.75, borderRadius: 1, bgcolor: 'var(--accent)', color: '#fff', fontSize: 10, fontWeight: 700, lineHeight: 1.6 }}>{barcodesCount}</Box>}</Box>} />
      </Tabs>

      {/* MAP TAB — 2D warehouse grid */}
      {tab === 'map' && (
        <Box sx={{ display: 'flex', flexDirection: 'column', minHeight: 400 }}>
          {isGridLoading && <ModuleLoadingSkeleton />}
          {!isGridLoading && (
            <Box sx={{ display: 'flex', gap: 2, flex: 1, position: 'relative', overflow: 'hidden' }}>
              {/* ── LEFT FILTER RAIL ─────────────────────────────── */}
              <Box sx={{ width: 180, flexShrink: 0, display: 'flex', flexDirection: 'column', gap: 2.5 }}>
                {/* VIEW OVERLAY */}
                <Box>
                  <Typography sx={{ fontSize: 10, fontWeight: 500, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--ink-4)', mb: 1 }}>
                    View Overlay
                  </Typography>
                  {([
                    { id: 'occupancy',    label: 'Occupancy',     sub: 'How full each bin is.' },
                    { id: 'stockout',     label: 'Stock-out risk', sub: 'Bins below reorder.' },
                    { id: 'empty',        label: 'Empty bins',     sub: 'Available capacity.' },
                    { id: 'none',         label: 'No overlay',     sub: 'Just the layout.' },
                  ] as const).map((o) => (
                    <Box
                      key={o.id}
                      onClick={() => setOverlay(o.id)}
                      sx={{
                        px: 1.5, py: 1, mb: 0.5, borderRadius: 1.5, cursor: 'pointer',
                        bgcolor: overlay === o.id ? 'var(--accent-ghost)' : 'transparent',
                        border: '1px solid',
                        borderColor: overlay === o.id ? 'var(--accent-border)' : 'transparent',
                        transition: 'all 0.12s',
                        '&:hover': { bgcolor: 'var(--bg-2)' },
                      }}
                    >
                      <Typography sx={{ fontSize: 12, fontWeight: overlay === o.id ? 700 : 500, color: overlay === o.id ? 'var(--accent)' : 'var(--ink)' }}>
                        {o.label}
                      </Typography>
                      <Typography sx={{ fontSize: 10, color: 'var(--ink-4)', lineHeight: 1.3 }}>
                        {o.sub}
                      </Typography>
                    </Box>
                  ))}
                </Box>

                <Divider />

                {/* ZONE FILTERS — by zone_type matching target design */}
                <Box>
                  <Typography sx={{ fontSize: 10, fontWeight: 500, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--ink-4)', mb: 1 }}>
                    Filter
                  </Typography>
                  {([
                    { type: 'pick',       label: 'Pick zone'    },
                    { type: 'pack',       label: 'Pack zone'    },
                    { type: 'receive',    label: 'Receiving'    },
                    { type: 'ship',       label: 'Shipping'     },
                    { type: 'returns',    label: 'Returns'      },
                    { type: 'quarantine', label: 'Quarantine'   },
                    { type: 'kitting',    label: 'Kitting'      },
                    { type: 'storage',    label: 'Storage'      },
                  ] as const).map(({ type, label }) => {
                    const count  = (gridLocations ?? []).filter(l => l.zone_type === type).length;
                    const active = zoneFilters.has(type);
                    return (
                      <Box
                        key={type}
                        onClick={() => setZoneFilters(prev => {
                          const next = new Set(prev);
                          next.has(type) ? next.delete(type) : next.add(type);
                          return next;
                        })}
                        sx={{ display: 'flex', alignItems: 'center', gap: 1, py: 0.4, cursor: 'pointer' }}
                      >
                        <Box sx={{
                          width: 12, height: 12, borderRadius: 0.5, flexShrink: 0,
                          border: '1.5px solid', borderColor: active ? 'var(--accent)' : 'var(--rule)',
                          bgcolor: active ? 'var(--accent)' : 'transparent',
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                        }}>
                          {active && <Box sx={{ width: 6, height: 6, bgcolor: '#fff', borderRadius: 0.25 }} />}
                        </Box>
                        <Typography sx={{ fontSize: 11, color: 'var(--ink-2)' }}>
                          {label}
                        </Typography>
                        {count > 0 && (
                          <Typography sx={{ fontSize: 10, color: 'var(--ink-4)', ml: 'auto' }}>
                            {count}
                          </Typography>
                        )}
                      </Box>
                    );
                  })}
                </Box>
                <Divider />
                {/* LAYERS — toggle canvas layers (Phase 2 stubs, Phase 3 wires to Three.js layers) */}
                <Box>
                  <Typography sx={{ fontSize: 10, fontWeight: 500, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--ink-4)', mb: 1 }}>
                    Layers
                  </Typography>
                  {([
                    { label: 'Floor & grid', defaultOn: true  },
                    { label: 'Bins',         defaultOn: true  },
                    { label: 'Tote markers', defaultOn: true  },
                    { label: 'Pick path',    defaultOn: false },
                  ]).map(({ label, defaultOn }) => (
                    <Box key={label} sx={{ display: 'flex', alignItems: 'center', gap: 1, py: 0.4, cursor: 'pointer' }}>
                      <Box sx={{
                        width: 12, height: 12, borderRadius: 0.5, flexShrink: 0,
                        border: '1.5px solid', borderColor: defaultOn ? 'var(--accent)' : 'var(--rule)',
                        bgcolor: defaultOn ? 'var(--accent)' : 'transparent',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                      }}>
                        {defaultOn && <Box sx={{ width: 6, height: 6, bgcolor: '#fff', borderRadius: 0.25 }} />}
                      </Box>
                      <Typography sx={{ fontSize: 11, color: 'var(--ink-2)' }}>{label}</Typography>
                    </Box>
                  ))}
                </Box>
                <Divider />

                {/* SURFACED TODAY — Phase 2c */}
                <Box>
                  <Typography sx={{ fontSize: 10, fontWeight: 500, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--ink-4)', mb: 1 }}>
                    Surfaced Today
                  </Typography>
                  <Typography sx={{ fontSize: 11, color: 'var(--ink-4)', fontStyle: 'italic' }}>
                    Live signals in Phase 2c
                  </Typography>
                </Box>
              </Box>
              {/* ── END FILTER RAIL ──────────────────────────────── */}

              <Box sx={{ flex: 1, overflowX: 'auto' }}>
              {/* Map toolbar — bin count + active overlay label + controls */}
              <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 2, px: 0.5 }}>
                <Typography sx={{ fontSize: 12, color: 'var(--ink-3)' }}>
                  SHOWING &nbsp;
                  <Typography component="span" sx={{ fontSize: 12, fontWeight: 600, color: 'var(--ink)' }}>
                    {(gridLocations ?? []).filter((l) => l.type === 'bin').length} bins
                  </Typography>
                  {' · overlay: '}
                  <Typography component="span" sx={{ fontSize: 12, fontStyle: 'italic', color: 'var(--accent)' }}>
                    {overlay}
                  </Typography>
                </Typography>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                  {/* Zoom controls — Phase 2 will wire to canvas scale */}
                  {[{ label: '−' }, { label: '+' }].map(({ label }) => (
                    <Box key={label} sx={{ width: 28, height: 28, display: 'flex', alignItems: 'center', justifyContent: 'center', border: '1px solid var(--rule)', borderRadius: 1, cursor: 'pointer', fontSize: 14, color: 'var(--ink-3)', '&:hover': { borderColor: 'var(--accent)', color: 'var(--accent)' } }}>
                      {label}
                    </Box>
                  ))}
                  {/* Refresh */}
                  <Box onClick={onRefresh} sx={{ width: 28, height: 28, display: 'flex', alignItems: 'center', justifyContent: 'center', border: '1px solid var(--rule)', borderRadius: 1, cursor: 'pointer', color: 'var(--ink-3)', '&:hover': { borderColor: 'var(--accent)', color: 'var(--accent)' } }}>
                    <RefreshCw size={13} />
                  </Box>
                </Box>
              </Box>
              <WarehouseGrid
                  locations={filteredGridLocations}
                  occupancy={overlay === 'none' ? undefined : gridOccupancy}
                  focusedBins={variantFocusBins ?? overlayFocusedBins}
                  mode={overlayGridMode}
                  variant="full"
                  onBinSelect={handleBinSelect}
                />
              </Box>
              {/* Bin detail panel — enriched with occupancy data */}
              {selectedBin && (() => {
                const occ        = gridOccupancy?.[selectedBin];
                const totalUnits = occ?.on_hand_quantity ?? 0;
                // Capacity derived from rack_levels × estimated units per level (10).
                // Falls back to 48 if rack_levels not set. Phase 3: use real capacity field.
                const selectedLocation = (gridLocations ?? []).find(l => l.location_code === selectedBin);
                const CAPACITY   = selectedLocation?.rack_levels != null
                  ? parseFloat(String(selectedLocation.rack_levels)) * 10
                  : 48;
                const pct        = Math.min(100, Math.round((totalUnits / CAPACITY) * 100));
                const pctColor   = pct >= 85
                  ? 'var(--accent)'
                  : pct >= 55
                  ? 'rgba(245,158,11,0.9)'
                  : pct > 0
                  ? 'rgba(34,197,94,0.9)'
                  : 'var(--ink-4)';
                const [aisleLabel] = selectedBin.split('-');
                return (
                  <Paper variant="outlined" sx={{ width: 240, p: 2.5, borderRadius: 2, flexShrink: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
                    {/* Header */}
                    <Box>
                      <Typography sx={{ fontSize: 10, fontWeight: 500, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--ink-4)', mb: 0.5 }}>BIN</Typography>
                      <Typography sx={{ fontSize: 22, fontWeight: 700, fontFamily: 'monospace', color: 'var(--ink)', lineHeight: 1.1 }}>{selectedBin}</Typography>
                      <Typography sx={{ fontSize: 11, color: 'var(--ink-3)', mt: 0.25 }}>Aisle {aisleLabel}</Typography>
                    </Box>

                    <Divider />

                    {/* Occupancy */}
                    <Box>
                      <Typography sx={{ fontSize: 10, fontWeight: 500, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--ink-4)', mb: 1 }}>OCCUPANCY</Typography>
                      <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 1, mb: 1 }}>
                        <Typography sx={{ fontSize: 28, fontWeight: 500, color: pctColor, lineHeight: 1, fontVariantNumeric: 'tabular-nums' }}>{pct}%</Typography>
                        <Typography sx={{ fontSize: 11, color: 'var(--ink-3)' }}>{totalUnits} of {CAPACITY}</Typography>
                      </Box>
                      {/* Progress bar */}
                      <Box sx={{ height: 4, borderRadius: 2, bgcolor: 'var(--bg-3)', overflow: 'hidden' }}>
                        <Box sx={{ height: '100%', width: `${pct}%`, bgcolor: pctColor, borderRadius: 2, transition: 'width 0.3s ease' }} />
                      </Box>
                    </Box>

                    {/* Contents */}
                    <Box>
                      <Typography sx={{ fontSize: 10, fontWeight: 500, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--ink-4)', mb: 1 }}>CONTENTS</Typography>
                      {occ?.variants.length ? (
                        occ.variants.map((v) => (
                          <Box key={v.lasyncro_variant_id} sx={{ display: 'flex', alignItems: 'center', gap: 1, p: 1, bgcolor: 'var(--bg-2)', borderRadius: 1, mb: 0.75 }}>
                            <Box sx={{ flex: 1, minWidth: 0 }}>
                              <Typography sx={{ fontSize: 12, fontWeight: 600, color: 'var(--ink)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                {v.sku ?? v.lasyncro_variant_id.slice(0, 8)}
                              </Typography>
                              {v.product_title && (
                                <Typography sx={{ fontSize: 10, color: 'var(--ink-3)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                  {v.product_title}
                                </Typography>
                              )}
                            </Box>
                            <Typography sx={{ fontSize: 11, fontWeight: 600, color: 'var(--ink-3)', flexShrink: 0 }}>{v.on_hand_quantity} units</Typography>
                          </Box>
                        ))
                      ) : (
                        <Typography sx={{ fontSize: 12, color: 'var(--ink-4)' }}>Empty bin</Typography>
                      )}
                    </Box>

                    {/* See logs CTA */}
                    <Box
                      onClick={() => { onBinLogOpen?.(selectedBin); setLogOpen(true); }}
                      sx={{
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        gap: 0.75, px: 2, py: 1, borderRadius: 1.5, cursor: 'pointer',
                        border: '1px solid var(--accent)', color: 'var(--accent)',
                        fontSize: 12, fontWeight: 600,
                        transition: 'all 0.15s',
                        '&:hover': { bgcolor: 'var(--accent)', color: '#fff' },
                      }}
                    >
                      <ScrollText size={13} />
                      See logs
                    </Box>

                    <Divider />

                    {/* Pick stats — live from pick_scan_log */}
                    <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 1.5 }}>
                      {[
                        {
                          label: 'PICKS · 7D',
                          value: binStats?.location_code === selectedBin
                            ? String(binStats.picks_7d)
                            : '—',
                        },
                        {
                          label: 'LAST PICK',
                          value: binStats?.location_code === selectedBin && binStats.last_pick_at
                            ? (() => {
                                const diff = Date.now() - new Date(binStats.last_pick_at).getTime();
                                const h = Math.floor(diff / 3600000);
                                const d = Math.floor(diff / 86400000);
                                return h < 24 ? `${h}h ago` : `${d}d ago`;
                              })()
                            : '—',
                        },
                        {
                          label: 'REORDER IN',
                          value: binStats?.location_code === selectedBin && binStats.reorder_in_days !== null
                            ? `${binStats.reorder_in_days}d`
                            : '—',
                        },
                        { label: 'TOTE', value: '—' }, // Phase 3 — requires tote container data model
                      ].map(({ label, value }) => (
                        <Box key={label} sx={{ p: 1, bgcolor: 'var(--bg-2)', borderRadius: 1 }}>
                          <Typography sx={{ fontSize: 9, fontWeight: 500, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--ink-4)', mb: 0.25 }}>{label}</Typography>
                          <Typography sx={{ fontSize: 16, fontWeight: 500, color: 'var(--ink)', fontVariantNumeric: 'tabular-nums' }}>{value}</Typography>
                        </Box>
                      ))}
                    </Box>

                    <Divider />

                    {/* Bin actions — Print is live (barcode exists), Replenish + Move are Phase 3 stubs */}
                    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.75 }}>
                      <Box sx={{
                        display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 0.75,
                        py: 1, borderRadius: 1.5, bgcolor: 'var(--accent)', color: '#fff',
                        fontSize: 11, fontWeight: 600, cursor: 'pointer',
                        '&:hover': { opacity: 0.9 }, transition: 'opacity 0.15s',
                      }}>
                        <ScrollText size={12} />
                        Print bin label
                      </Box>
                      <Box sx={{ display: 'flex', gap: 0.75 }}>
                        <Box sx={{
                          flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center',
                          py: 0.75, borderRadius: 1.5, border: '1px solid var(--rule)',
                          fontSize: 11, fontWeight: 500, color: 'var(--ink-3)', cursor: 'pointer',
                          '&:hover': { borderColor: 'var(--accent)', color: 'var(--accent)' }, transition: 'all 0.15s',
                        }}>
                          Replenish
                        </Box>
                        <Box sx={{
                          flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center',
                          py: 0.75, borderRadius: 1.5, border: '1px solid var(--rule)',
                          fontSize: 11, fontWeight: 500, color: 'var(--ink-3)', cursor: 'pointer',
                          '&:hover': { borderColor: 'var(--accent)', color: 'var(--accent)' }, transition: 'all 0.15s',
                        }}>
                          Move
                        </Box>
                      </Box>
                    </Box>
                  </Paper>
                );
              })()}
            </Box>
            )}

          {/* Bin log drawer — slides in from right when "See logs" clicked */}
           <BinLogDrawer
            locationCode={selectedBin ?? ''}
            events={binLog?.events ?? []}
            isLoading={isBinLogLoading ?? false}
            open={logOpen}
            onClose={() => setLogOpen(false)}
          />

            {/* Legend bar — full width, outside the grid/panel flex row */}
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 3, mt: 3, pt: 2, borderTop: '1px solid var(--rule)' }}>
              {[
                { color: 'var(--bg-3)',          label: 'EMPTY' },
                { color: 'rgba(34,197,94,0.15)', label: 'BELOW 55%' },
                { color: 'rgba(245,158,11,0.15)',label: '55-85%' },
                { color: 'rgba(239,68,68,0.15)', label: 'HOT · 85%+' },
              ].map(({ color, label }) => (
                <Box key={label} sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
                  <Box sx={{ width: 12, height: 12, borderRadius: 0.5, bgcolor: color, border: '1px solid var(--rule)' }} />
                  <Typography sx={{ fontSize: 10, fontWeight: 500, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--ink-4)' }}>
                    {label}
                  </Typography>
                </Box>
              ))}
            </Box>
        </Box>
      )}

      {isLoading && tab !== 'map' && <ModuleLoadingSkeleton />}

      {isError && tab !== 'map' && (
        <Alert severity="error" sx={{ mb: 3 }}>
          Failed to load floor planning data. Please refresh.
        </Alert>
      )}

      {!isLoading && !isError && tab === 'setup' && (
        <>
          <Box sx={{ mb: 4 }}>
            {/* Header + Canvas/List toggle + Add button */}
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2 }}>
              <LayoutDashboard size={18} />
              <Typography variant="subtitle1" fontWeight={700}>Warehouse Zones</Typography>
              <Chip label={zones.length} size="small" />
              <Box sx={{ ml: 'auto', display: 'flex', gap: 1 }}>
                {/* View toggle — List shows zone cards, Canvas shows SVG floor plan editor */}
                <Box sx={{ display: 'flex', border: '1px solid var(--rule)', borderRadius: 1.5, overflow: 'hidden' }}>
                  {([{ label: 'List', val: false }, { label: 'Canvas', val: true }] as const).map(({ label, val }) => (
                    <Box
                      key={label}
                      onClick={() => { setCanvasView(val); onViewChange?.(val ? 'canvas' : 'list'); }}
                      sx={{
                        px: 1.5, py: 0.6, fontSize: 12, fontWeight: 500, cursor: 'pointer',
                        bgcolor: canvasView === val ? 'var(--accent)' : 'transparent',
                        color:   canvasView === val ? '#fff' : 'var(--ink-3)',
                        transition: 'all 0.15s',
                      }}
                    >
                      {label}
                    </Box>
                  ))}
                </Box>
                <Box
                  onClick={() => { setCreateOpen(v => !v); setCreateError(null); }}
                  sx={{ display: 'flex', alignItems: 'center', gap: 0.75, px: 1.5, py: 0.75, borderRadius: 1.5, cursor: 'pointer', border: '1px solid var(--accent)', color: 'var(--accent)', fontSize: 12, fontWeight: 600, '&:hover': { bgcolor: 'var(--accent)', color: '#fff' }, transition: 'all 0.15s' }}
                >
                  <Plus size={13} />
                  Add zone
                </Box>
              </Box>
            </Box>

            {/* Inline create form */}
            {createOpen && (
              <Paper variant="outlined" sx={{ p: 2, mb: 2, borderRadius: 2, bgcolor: 'var(--bg-2)' }}>
                <Typography sx={{ fontSize: 12, fontWeight: 600, color: 'var(--ink)', mb: 1.5 }}>New Zone</Typography>
                <Box sx={{ display: 'flex', gap: 1.5, flexWrap: 'wrap', alignItems: 'flex-start' }}>
                  <TextField
                    label="Location code"
                    size="small"
                    value={createCode}
                    onChange={e => setCreateCode(e.target.value.toUpperCase())}
                    placeholder="e.g. A-5"
                    sx={{ width: 160 }}
                    inputProps={{ style: { fontFamily: 'monospace' } }}
                  />
                  <FormControl size="small" sx={{ width: 130 }}>
                    <InputLabel>Type</InputLabel>
                    <Select value={createType} label="Type" onChange={e => setCreateType(e.target.value as WarehouseLocationType)}>
                      <MenuItem value="bin">Bin</MenuItem>
                      <MenuItem value="lane">Lane (Aisle)</MenuItem>
                      <MenuItem value="shelf">Shelf</MenuItem>
                      <MenuItem value="warehouse">Warehouse</MenuItem>
                    </Select>
                  </FormControl>
                  <TextField
                    label="Parent (optional)"
                    size="small"
                    value={createParent}
                    onChange={e => setCreateParent(e.target.value.toUpperCase())}
                    placeholder="e.g. A"
                    sx={{ width: 160 }}
                    inputProps={{ style: { fontFamily: 'monospace' } }}
                  />
                  <Button
                    variant="contained"
                    size="small"
                    disabled={createLoading}
                    onClick={handleCreate}
                    sx={{ bgcolor: 'var(--accent)', '&:hover': { bgcolor: 'var(--accent-hover)' }, textTransform: 'none', fontWeight: 600, height: 40 }}
                  >
                    {createLoading ? 'Creating...' : 'Create'}
                  </Button>
                  <Button size="small" onClick={() => setCreateOpen(false)} sx={{ height: 40, textTransform: 'none', color: 'var(--ink-3)' }}>
                    Cancel
                  </Button>
                </Box>
                {createError && (
                  <Typography sx={{ fontSize: 11, color: 'var(--error, #ef4444)', mt: 1 }}>{createError}</Typography>
                )}
              </Paper>
            )}

            {canvasView ? (
              <CanvasEditor zones={zones} onUpdateZone={onUpdateZone} onDeleteZone={onDeleteZone} onCreateZone={onCreateZone} />
            ) : zones.length === 0 ? (
              <Paper variant="outlined" sx={{ textAlign: 'center', py: 6, borderRadius: 2, borderStyle: 'dashed' }}>
                <LayoutDashboard size={36} style={{ opacity: 0.3 }} />
                <Typography variant="body2" color="text.secondary" sx={{ mt: 2 }}>
                  No warehouse zones configured. Add your first zone above.
                </Typography>
              </Paper>
            ) : (
              zones.map((zone) => (
                <ZoneCard
                  key={zone.location_code}
                  zone={zone}
                  onDelete={onDeleteZone}
                  onToggleActive={onToggleZoneActive}
                />
              ))
            )}
          </Box>
        </>
      )}

      {!isLoading && !isError && tab === 'barcodes' && (
        <BarcodesTab
          zones={zones}
          productBarcodes={productBarcodes}
          onUpdateProductBarcode={onUpdateProductBarcode}
          activeSubTab={activeSubTab}
          onSubTabChange={onSubTabChange}
        />
      )}
    </Box>
  );
}

export default function FloorPlanningModuleFT2(props: FloorPlanningPageProps) {
  return <ModuleErrorBoundary moduleName="floor-planning"><FloorPlanningModuleFT2Inner {...props} /></ModuleErrorBoundary>;
}