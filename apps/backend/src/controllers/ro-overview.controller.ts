import { Request, Response } from 'express';
/**
 * TEMPORARY: RO snapshot read is not yet implemented.
 * This controller intentionally returns a null mirror
 * until the RO snapshot writer is wired under FT2 latch.
 */
/* import { getLatestROOverviewSnapshot } from 'api-src/services/ro-overview/roOverviewSnapshot.service';
 */

/**
 * RO Overview Controller
 * ----------------------
 * Read-only FT2 mirror surface.
 * - Snapshot-backed
 * - Trust-gated upstream
 * - No recomputation
 */
export async function getROOverview(req: Request, res: Response) {
  return res.json({
    trust: null,
    domains: {},
  });
}