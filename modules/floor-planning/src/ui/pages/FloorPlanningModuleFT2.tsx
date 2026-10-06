// modules/floor-planning/src/ui/pages/FloorPlanningModuleFT2.tsx
import { useState, useCallback, useMemo } from 'react';
import type { ReactNode } from 'react';
import {
  Box,
  Typography,
  Alert,
  Button,
  Divider,
  IconButton,
  Menu,
  MenuItem,
  Checkbox,
  ListItemText,
} from '@mui/material';
import { ArrowLeft, Check, ChevronDown, ListFilter, Pencil, Printer, ScrollText, X } from 'lucide-react';
import { ModuleErrorBoundary, ModuleLoadingSkeleton } from '@lasyncro/shared/ui';
import type {
  WarehouseLocation,
  BinOccupancy,
  BinLogResponse,
  BinStats,
  WarehouseLocationType,
  WarehouseZone,
  LocationType
} from '@lasyncro/shared/ui';
import { PrintPreviewPanel } from '../components/PrintPreviewPanel.js';
import type { LabelFormat, PrintableLabel, PrintSubmitResult } from '../components/PrintPreviewPanel.js';
import { BinLogDrawer } from '../components/BinLogDrawer.js';
// FP-01: shared zone_type colour map, single source of truth with Canvas.
import { ZONE_COLORS, ZONE_STROKE } from '../components/CanvasEditor.js';
import { CanvasEditor } from '../components/CanvasEditor.js';
import { IsometricCanvas } from '../components/IsometricCanvas.js';

/**
 * FLOOR PLANNING MODULE — FT2 SURFACE
 * -------------------------------------
 * One canonical spatial workspace for the warehouse floor.
 *
 *   inspect (default) — shared IsometricCanvas + selected-location rail with
 *                       contextual location-label actions.
 *   edit              — the existing CanvasEditor authoring surface, entered
 *                       through an explicit "Edit layout" action.
 *
 * Product-barcode management is not owned here. Location labels (the
 * location_code symbol, or the merchant barcode override) remain printable
 * from the rail.
 *
 * All API data injected via props — module stays decoupled
 * from apps/frontend HTTP layer. Ops Console state is decided by the caller
 * and passed in as suppressLocationRail; this module reads no app state.
 *
 * Data model:
 *   warehouse_locations — location_code (the printed symbol), type,
 *   barcode (nullable merchant override — never system-generated)
 */

// WarehouseZone and LocationType moved to @lasyncro/shared/ui — re-exported for backwards compat.
export type { LocationType, WarehouseZone } from '@lasyncro/shared/ui';

export type ProductBarcode = {
  lasyncro_variant_id: string;
  sku: string | null;
  product_title: string;
  variant_title: string | null;
  /** Supplier EAN/UPC from Shopify — external namespace, migration 0027. */
  barcode: string | null;
  /** SHOP-REV-01g: laSyncro-minted LSP- identity. Independent of `barcode`;
   *  a product may legitimately carry both. Returned by httpGetLayout since
   *  01i but missing from this type until 01m cycle 3. */
  lasyncro_barcode: string | null;
};

export type FloorPlanningData = {
  zones: WarehouseZone[];
  // Payload field retained; product-barcode UI is no longer owned by Floor Planning.
  product_barcodes: ProductBarcode[];
} | null;

export type FloorPlanningMode = 'inspect' | 'edit';

export type FloorPlanningPageProps = {
  minimumMappingReady?: boolean | null;
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
  // FP-16 follow-up: FP-15 changed usePrintBarcode's mutationFn to resolve
  // the fetched label Blob (responseType: 'blob') instead of void — the
  // interface here was never updated to match, causing TS2322 in
  // FloorPlanningPage. onSuccess in usePrintBarcode already handles opening
  // the blob, so callers don't need to touch it, but the type must reflect
  // what mutateAsync actually resolves to.
  onPrintBarcode?: (locationCode: string) => Promise<Blob>;
  // SHOP-REVIEW-BARCODE-PRINT-05: the caller runs the HTTP call + optional QZ
  // dispatch and returns a discriminated PrintSubmitResult. The label preview
  // renders the outcome (QZ dispatched / durable browser PDF / empty / error);
  // it never opens a browser tab itself.
  onBatchPrintBarcodes?: (locationCodes: string[], formatId: string) => Promise<PrintSubmitResult>;
  /** Controlled workspace mode — the gate page syncs it to the URL. */
  mode?: FloorPlanningMode;
  onModeChange?: (mode: FloorPlanningMode) => void;
  /** Caller-decided (shared Ops Console): withdraws the location rail content
   *  while the spatial workspace stays mounted and stable. */
  suppressLocationRail?: boolean;
  onUpdateZone?: (locationCode: string, payload: {
    position_x?: number | null;
    position_y?: number | null;
    width?: number | null;
    depth?: number | null;
    orientation?: number;
    rack_levels?: number | null;
    zone_type?: string | null;
    dock_face?: 'north' | 'south' | 'east' | 'west' | 'none' | null;
    // Location lifecycle — already accepted by useUpdateZone's UpdateZonePayload.
    active?: boolean;
  }) => Promise<void>;
  onUpdateZonePositions?: (positions: Array<{
    location_code: string;
    position_x: number;
    position_y: number;
  }>) => Promise<void>;
};

