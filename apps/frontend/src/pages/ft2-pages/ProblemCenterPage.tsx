// apps/frontend/src/pages/ft2-pages/ProblemCenterPage.tsx
import { useCallback, useMemo } from 'react';
import { Box } from '@mui/material';
import { useNavigate } from 'react-router-dom';
import { ProblemCenterModuleFT2, type PackDecisionCopy, type PackDecisionItem } from '@lasyncro/problem-center';
import { useProblemCenter } from '../problem-center/useProblemCenter';
import { usePackDecisions, useResolvePackDecision } from '../problem-center/usePackDecisions';
import { axiosInstance } from 'api/axiosConfig';
import { ModuleTabBar } from '../../components/ModuleTabBar';
import { CommercialGate } from '../../components/CommercialGate';
import { WAREHOUSE_MODULE_TABS } from './warehouseModuleTabs';
import { useAuth } from 'contexts/AuthContext';

/** Problem Center polls so floor progress (e.g. a confirmed recovery Stow) appears without reload. */
const PROBLEM_CENTER_POLL_MS = 15_000;

// GH-1086: pack decision copy is a protected contract
// (tests/contract/pack-decision-hold-semantics-1086). A held order stays held
// and is never re-queued, so the owner is told exactly that.
const PACK_DECISION_COPY: PackDecisionCopy = {
  approveLabel: 'Ship partial',
  approveConfirm: (orderRef) => `Order ${orderRef} will ship without the missing item. The packer will be notified.`,
  holdLabel: 'Hold order',
  holdConfirm: (orderRef) => `Order ${orderRef} will remain on hold and will not move to packing. The packer will be notified.`,
};

export default function ProblemCenterPage() {
  const navigate = useNavigate();
  // GH-1222: pack approve/hold decisions (wms:batch:release) and problem
  // resolution (wms:problem:resolve) are owner/admin management. The pending
  // pack-decision query never runs for operators, and the module hides
  // decision controls. Advisory UI gate only — the backend stays authoritative.
  const { user } = useAuth();
  const canManage = user?.role === 'owner' || user?.role === 'admin';

  const problems = useProblemCenter(true, PROBLEM_CENTER_POLL_MS, { includeRecentResolved: true });
  const packDecisions = usePackDecisions('pending', canManage);
  const { mutateAsync: resolvePackDecision } = useResolvePackDecision();

  const decisions = useMemo<PackDecisionItem[]>(
    () => (canManage ? packDecisions.data?.requests ?? [] : []).map((req) => ({
      id: req.id,
      exception_type: req.exception_type,
      order_ref: req.external_order_id ? `#${req.external_order_id}` : req.lasyncro_order_id.slice(0, 8).toUpperCase(),
      item_label: req.variant_title ?? req.sku ?? req.lasyncro_line_item_id.slice(0, 8).toUpperCase(),
      sku: req.sku,
      batch_ref: req.pick_batch_id.slice(0, 8).toUpperCase(),
      raised_at: req.raised_at,
    })),
    [canManage, packDecisions.data],
  );

  const { refetch: refetchProblems } = problems;
  const { refetch: refetchDecisions } = packDecisions;

  const handleResolve = useCallback(async (taskId: string, action: string, note: string) => {
    const { data } = await axiosInstance.post(`/api/v1/wms/problem-center/${taskId}/resolve`, {
      resolution_action: action,
      resolution_notes: note || undefined,
    });
    return data;
  }, []);

  const handlePackDecision = useCallback(
    (requestId: string, status: 'approved' | 'rejected', note: string) =>
      resolvePackDecision({
        requestId,
        status,
        partialShipment: status === 'approved' ? true : undefined,
        note: note || undefined,
      }),
    [resolvePackDecision],
  );

  const handleRefresh = useCallback(
    () => Promise.all([refetchProblems(), canManage ? refetchDecisions() : Promise.resolve()]),
    [canManage, refetchDecisions, refetchProblems],
  );

  // S4-5 I5: the recovery is completed only by the actual Stow task — open it.
  const openStowTask = useCallback(
    (stowTaskId: string) => navigate(`/wms?stowTaskId=${encodeURIComponent(stowTaskId)}`),
    [navigate],
  );

  return (
    // GH-1222: the BASE page is the operational exception queue and follows
    // warehouse.operations (its list/resolve APIs are warehouse.operations).
    // warehouse.problem_center still gates Growth-only functions inside the
    // surface, never entry to it. A direct URL into /problem-center/* must not
    // bypass this gate.
    <CommercialGate capabilityId="warehouse.operations">
      {/* At desktop widths the page fills the AppLayout content area so only
          the queue and detail panels scroll — never the document. */}
      <Box sx={{ display: 'flex', flexDirection: 'column', minHeight: '100%', '@media (min-width:900px)': { height: '100%' } }}>
        {/* Warehouse-level tab bar — shared definition, see warehouseModuleTabs.ts. */}
        <Box sx={{ flex: 'none' }}>
          <ModuleTabBar tabs={WAREHOUSE_MODULE_TABS} />
        </Box>
        <Box sx={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
          <ProblemCenterModuleFT2
            data={problems.data ?? null}
            isLoading={problems.isLoading}
            isError={problems.isError}
            isRefreshing={problems.isFetching && !problems.isLoading}
            updatedAt={problems.dataUpdatedAt || undefined}
            onResolve={handleResolve}
            onRefresh={handleRefresh}
            canResolve={canManage}
            currentUserId={user?.id ?? null}
            packDecisions={decisions}
            onPackDecision={handlePackDecision}
            packDecisionCopy={PACK_DECISION_COPY}
            onOpenStowTask={openStowTask}
          />
        </Box>
      </Box>
    </CommercialGate>
  );
}
