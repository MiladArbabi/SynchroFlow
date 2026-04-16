// modules/suppliers-portal/src/ui/pages/SuppliersPortalPage.tsx
import {
  Box,
  Paper,
  Typography,
  CircularProgress,
  Alert,
  Chip,
  Divider,
} from '@mui/material';
import { Truck, Star, Clock } from 'lucide-react';

/**
 * SUPPLIERS PORTAL MODULE — FT2 SURFACE
 * ---------------------------------------
 * Displays POs, ETA tracking, and supplier ratings.
 *
 * All API data injected via props — module stays decoupled
 * from apps/frontend HTTP layer.
 *
 * Theme-aware: Paper, theme.palette tokens, no hardcoded colors.
 */

export type PurchaseOrder = {
  po_id: string;
  supplier_name: string;
  supplier_rating: number | null; // 1–5, null if unrated
  status: 'pending' | 'confirmed' | 'in_transit' | 'received' | 'cancelled';
  eta: string | null;             // ISO date string
  line_items_count: number;
  total_units: number;
  created_at: string;
};

export type SuppliersPortalData = {
  purchase_orders: PurchaseOrder[];
} | null;

export type SuppliersPortalPageProps = {
  data: SuppliersPortalData;
  isLoading: boolean;
  isError: boolean;
  onRefresh: () => void;
};

const STATUS_LABELS: Record<PurchaseOrder['status'], {
  label: string;
  color: 'default' | 'primary' | 'success' | 'warning' | 'error';
}> = {
  pending:    { label: 'Pending',     color: 'default'  },
  confirmed:  { label: 'Confirmed',   color: 'primary'  },
  in_transit: { label: 'In Transit',  color: 'warning'  },
  received:   { label: 'Received',    color: 'success'  },
  cancelled:  { label: 'Cancelled',   color: 'error'    },
};

function RatingStars({ rating }: { rating: number | null }) {
  if (rating === null) {
    return (
      <Typography variant="caption" color="text.secondary">
        Unrated
      </Typography>
    );
  }
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
      <Star size={12} />
      <Typography variant="caption" fontWeight={700}>
        {rating.toFixed(1)}
      </Typography>
    </Box>
  );
}

function PoCard({ po }: { po: PurchaseOrder }) {
  const status = STATUS_LABELS[po.status] ?? { label: po.status, color: 'default' as const };
  const eta = po.eta ? new Date(po.eta).toLocaleDateString() : '—';
  const createdAt = new Date(po.created_at).toLocaleDateString();

  return (
    <Paper variant="outlined" sx={{ p: 2.5, mb: 2, borderRadius: 2 }}>

      {/* HEADER */}
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1 }}>
        <Typography variant="body2" fontWeight={700} sx={{ fontFamily: 'monospace' }}>
          {po.po_id.slice(0, 8).toUpperCase()}
        </Typography>
        <Chip label={status.label} color={status.color} size="small" />
      </Box>

      {/* SUPPLIER */}
      <Typography variant="subtitle2" fontWeight={700} noWrap sx={{ mb: 0.5 }}>
        {po.supplier_name}
      </Typography>
      <RatingStars rating={po.supplier_rating} />

      <Divider sx={{ my: 1.5 }} />

      {/* STATS */}
      <Box sx={{ display: 'flex', gap: 3 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
          <Truck size={13} />
          <Typography variant="caption" color="text.secondary">
            {po.total_units} units · {po.line_items_count} lines
          </Typography>
        </Box>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
          <Clock size={13} />
          <Typography variant="caption" color="text.secondary">
            ETA: {eta}
          </Typography>
        </Box>
      </Box>

      <Typography variant="caption" color="text.disabled" sx={{ mt: 1, display: 'block' }}>
        Created {createdAt}
      </Typography>
    </Paper>
  );
}

export default function SuppliersPortalModuleFT2({
  data,
  isLoading,
  isError,
}: SuppliersPortalPageProps) {
  const orders = data?.purchase_orders ?? [];

  return (
    <Box sx={{ p: 2, maxWidth: 600, mx: 'auto' }}>

      {/* PAGE HEADER */}
      <Box sx={{ mb: 3 }}>
        <Typography variant="h5" fontWeight={700}>Suppliers</Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
          Purchase orders, ETAs, and supplier ratings.
        </Typography>
      </Box>

      {/* LOADING */}
      {isLoading && (
        <Box sx={{ display: 'flex', justifyContent: 'center', pt: 6 }}>
          <CircularProgress size={24} />
        </Box>
      )}

      {/* ERROR */}
      {isError && (
        <Alert severity="error" sx={{ mb: 3 }}>
          Failed to load supplier data. Please refresh.
        </Alert>
      )}

      {/* EMPTY STATE */}
      {!isLoading && !isError && orders.length === 0 && (
        <Paper
          variant="outlined"
          sx={{ textAlign: 'center', py: 8, borderRadius: 2, borderStyle: 'dashed' }}
        >
          <Truck size={40} style={{ opacity: 0.3 }} />
          <Typography variant="body2" color="text.secondary" sx={{ mt: 2 }}>
            No purchase orders found.
          </Typography>
        </Paper>
      )}

      {/* PO LIST */}
      {!isLoading && orders.map((po) => (
        <PoCard key={po.po_id} po={po} />
      ))}
    </Box>
  );
}