const TYPE_LABELS: Record<LocationType, string> = {
  warehouse: 'Warehouse',
  lane:      'Aisle',
  shelf:     'Shelf',
  bin:       'Bin',
};

// SHOP-REV-01m cycle 2: moved out of PrintPreviewPanel so callers supply
// their own list. Must match SHEET_FORMATS in warehouseLabelPdf.service.ts.
const LOCATION_LABEL_FORMATS: LabelFormat[] = [
  { id: 'avery-5160', label: 'Avery 5160 · 24/sheet',  labelsPerSheet: 24, columns: 3, labelWidthMm: 66,  labelHeightMm: 25,  paperSize: 'A4'  },
  { id: 'avery-5163', label: 'Avery 5163 · 10/sheet · large', labelsPerSheet: 10, columns: 2, labelWidthMm: 101, labelHeightMm: 51,  paperSize: 'A4'  },
  { id: 'zebra-4x6',  label: 'Zebra 4×6 thermal',      labelsPerSheet: 1,  columns: 1, labelWidthMm: 101, labelHeightMm: 152, paperSize: '4x6' },
  { id: 'dymo-1x2',   label: 'Dymo 1×2.125',           labelsPerSheet: 1,  columns: 1, labelWidthMm: 25,  labelHeightMm: 54,  paperSize: '1x2' },
];

type OverlayId = 'occupancy' | 'stockout' | 'empty' | 'none';
const OVERLAYS: { id: OverlayId; label: string; hint: string }[] = [
  { id: 'occupancy', label: 'Occupancy',      hint: 'How full each bin is.' },
  { id: 'stockout',  label: 'Stock-out risk', hint: 'Bins low on stock (≤3 units).' },
  { id: 'empty',     label: 'Empty bins',     hint: 'Available capacity.' },
  { id: 'none',      label: 'Layout',         hint: 'Just the layout.' },
];

const ZONE_FILTERS = [
  { type: 'pick',       label: 'Pick zone'    },
  { type: 'pack',       label: 'Pack zone'    },
  { type: 'receive',    label: 'Receiving'    },
  { type: 'ship',       label: 'Shipping'     },
  { type: 'returns',    label: 'Returns'      },
  { type: 'problem',    label: 'Problem area' },
  { type: 'quarantine', label: 'Quarantine'   },
  { type: 'kitting',    label: 'Kitting'      },
  { type: 'storage',    label: 'Storage'      },
] as const;
const ALL_ZONE_TYPES: string[] = ZONE_FILTERS.map((z) => z.type);

// Restrained surface treatment shared by the spatial frame and the rail.
const FRAME_SX = {
  bgcolor: 'var(--surface)',
  border: '0.5px solid var(--rule-2)',
  borderRadius: '10px',
  minWidth: 0,
  minHeight: 0,
  overflow: 'hidden',
} as const;

const EYEBROW_SX = { fontSize: 10.5, fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--ink-4)' } as const;

function relativeAge(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const h = Math.floor(diff / 3600000);
  const d = Math.floor(diff / 86400000);
  return h < 24 ? `${h}h ago` : `${d}d ago`;
}

function FactGrid({ facts }: { facts: { k: string; v: string }[] }) {
  return (
    <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5px', bgcolor: 'var(--rule)', border: '0.5px solid var(--rule)', borderRadius: '8px', overflow: 'hidden', flexShrink: 0 }}>
      {facts.map(({ k, v }) => (
        <Box key={k} sx={{ bgcolor: 'var(--surface)', px: 1.5, py: 1.25, display: 'flex', flexDirection: 'column', gap: 0.375 }}>
          <Typography sx={{ fontSize: 11, color: 'var(--ink-3)' }}>{k}</Typography>
          <Typography sx={{ fontSize: 16, fontWeight: 600, color: 'var(--ink)', fontVariantNumeric: 'tabular-nums' }}>{v}</Typography>
        </Box>
      ))}
    </Box>
  );
}

