// modules/floor-planning/src/ui/pages/FloorPlanningModuleFT2.tsx
import { useState } from 'react';
import {
  Box,
  Paper,
  Typography,
  CircularProgress,
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
} from '@mui/material';
import { LayoutDashboard, Tag, PackageSearch, ChevronDown, ChevronUp } from 'lucide-react';

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

export default function FloorPlanningModuleFT2({
  data,
  isLoading,
  isError,
}: FloorPlanningPageProps) {
  const zones = data?.zones ?? [];
  const productBarcodes = data?.product_barcodes ?? [];

  return (
    <Box sx={{ p: 2, maxWidth: 700, mx: 'auto' }}>

      <Box sx={{ mb: 3 }}>
        <Typography variant="h5" fontWeight={700}>Floor Planning</Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
          Manage warehouse zones and barcode assignments for locations and products.
        </Typography>
      </Box>

      {isLoading && (
        <Box sx={{ display: 'flex', justifyContent: 'center', pt: 6 }}>
          <CircularProgress size={24} />
        </Box>
      )}

      {isError && (
        <Alert severity="error" sx={{ mb: 3 }}>
          Failed to load floor planning data. Please refresh.
        </Alert>
      )}

      {!isLoading && !isError && (
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