// modules/floor-planning/src/ui/pages/FloorPlanningModuleFT2.tsx
import { useState, useCallback } from 'react';
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
} from '@mui/material';
import { LayoutDashboard, Tag, PackageSearch, ChevronDown, ChevronUp, Map } from 'lucide-react';
import { ModuleErrorBoundary, ModuleLoadingSkeleton, WarehouseGrid } from '@lasyncro/shared/ui';
import type { WarehouseLocation, BinOccupancy } from '@lasyncro/shared/ui';

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

function ZoneCard({ zone }: { zone: WarehouseZone }) {
  const type = TYPE_LABELS[zone.type] ?? { label: zone.type, color: 'default' as const };

  return (
    <Paper variant="outlined" sx={{ p: 2, mb: 1.5, borderRadius: 2, opacity: zone.active ? 1 : 0.5 }}>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1 }}>
        <Typography variant="body2" fontWeight={700} sx={{ fontFamily: 'monospace' }}>
          {zone.location_code}
        </Typography>
        <Box sx={{ display: 'flex', gap: 1 }}>
          {!zone.active && <Chip label="Inactive" size="small" color="default" />}
          <Chip label={type.label} size="small" color={type.color} />
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

function ProductBarcodesTable({ items }: { items: ProductBarcode[] }) {
  const [filter, setFilter] = useState('');
  const [showUnassigned, setShowUnassigned] = useState(false);

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
                        {item.barcode}
                      </TableCell>
                    </TableRow>
                  ))}
                  {filtered.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={3} sx={{ textAlign: 'center', color: 'text.secondary', py: 3 }}>
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

function FloorPlanningModuleFT2Inner({
  data,
  isLoading,
  isError,
  gridLocations,
  gridOccupancy,
  isGridLoading,
}: FloorPlanningPageProps) {
  const zones = data?.zones ?? [];
  const productBarcodes = data?.product_barcodes ?? [];
  const [tab, setTab] = useState<'map' | 'setup' | 'barcodes'>('map');
  const [selectedBin, setSelectedBin] = useState<string | undefined>();
  const handleBinSelect = useCallback((lc: string) => setSelectedBin((p) => p === lc ? undefined : lc), []);

  return (
    <Box sx={{ p: 2, maxWidth: tab === 'map' ? '100%' : 700, mx: 'auto' }}>

      <Box sx={{ mb: 2 }}>
        <Typography variant="h5" fontWeight={700}>Floor Planning</Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
          Manage warehouse zones and barcode assignments for locations and products.
        </Typography>
      </Box>

      {/* Primary tab navigation */}
      <Tabs
        value={tab}
        onChange={(_, v) => setTab(v)}
        sx={{ mb: 3, borderBottom: 1, borderColor: 'divider' }}
      >
        <Tab icon={<Map size={15} />} iconPosition="start" label="Map" value="map" sx={{ minHeight: 40, fontSize: 13 }} />
        <Tab icon={<LayoutDashboard size={15} />} iconPosition="start" label="Setup" value="setup" sx={{ minHeight: 40, fontSize: 13 }} />
        <Tab icon={<Tag size={15} />} iconPosition="start" label="Barcodes" value="barcodes" sx={{ minHeight: 40, fontSize: 13 }} />
      </Tabs>

      {/* MAP TAB — 2D warehouse grid */}
      {tab === 'map' && (
        <Box>
          {isGridLoading && <ModuleLoadingSkeleton />}
          {!isGridLoading && (
            <Box sx={{ display: 'flex', gap: 2 }}>
              <Box sx={{ flex: 1, overflowX: 'auto' }}>
                <WarehouseGrid
                  locations={gridLocations ?? []}
                  occupancy={gridOccupancy}
                  mode="map"
                  variant="full"
                  onBinSelect={handleBinSelect}
                />
              </Box>
              {/* Bin detail panel */}
              {selectedBin && (
                <Paper variant="outlined" sx={{ width: 220, p: 2, borderRadius: 2, flexShrink: 0 }}>
                  <Typography variant="subtitle2" fontWeight={700} sx={{ fontFamily: 'monospace', mb: 1 }}>
                    {selectedBin}
                  </Typography>
                  {gridOccupancy?.[selectedBin] ? (
                    <>
                      <Typography variant="caption" color="text.secondary">
                        {gridOccupancy[selectedBin].on_hand_quantity} units total
                      </Typography>
                      {gridOccupancy[selectedBin].variants.map((v) => (
                        <Box key={v.lasyncro_variant_id} sx={{ mt: 1 }}>
                          <Typography variant="caption" display="block" fontWeight={600}>{v.sku ?? '—'}</Typography>
                          <Typography variant="caption" color="text.secondary">{v.on_hand_quantity} units</Typography>
                        </Box>
                      ))}
                    </>
                  ) : (
                    <Typography variant="caption" color="text.disabled">Empty bin</Typography>
                  )}
                </Paper>
              )}
            </Box>
          )}
        </Box>
      )}

      {isLoading && tab !== 'map' && <ModuleLoadingSkeleton />}

      {isError && tab !== 'map' && (
        <Alert severity="error" sx={{ mb: 3 }}>
          Failed to load floor planning data. Please refresh.
        </Alert>
      )}

      {!isLoading && !isError && tab !== 'map' && (
        <>
          <Box sx={{ mb: 4 }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2 }}>
              <LayoutDashboard size={18} />
              <Typography variant="subtitle1" fontWeight={700}>Warehouse Zones</Typography>
              <Chip label={zones.length} size="small" />
            </Box>

            {zones.length === 0 ? (
              <Paper variant="outlined" sx={{ textAlign: 'center', py: 6, borderRadius: 2, borderStyle: 'dashed' }}>
                <LayoutDashboard size={36} style={{ opacity: 0.3 }} />
                <Typography variant="body2" color="text.secondary" sx={{ mt: 2 }}>
                  No warehouse zones configured.
                </Typography>
              </Paper>
            ) : (
              zones.map((zone) => <ZoneCard key={zone.location_code} zone={zone} />)
            )}
          </Box>

          <Divider sx={{ mb: 4 }} />

          <Box>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2 }}>
              <PackageSearch size={18} />
              <Typography variant="subtitle1" fontWeight={700}>Product Barcodes</Typography>
              <Chip label={productBarcodes.length} size="small" />
            </Box>
            <ProductBarcodesTable items={productBarcodes} />
          </Box>
        </>
      )}
    </Box>
  );
}

export default function FloorPlanningModuleFT2(props: FloorPlanningPageProps) {
  return <ModuleErrorBoundary moduleName="floor-planning"><FloorPlanningModuleFT2Inner {...props} /></ModuleErrorBoundary>;
}