/**
 * Selected-location inspection rail. Facts are the ones current data supports:
 * structure from warehouse_locations, on-hand + contents from the occupancy
 * projection, pick stats from pick_scan_log. No capacity estimate is shown —
 * there is no capacity field to derive one from.
 */
function LocationRail({
  zone,
  code,
  rootCode,
  occupancy,
  binStats,
  onClear,
  onPrintBarcode,
  onOpenLog,
}: {
  zone: WarehouseZone | undefined;
  code: string;
  rootCode: string | undefined;
  occupancy: BinOccupancy | undefined;
  binStats: BinStats | undefined;
  onClear: () => void;
  onPrintBarcode?: (locationCode: string) => Promise<Blob>;
  onOpenLog: () => void;
}) {
  const [printing, setPrinting] = useState(false);
  const [printError, setPrintError] = useState<string | null>(null);
  const stats = binStats?.location_code === code ? binStats : undefined;
  const units = occupancy?.on_hand_quantity ?? 0;

  // Single-location print — same path as the editor inspector
  // (usePrintBarcode owns QZ dispatch / browser fallback).
  async function handlePrint() {
    if (!onPrintBarcode || printing) return;
    setPrinting(true);
    setPrintError(null);
    try {
      await onPrintBarcode(code);
    } catch {
      setPrintError('Could not prepare the label. Please try again.');
    } finally {
      setPrinting(false);
    }
  }

  const facts = [
    { k: 'On hand', v: `${units} unit${units === 1 ? '' : 's'}` },
    { k: 'Picks · 7d', v: stats ? String(stats.picks_7d) : '—' },
    { k: 'Last pick', v: stats?.last_pick_at ? relativeAge(stats.last_pick_at) : '—' },
    { k: 'Reorder in', v: stats && stats.reorder_in_days !== null ? `${stats.reorder_in_days}d` : '—' },
  ];
  const zoneType = zone?.zone_type ?? null;

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
      <Box sx={{ p: '18px 18px 0', display: 'flex', flexDirection: 'column', gap: 2, flex: 1, minHeight: 0, overflowY: 'auto' }}>
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1, flexShrink: 0 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1 }}>
            <Typography sx={{ fontSize: 11.5, color: 'var(--ink-3)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {[rootCode, zone?.parent_location_code !== rootCode ? zone?.parent_location_code : null].filter(Boolean).join(' / ') || 'Warehouse'}
            </Typography>
            <IconButton size="small" aria-label="Clear selection" onClick={onClear} sx={{ width: 24, height: 24, color: 'var(--ink-3)' }}>
              <X size={14} />
            </IconButton>
          </Box>
          <Typography sx={{ fontSize: 21, fontWeight: 600, letterSpacing: '-0.015em', lineHeight: 1.15, color: 'var(--ink)', wordBreak: 'break-all' }}>
            {code}
          </Typography>
          <Box sx={{ display: 'flex', gap: 0.75, flexWrap: 'wrap' }}>
            {zone && (
              <Box component="span" sx={{ height: 22, display: 'inline-flex', alignItems: 'center', px: 1, borderRadius: '6px', border: '0.5px solid var(--rule-2)', fontSize: 11.5, color: 'var(--ink-2)' }}>
                {TYPE_LABELS[zone.type] ?? zone.type}
              </Box>
            )}
            {zoneType && (
              <Box component="span" sx={{ height: 22, display: 'inline-flex', alignItems: 'center', gap: 0.75, px: 1, borderRadius: '6px', bgcolor: 'var(--bg-2)', fontSize: 11.5, fontWeight: 500, color: 'var(--ink)', textTransform: 'capitalize' }}>
                <Box component="span" sx={{ width: 7, height: 7, borderRadius: '2px', bgcolor: ZONE_COLORS[zoneType] ?? 'var(--ink-4)', border: `1px solid ${ZONE_STROKE[zoneType] ?? 'var(--ink-4)'}` }} />
                {zoneType}
              </Box>
            )}
            {zone && !zone.active && (
              <Box component="span" sx={{ height: 22, display: 'inline-flex', alignItems: 'center', px: 1, borderRadius: '6px', border: '0.5px solid var(--rule-2)', fontSize: 11.5, color: 'var(--ink-4)' }}>
                Inactive
              </Box>
            )}
          </Box>
        </Box>

        <FactGrid facts={facts} />

        <Box sx={{ flexShrink: 0 }}>
          <Typography sx={{ ...EYEBROW_SX, mb: 1 }}>Contents</Typography>
          {occupancy?.variants.length ? (
            occupancy.variants.map((v) => (
              <Box key={v.lasyncro_variant_id} sx={{ display: 'flex', alignItems: 'center', gap: 1, py: 0.75, borderBottom: '0.5px solid var(--rule)' }}>
                <Box sx={{ flex: 1, minWidth: 0 }}>
                  <Typography sx={{ fontSize: 12.5, fontWeight: 500, color: 'var(--ink)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {v.product_title ?? v.sku ?? v.lasyncro_variant_id.slice(0, 8)}
                  </Typography>
                  {v.sku && (
                    <Typography sx={{ fontSize: 11, color: 'var(--ink-3)' }}>{v.sku}</Typography>
                  )}
                </Box>
                <Typography sx={{ fontSize: 13, fontWeight: 600, color: 'var(--ink-2)', fontVariantNumeric: 'tabular-nums', flexShrink: 0 }}>{v.on_hand_quantity}</Typography>
              </Box>
            ))
          ) : (
            <Typography sx={{ fontSize: 12.5, color: 'var(--ink-3)' }}>Nothing stored here right now.</Typography>
          )}
        </Box>

        <Typography sx={{ fontSize: 11.5, color: 'var(--ink-3)', flexShrink: 0, pb: 0.5 }}>
          Label last printed: {zone?.last_printed_at
            ? new Date(zone.last_printed_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
            : 'never'}
        </Typography>
      </Box>

      <Box sx={{ p: '14px 18px 18px', display: 'flex', flexDirection: 'column', gap: 1, flexShrink: 0 }}>
        {printError && (
          <Typography sx={{ fontSize: 11.5, color: 'var(--critical-ink)' }}>{printError}</Typography>
        )}
        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1, '& > button': { flex: '1 0 auto' } }}>
          <Button
            variant="outlined"
            size="small"
            startIcon={<Printer size={14} />}
            disabled={!onPrintBarcode || printing}
            onClick={() => void handlePrint()}
            sx={{ height: 34, textTransform: 'none', fontSize: 12.5, fontWeight: 500, color: 'var(--ink)', borderColor: 'var(--rule-2)', borderRadius: '7px', whiteSpace: 'nowrap' }}
          >
            {printing ? 'Printing…' : 'Print location label'}
          </Button>
          <Button
            variant="contained"
            size="small"
            disableElevation
            startIcon={<ScrollText size={14} />}
            onClick={onOpenLog}
            sx={{ height: 34, textTransform: 'none', fontSize: 12.5, fontWeight: 600, bgcolor: 'var(--ink)', color: 'var(--bg)', borderRadius: '7px', whiteSpace: 'nowrap', '&:hover': { bgcolor: 'var(--ink)', opacity: 0.88 } }}
          >
            See logs
          </Button>
        </Box>
      </Box>
    </Box>
  );
}

/** No selection: floor orientation + batch location-label printing. */
function FloorRail({
  rootCode,
  facts,
  labels,
  onBatchPrintBarcodes,
}: {
  rootCode: string | undefined;
  facts: { k: string; v: string }[];
  labels: PrintableLabel[];
  onBatchPrintBarcodes?: (locationCodes: string[], formatId: string) => Promise<PrintSubmitResult>;
}) {
  const [labelsOpen, setLabelsOpen] = useState(false);

  if (labelsOpen) {
    return (
      <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
        <Box sx={{ p: '14px 18px 12px', display: 'flex', flexDirection: 'column', gap: 1, borderBottom: '0.5px solid var(--rule)' }}>
          <Button
            size="small"
            startIcon={<ArrowLeft size={14} />}
            onClick={() => setLabelsOpen(false)}
            sx={{ alignSelf: 'flex-start', textTransform: 'none', fontSize: 12, color: 'var(--ink-3)', px: 0.75, minWidth: 0 }}
          >
            Floor
          </Button>
          <Typography sx={{ fontSize: 15, fontWeight: 600, color: 'var(--ink)' }}>Location labels</Typography>
        </Box>
        <Box sx={{ flex: 1, minHeight: 0, overflowY: 'auto', p: '14px 18px 18px' }}>
          <PrintPreviewPanel
            items={labels}
            formats={LOCATION_LABEL_FORMATS}
            defaultFormatId="avery-5160"
            emptyMessage="No active locations"
            onBatchPrint={onBatchPrintBarcodes}
          />
        </Box>
      </Box>
    );
  }

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
      <Box sx={{ p: 2.25, display: 'flex', flexDirection: 'column', gap: 2, flex: 1, minHeight: 0, overflowY: 'auto' }}>
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.75 }}>
          <Typography sx={{ fontSize: 11.5, color: 'var(--ink-3)' }}>Warehouse</Typography>
          <Typography sx={{ fontSize: 17, fontWeight: 600, color: 'var(--ink-2)' }}>{rootCode ?? 'Floor 1'}</Typography>
          <Typography sx={{ fontSize: 12.5, lineHeight: 1.55, color: 'var(--ink-3)' }}>
            Select a location on the map to inspect it.
          </Typography>
        </Box>
        <Box sx={{ display: 'flex', flexDirection: 'column', borderTop: '0.5px solid var(--rule)' }}>
          {facts.map(({ k, v }) => (
            <Box key={k} sx={{ display: 'flex', justifyContent: 'space-between', py: 1.25, borderBottom: '0.5px solid var(--rule)' }}>
              <Typography sx={{ fontSize: 12.5, color: 'var(--ink-3)' }}>{k}</Typography>
              <Typography sx={{ fontSize: 12.5, fontWeight: 600, color: 'var(--ink-2)', fontVariantNumeric: 'tabular-nums' }}>{v}</Typography>
            </Box>
          ))}
        </Box>
      </Box>
      <Box sx={{ p: '14px 18px 18px', flexShrink: 0 }}>
        <Button
          fullWidth
          variant="outlined"
          size="small"
          startIcon={<Printer size={14} />}
          disabled={labels.length === 0}
          onClick={() => setLabelsOpen(true)}
          sx={{ minHeight: 34, height: 'auto', py: 0.75, textTransform: 'none', fontSize: 12.5, fontWeight: 500, color: 'var(--ink)', borderColor: 'var(--rule-2)', borderRadius: '7px', whiteSpace: 'normal', overflowWrap: 'anywhere', flexShrink: 0 }}
        >
          Labels for {labels.length} location{labels.length === 1 ? '' : 's'}
        </Button>
      </Box>
    </Box>
  );
}

