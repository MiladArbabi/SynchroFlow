// apps/frontend/src/pages/problem-center/useProblemCenter.ts
//
// Fetches problem_center_tasks — all sources: pick, pack, stow, receive, returns.
// Native ProblemTask type — no legacy PickException mapping.
//
// S4-5 I5: maps the V2 read-only projection (real variant / Receive LSU
// identity, recovery Stow state). `includeRecentResolved` asks the backend for
// tasks closed in the last 7 days too — only the Problem Center page does;
// other consumers (Overview) keep the open/investigating scope unchanged.
import { useQuery } from '@tanstack/react-query';
import { axiosInstance } from 'api/axiosConfig';
import type { ProblemCenterData, ProblemTask } from '@lasyncro/problem-center';

type RawProblemTask = Omit<ProblemTask, 'prob_label' | 'lasyncro_variant_id'> & {
  lasyncro_variant_id?: string | null;
  /** Backend alias of problem_center_tasks.notes (the PROB-… label). */
  prob_label?: string | null;
  /** Legacy key some callers/fixtures still send for the same label. */
  notes?: string | null;
  /** SAFETY-015 projection fields (declared here as well as on ProblemTask). */
  variant_sync_mapped?: boolean | null;
  recovery_sync_status?: string | null;
};

export function useProblemCenter(
  enabled = true,
  refetchInterval?: number,
  options: { includeRecentResolved?: boolean } = {}
) {
  const includeRecentResolved = options.includeRecentResolved === true;
  return useQuery<ProblemCenterData>({
    queryKey: includeRecentResolved ? ['problem-center', 'recent-resolved'] : ['problem-center'],
    enabled,
    refetchInterval,
    staleTime: 0,
    queryFn: async () => {
      const { data } = includeRecentResolved
        ? await axiosInstance.get('/api/v1/wms/problem-center', { params: { include: 'recent_resolved' } })
        : await axiosInstance.get('/api/v1/wms/problem-center');
      const raw: RawProblemTask[] = data.problem_tasks ?? [];
      const tasks: ProblemTask[] = raw.map((t) => ({
        problem_task_id:      t.problem_task_id,
        // Older responses did not project the variant; the task id keeps the
        // key unique without pretending to be a variant identity elsewhere.
        lasyncro_variant_id:  t.lasyncro_variant_id ?? t.problem_task_id,
        exception_type:       t.exception_type,
        source:               t.source,
        quantity:             t.quantity,
        prob_label:           t.prob_label ?? t.notes ?? null,
        problem_bin_location: t.problem_bin_location,
        status:               t.status,
        created_at:           t.created_at,
        variant_title:        t.variant_title,
        sku:                  t.sku,
        product_title:               t.product_title ?? null,
        lasyncro_unit_id:            t.lasyncro_unit_id ?? null,
        assigned_operator_id:        t.assigned_operator_id ?? null,
        resolution_action:           t.resolution_action ?? null,
        resolution_notes:            t.resolution_notes ?? null,
        resolved_at:                 t.resolved_at ?? null,
        unit_status:                 t.unit_status ?? null,
        unit_location_code:          t.unit_location_code ?? null,
        receive_custody_verified:    t.receive_custody_verified ?? null,
        receive_job_id:              t.receive_job_id ?? null,
        receive_job_status:          t.receive_job_status ?? null,
        recovery_stow_task_id:       t.recovery_stow_task_id ?? null,
        recovery_stow_status:        t.recovery_stow_status ?? null,
        recovery_stow_location_code: t.recovery_stow_location_code ?? null,
        recovery_stow_created_at:    t.recovery_stow_created_at ?? null,
        variant_sync_mapped:         t.variant_sync_mapped ?? null,
        recovery_sync_status:        t.recovery_sync_status ?? null,
      }));
      return {
        tasks,
        total_unresolved: tasks.filter((t) =>
          t.status === 'open' || t.status === 'investigating'
        ).length,
        // SAFETY-015: shop-scoped recovery eligibility (display only).
        recovery_sync: data.recovery_sync ?? null,
      };
    },
  });
}
