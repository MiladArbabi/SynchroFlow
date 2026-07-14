// apps/frontend/src/pages/ft2-pages/ProblemCenterPage.tsx
import { useCallback, useState } from 'react';
import {
  Box, Typography, Chip, Dialog, DialogTitle, DialogContent,
  DialogActions, Button, TextField,
} from '@mui/material';
import { useTheme } from '@mui/material/styles';
import { AlertTriangle, CheckCircle2, XCircle, Clock } from 'lucide-react';
import { ProblemCenterModuleFT2 } from '@lasyncro/problem-center';
import { useProblemCenter } from '../problem-center/useProblemCenter';
import { usePackDecisions, useResolvePackDecision } from '../problem-center/usePackDecisions';
import { useAppTheme } from '../../hooks/useAppTheme';
import { axiosInstance } from 'api/axiosConfig';
import { ModuleTabBar } from '../../components/ModuleTabBar';
import { WAREHOUSE_MODULE_TABS } from './warehouseModuleTabs';

function relativeAge(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 2) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

/**
 * PendingDecisionsStrip
 * ----------------------
 * Surfaces pack decision requests awaiting owner/admin approval.
 * Packer is blocked — each row shows context + Approve/Reject.
 * Polls every 10s — packer is waiting in real time.
 */
function PendingDecisionsStrip() {
  const pal   = useAppTheme();
  const theme = useTheme();
  const { data, isLoading } = usePackDecisions('pending');
  const { mutate: resolve, isPending } = useResolvePackDecision();

  const [dialog, setDialog] = useState<{
    requestId: string;
    action: 'approved' | 'rejected';
    orderRef: string;
    exceptionType: string;
  } | null>(null);
  const [note, setNote] = useState('');

  const requests = data?.requests ?? [];
  if (isLoading || requests.length === 0) return null;

  const handleConfirm = () => {
    if (!dialog) return;
    resolve({
      requestId:       dialog.requestId,
      status:          dialog.action,
      partialShipment: dialog.action === 'approved' ? true : undefined,
      note:            note || undefined,
    }, {
      onSuccess: () => { setDialog(null); setNote(''); },
    });
  };

  return (
    <>
      <Box sx={{
        mb: 2.5, border: `0.5px solid ${theme.palette.warning.main}44`,
        borderRadius: '10px', overflow: 'hidden',
        bgcolor: pal.surface,
      }}>
        {/* Header */}
        <Box sx={{
          px: 2, py: 1.25, display: 'flex', alignItems: 'center', gap: 1,
          bgcolor: `${theme.palette.warning.main}0D`,
          borderBottom: `0.5px solid ${theme.palette.warning.main}33`,
        }}>
          <AlertTriangle size={14} color={theme.palette.warning.main} />
          <Typography sx={{ fontSize: 12, fontWeight: 500, color: theme.palette.warning.main }}>
            {requests.length} pack decision{requests.length > 1 ? 's' : ''} pending — packer{requests.length > 1 ? 's are' : ' is'} waiting
          </Typography>
          <Typography sx={{ fontSize: 11, color: pal.ink4, ml: 'auto' }}>
            Refreshes every 10s
          </Typography>
        </Box>

        {/* Decision rows */}
        {requests.map((req, idx) => {
          const exLabel = req.exception_type.replace(/_/g, ' ');
          const orderRef = req.external_order_id ? `#${req.external_order_id}` : req.lasyncro_order_id.slice(0, 8).toUpperCase();
          const itemLabel = req.variant_title ?? req.sku ?? req.lasyncro_line_item_id.slice(0, 8).toUpperCase();
          const batchShort = req.pick_batch_id.slice(0, 8).toUpperCase();

          return (
            <Box key={req.id} sx={{
              px: 2, py: 1.5,
              borderTop: idx > 0 ? `0.5px solid ${pal.rule}` : 'none',
              display: 'flex', alignItems: 'center', gap: 2, flexWrap: 'wrap',
            }}>
              {/* Context */}
              <Box sx={{ flex: 1, minWidth: 200 }}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.4 }}>
                  <Chip label={exLabel} size="small" sx={{
                    fontSize: 10, height: 18, fontWeight: 500,
                    bgcolor: `${theme.palette.warning.main}1A`,
                    color: theme.palette.warning.main,
                    border: `0.5px solid ${theme.palette.warning.main}44`,
                  }} />
                  <Typography sx={{ fontSize: 12, fontWeight: 500, color: pal.ink }}>
                    Order {orderRef}
                  </Typography>
                  <Typography sx={{ fontSize: 11, color: pal.ink4 }}>
                    Batch {batchShort}
                  </Typography>
                </Box>
                <Typography sx={{ fontSize: 12, color: pal.ink3 }}>
                  {itemLabel} · Raised <Clock size={10} style={{ verticalAlign: 'middle' }} /> {relativeAge(req.raised_at)}
                </Typography>
              </Box>

              {/* Actions */}
              <Box sx={{ display: 'flex', gap: 1, flexShrink: 0 }}>
                <Box
                  onClick={() => { setDialog({ requestId: req.id, action: 'approved', orderRef, exceptionType: req.exception_type }); setNote(''); }}
                  sx={{
                    display: 'inline-flex', alignItems: 'center', gap: 0.5,
                    px: 1.25, py: 0.5, fontSize: 12, fontWeight: 500,
                    bgcolor: `${theme.palette.success.main}1A`,
                    border: `0.5px solid ${theme.palette.success.main}44`,
                    color: theme.palette.success.main,
                    borderRadius: '6px', cursor: isPending ? 'wait' : 'pointer',
                    '&:hover': { bgcolor: `${theme.palette.success.main}2A` },
                  }}
                >
                  <CheckCircle2 size={12} /> Ship partial
                </Box>
                <Box
                  onClick={() => { setDialog({ requestId: req.id, action: 'rejected', orderRef, exceptionType: req.exception_type }); setNote(''); }}
                  sx={{
                    display: 'inline-flex', alignItems: 'center', gap: 0.5,
                    px: 1.25, py: 0.5, fontSize: 12, fontWeight: 500,
                    bgcolor: `${theme.palette.error.main}1A`,
                    border: `0.5px solid ${theme.palette.error.main}44`,
                    color: theme.palette.error.main,
                    borderRadius: '6px', cursor: isPending ? 'wait' : 'pointer',
                    '&:hover': { bgcolor: `${theme.palette.error.main}2A` },
                  }}
                >
                  <XCircle size={12} /> Hold order
                </Box>
              </Box>
            </Box>
          );
        })}
      </Box>

      {/* Confirmation dialog */}
      <Dialog open={!!dialog} onClose={() => setDialog(null)} fullWidth maxWidth="xs">
        <DialogTitle sx={{ fontSize: 15, fontWeight: 500 }}>
          {dialog?.action === 'approved' ? 'Approve partial shipment?' : 'Hold order?'}
        </DialogTitle>
        <DialogContent sx={{ pt: '8px !important' }}>
          <Typography sx={{ fontSize: 13, color: pal.ink3, mb: 2 }}>
            {dialog?.action === 'approved'
              ? `Order ${dialog?.orderRef} will ship without the missing item. The packer will be notified.`
              : `Order ${dialog?.orderRef} will be held and re-queued. The packer will be notified.`}
          </Typography>
          <TextField
            label="Note to packer (optional)"
            fullWidth size="small" multiline rows={2}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder={dialog?.action === 'approved'
              ? 'e.g. Ship — customer notified about missing item'
              : 'e.g. Wait for restock — ETA 2 days'}
            InputProps={{ sx: { fontSize: 13 } }}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDialog(null)} sx={{ fontSize: 13 }}>Cancel</Button>
          <Button
            variant="contained"
            onClick={handleConfirm}
            disabled={isPending}
            color={dialog?.action === 'approved' ? 'success' : 'error'}
            sx={{ fontSize: 13 }}
          >
            {isPending ? 'Saving…' : dialog?.action === 'approved' ? 'Approve' : 'Hold order'}
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
}

export default function ProblemCenterPage() {
  const { data, isLoading, isError, refetch } = useProblemCenter();

  const handleResolve = useCallback(async (exceptionId: string, action: string, note: string) => {
    await axiosInstance.post(`/api/v1/wms/problem-center/${exceptionId}/resolve`, {
      resolution_action: action,
      resolution_notes: note || undefined,
    });
  }, []);

  return (
    <>
      {/* Warehouse-level tab bar — shared definition, see warehouseModuleTabs.ts. */}
      <ModuleTabBar tabs={WAREHOUSE_MODULE_TABS} />
      {/* PENDING DECISIONS — shown above exceptions table when packer is waiting */}
      <Box sx={{ px: '40px', pt: '24px' }}>
        <PendingDecisionsStrip />
      </Box>
      <ProblemCenterModuleFT2
        data={data ?? null}
        isLoading={isLoading}
        isError={isError}
        onResolve={handleResolve}
        onRefresh={refetch}
      />
    </>
  );
}