function WorkspaceHeader({ title, badge, subline, actions }: {
  title: string;
  badge?: string;
  subline: string;
  actions: ReactNode;
}) {
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 2, minHeight: 62, flexShrink: 0, minWidth: 0 }}>
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.375, minWidth: 0 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.25 }}>
          <Typography component="h1" sx={{ fontSize: 19, fontWeight: 600, letterSpacing: '-0.015em', lineHeight: 1.2, color: 'var(--ink)' }}>
            {title}
          </Typography>
          {badge && (
            <Box component="span" sx={{ fontSize: 10.5, fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--accent)', bgcolor: 'var(--accent-ghost)', border: '0.5px solid var(--accent-border)', px: 0.875, py: 0.25, borderRadius: '100px' }}>
              {badge}
            </Box>
          )}
        </Box>
        <Typography sx={{ fontSize: 12.5, color: 'var(--ink-3)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {subline}
        </Typography>
      </Box>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexShrink: 0 }}>{actions}</Box>
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
  onCreateZone,
  onDeleteZone,
  onDeleteZones,
  onDuplicateZones,
  onPrintBarcode,
  minimumMappingReady,
  onUpdateZone,
  onUpdateZonePositions,
  onBatchPrintBarcodes,
  mode,
  onModeChange,
  suppressLocationRail = false,
}: FloorPlanningPageProps) {
  const zones = data?.zones ?? [];
  const [localMode, setLocalMode] = useState<FloorPlanningMode>(mode ?? 'inspect');
  const currentMode = mode ?? localMode;
  const changeMode = useCallback((next: FloorPlanningMode) => {
    setLocalMode(next);
    onModeChange?.(next);
  }, [onModeChange]);

  const [selectedBin, setSelectedBin] = useState<string | undefined>();
  const [overlay, setOverlay]         = useState<OverlayId>('occupancy');
  // Default to every supported operational zone so active locations never disappear silently.
  const [zoneFilters, setZoneFilters] = useState<Set<string>>(new Set(ALL_ZONE_TYPES));
  const [filterAnchor, setFilterAnchor] = useState<HTMLElement | null>(null);
  // Layer visibility — wired to IsometricCanvas layers.
  const [showFloor, setShowFloor] = useState(true);
  const [showBins,  setShowBins]  = useState(true);
  const [logOpen, setLogOpen]     = useState(false);

  // FP-SUMMARY1: always-on counts for the headline strip, independent of
  // which overlay is currently selected — a merchant looking at Occupancy
  // should still see "3 at risk" without switching views. Same predicates
  // as overlayFocusedBins (at risk: qty > 0 && qty <= 3; empty: qty === 0)
  // but computed together rather than gated behind `overlay ===`.
  const summaryCounts = useMemo(() => {
    const bins = (gridLocations ?? []).filter(l => l.type === 'bin');
    let atRisk = 0, empty = 0;
    for (const l of bins) {
      const qty = gridOccupancy?.[l.location_code]?.on_hand_quantity ?? 0;
      if (qty === 0) empty;
      else if (qty <= 3) atRisk++;
    }
    return { atRisk, empty, total: bins.length };
  }, [gridLocations, gridOccupancy]);

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

  const filteredCodes = useMemo(() => new Set(
    // Filter by zone_type — matches the zone filter menu (pick/pack/receive etc.)
    // Falls back to showing location if zone_type is null (unclassified locations)
    (gridLocations ?? [])
      .filter(l => l.zone_type == null || zoneFilters.has(l.zone_type))
      .map(l => l.location_code),
  ), [gridLocations, zoneFilters]);

  const handleBinSelect = useCallback((lc: string) => {
    setSelectedBin((p) => {
      const next = p === lc ? undefined : lc;
      onBinSelect?.(next ?? '');
      return next;
    });
  }, [onBinSelect]);
  const clearSelection = useCallback(() => {
    setSelectedBin(undefined);
    setLogOpen(false);
    onBinSelect?.('');
  }, [onBinSelect]);

  const rootCode = zones.find((z) => z.type === 'warehouse')?.location_code;
  const bins     = (gridLocations ?? []).filter((l) => l.type === 'bin');
  const aisles   = new Set(
    bins
      .filter((l) => l.zone_type !== 'quarantine' && l.parent_location_code != null)
      .map((l) => l.parent_location_code)
  ).size;
  const stocked  = Object.values(gridOccupancy ?? {}).filter((o) => o.on_hand_quantity > 0).length;
  const subLine  = bins.length > 0
    ? `${bins.length} bin${bins.length !== 1 ? 's' : ''} across ${aisles} aisle${aisles !== 1 ? 's' : ''} · ${stocked} bin${stocked !== 1 ? 's' : ''} with stock`
    : 'No bins configured yet — use Edit layout to map your warehouse.';

  // Every active physical location is printable; the warehouse root is passive.
  // location_code is the symbol, `barcode` is an override. Scoped to shown zones.
  // SHOP-REVIEW-BARCODE-PRINT-05 §10: order the preview by the same key the
  // print endpoint sorts on (httpBatchPrintBarcodes → ORDER BY location_code).
  const locationLabels: PrintableLabel[] = zones
    .filter((z) => z.type !== 'warehouse' && z.active && (z.zone_type == null || zoneFilters.has(z.zone_type)))
    .slice()
    .sort((a, b) => (a.location_code < b.location_code ? -1 : a.location_code > b.location_code ? 1 : 0))
    .map((z) => ({ id: z.location_code, code: z.barcode ?? z.location_code, caption: z.location_code }));

  const floorFacts = [
    { k: 'Locations',       v: String(zones.filter((z) => z.type !== 'warehouse').length) },
    { k: 'Bins',            v: String(bins.length) },
    { k: 'Bins with stock', v: String(stocked) },
    { k: 'Low on stock',    v: String(summaryCounts.atRisk) },
  ];

  const filtersAll = zoneFilters.size === ALL_ZONE_TYPES.length;
  const filterLabel = filtersAll ? 'All zones' : `${zoneFilters.size} of ${ALL_ZONE_TYPES.length} zones`;

  if (currentMode === 'edit') {
    return (
      <Box sx={{ p: { xs: 2, md: '16px 24px 20px' }, height: '100%', boxSizing: 'border-box', minHeight: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column', gap: 1.5, bgcolor: 'var(--bg)' }}>
        <WorkspaceHeader
          title="Edit layout"
          badge="2D plan"
          subline="Map where you keep stock and the work areas your warehouse uses."
          actions={
            <Button
              variant="contained"
              disableElevation
              startIcon={<Check size={14} />}
              onClick={() => changeMode('inspect')}
              sx={{ height: 32, textTransform: 'none', fontSize: 13, fontWeight: 600, borderRadius: '7px', bgcolor: 'var(--accent)', color: '#fff', '&:hover': { bgcolor: 'var(--accent-hover)' } }}
            >
              Done editing
            </Button>
          }
        />
        {isLoading && <ModuleLoadingSkeleton />}
        {isError && (
          <Alert severity="error">Failed to load floor planning data. Please refresh.</Alert>
        )}
        {!isLoading && !isError && (
          <Box sx={{ flex: 1, minHeight: 0, minWidth: 0, display: 'flex', overflow: 'hidden' }}>
            <CanvasEditor
              zones={zones}
              minimumMappingReady={minimumMappingReady}
              onUpdateZone={onUpdateZone}
              onUpdateZonePositions={onUpdateZonePositions}
              onDeleteZone={onDeleteZone}
              onDeleteZones={onDeleteZones}
              onDuplicateZones={onDuplicateZones}
              onCreateZone={onCreateZone}
              onPrintBarcode={onPrintBarcode}
            />
          </Box>
        )}
      </Box>
    );
  }

  return (
    <Box sx={{ p: { xs: 2, md: '16px 24px 20px' }, height: '100%', boxSizing: 'border-box', minHeight: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column', gap: 1.5, bgcolor: 'var(--bg)' }}>
      <WorkspaceHeader
        title="Floor planning"
        subline={subLine}
        actions={
          <Button
            variant="outlined"
            startIcon={<Pencil size={14} />}
            onClick={() => changeMode('edit')}
            sx={{ height: 32, textTransform: 'none', fontSize: 13, fontWeight: 600, borderRadius: '7px', color: 'var(--ink)', borderColor: 'var(--rule-2)', bgcolor: 'var(--surface)', '&:hover': { bgcolor: 'var(--bg-2)', borderColor: 'var(--rule-2)' } }}
          >
            Edit layout
          </Button>
        }
      />

      {/* Primary spatial workspace + location rail. The primary track keeps
          its position whether or not the rail is withdrawn, so opening the
          Ops Console never resizes or remounts the canvas. Suppression
          withdraws rail content only; the tracks stay allocated at every
          breakpoint, including the constrained stack below lg. */}
      <Box sx={{
        flex: 1, minHeight: 0, overflow: 'hidden',
        display: 'grid',
        gridTemplateColumns: { xs: 'minmax(0, 1fr)', lg: 'minmax(0, 1fr) 264px', xl: 'minmax(0, 1fr) 312px' },
        gridTemplateRows: { xs: 'minmax(0, 3fr) minmax(0, 2fr)', lg: 'minmax(0, 1fr)' },
        gap: 1.5,
      }}>
        <Box component="section" aria-label="Floor map" sx={{ ...FRAME_SX, display: 'flex', flexDirection: 'column', position: 'relative' }}>
          {/* Compact overlay + filter bar — kept off the canvas corners the
              shared IsometricCanvas already uses for its own furniture. */}
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap', px: 1.5, py: 1, borderBottom: '0.5px solid var(--rule)', flexShrink: 0 }}>
            <Box role="group" aria-label="Map overlay" sx={{ display: 'flex', p: '3px', gap: '2px', bgcolor: 'var(--bg-2)', borderRadius: '8px' }}>
              {OVERLAYS.map((o) => (
                <Box
                  key={o.id}
                  component="button"
                  type="button"
                  title={o.hint}
                  aria-pressed={overlay === o.id}
                  onClick={() => setOverlay(o.id)}
                  sx={{
                    height: 26, px: 1.25, border: 0, borderRadius: '6px', cursor: 'pointer', whiteSpace: 'nowrap',
                    fontFamily: 'inherit', fontSize: 12,
                    fontWeight: overlay === o.id ? 600 : 500,
                    bgcolor: overlay === o.id ? 'var(--surface)' : 'transparent',
                    color: overlay === o.id ? 'var(--ink)' : 'var(--ink-3)',
                    boxShadow: overlay === o.id ? '0 0 0 0.5px var(--rule-2)' : 'none',
                    '&:hover': { color: 'var(--ink)' },
                  }}
                >
                  {o.label}
                </Box>
              ))}
            </Box>
            <Button
              size="small"
              variant="outlined"
              startIcon={<ListFilter size={14} />}
              endIcon={<ChevronDown size={14} />}
              onClick={(e) => setFilterAnchor(e.currentTarget)}
              aria-haspopup="menu"
              sx={{ height: 32, textTransform: 'none', fontSize: 12, fontWeight: 500, color: 'var(--ink)', borderColor: 'var(--rule-2)', borderRadius: '8px', whiteSpace: 'nowrap' }}
            >
              {filterLabel}
            </Button>
            <Menu
              anchorEl={filterAnchor}
              open={filterAnchor != null}
              onClose={() => setFilterAnchor(null)}
              slotProps={{ paper: { sx: { width: 232, borderRadius: '10px', border: '0.5px solid var(--rule-2)' } } }}
            >
              {ZONE_FILTERS.map(({ type, label }) => {
                const count = (gridLocations ?? []).filter(l => l.zone_type === type).length;
                return (
                  <MenuItem
                    key={type}
                    dense
                    onClick={() => setZoneFilters(prev => {
                      const next = new Set(prev);
                      next.has(type) ? next.delete(type) : next.add(type);
                      return next;
                    })}
                  >
                    <Checkbox size="small" checked={zoneFilters.has(type)} sx={{ p: 0.25, mr: 1 }} />
                    <Box sx={{ width: 8, height: 8, borderRadius: '2px', mr: 1, bgcolor: ZONE_COLORS[type] ?? 'var(--ink-4)', border: `1px solid ${ZONE_STROKE[type] ?? 'var(--ink-4)'}` }} />
                    <ListItemText slotProps={{ primary: { sx: { fontSize: 12.5 } } }}>{label}</ListItemText>
                    <Typography sx={{ fontSize: 11.5, color: 'var(--ink-3)', fontVariantNumeric: 'tabular-nums' }}>{count}</Typography>
                  </MenuItem>
                );
              })}
              <Divider />
              <Typography sx={{ ...EYEBROW_SX, px: 2, pt: 0.5, pb: 0.5 }}>Layers</Typography>
              <MenuItem dense onClick={() => setShowFloor(p => !p)}>
                <Checkbox size="small" checked={showFloor} sx={{ p: 0.25, mr: 1 }} />
                <ListItemText slotProps={{ primary: { sx: { fontSize: 12.5 } } }}>Floor &amp; grid</ListItemText>
              </MenuItem>
              <MenuItem dense onClick={() => setShowBins(p => !p)}>
                <Checkbox size="small" checked={showBins} sx={{ p: 0.25, mr: 1 }} />
                <ListItemText slotProps={{ primary: { sx: { fontSize: 12.5 } } }}>Bins</ListItemText>
              </MenuItem>
              <Divider />
              <MenuItem dense disabled={filtersAll} onClick={() => setZoneFilters(new Set(ALL_ZONE_TYPES))}>
                <ListItemText slotProps={{ primary: { sx: { fontSize: 12, fontWeight: 500 } } }}>Show all zones</ListItemText>
              </MenuItem>
            </Menu>
          </Box>

          <Box sx={{ flex: 1, minHeight: 0, position: 'relative' }}>
            {isGridLoading ? <ModuleLoadingSkeleton /> : (
              /* Isometric 2.5D view (read-only). 2D editing lives in Edit layout. */
              <IsometricCanvas
                zones={zones}
                onSelect={(code) => code && handleBinSelect(code)}
                filteredCodes={filteredCodes}
                /* Each overlay owns one visual language: heatmap or semantic focus. */
                occupancy={overlay === 'occupancy' ? gridOccupancy : undefined}
                focusedBins={overlayFocusedBins}
                focusTone={overlay === 'stockout' ? 'risk' : overlay === 'empty' ? 'empty' : undefined}
                showFloor={showFloor}
                showBins={showBins}
                onUnplacedZonesClick={() => changeMode('edit')}
                overlay={overlay}
                summaryCounts={summaryCounts}
                onRefresh={onRefresh}
              />
            )}
            {/* Bin log drawer — slides in from right when "See logs" clicked.
                Withdrawn with the rail while the Ops Console owns attention. */}
            <BinLogDrawer
              locationCode={selectedBin ?? ''}
              events={binLog?.events ?? []}
              isLoading={isBinLogLoading ?? false}
              open={logOpen && !suppressLocationRail}
              onClose={() => setLogOpen(false)}
            />
          </Box>
        </Box>

        <Box
          data-location-rail-suppressed={suppressLocationRail ? 'true' : 'false'}
          sx={{ minWidth: 0, minHeight: 0, display: suppressLocationRail ? { xs: 'none', lg: 'block' } : 'block' }}
        >
          {!suppressLocationRail && (
            <Box component="aside" aria-label={selectedBin ? `Location ${selectedBin}` : 'Floor summary'} sx={{ ...FRAME_SX, height: '100%' }}>
              {selectedBin ? (
                <LocationRail
                  key={selectedBin}
                  code={selectedBin}
                  zone={zones.find((z) => z.location_code === selectedBin)}
                  rootCode={rootCode}
                  occupancy={gridOccupancy?.[selectedBin]}
                  binStats={binStats}
                  onClear={clearSelection}
                  onPrintBarcode={onPrintBarcode}
                  onOpenLog={() => { onBinLogOpen?.(selectedBin); setLogOpen(true); }}
                />
              ) : (
                <FloorRail
                  rootCode={rootCode}
                  facts={floorFacts}
                  labels={locationLabels}
                  onBatchPrintBarcodes={onBatchPrintBarcodes}
                />
              )}
            </Box>
          )}
        </Box>
      </Box>

      {isError && (
        <Alert severity="error">Failed to load floor planning data. Please refresh.</Alert>
      )}
    </Box>
  );
}

export default function FloorPlanningModuleFT2(props: FloorPlanningPageProps) {
  return <ModuleErrorBoundary moduleName="floor-planning"><FloorPlanningModuleFT2Inner {...props} /></ModuleErrorBoundary>;
}
