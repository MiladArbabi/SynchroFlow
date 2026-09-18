import type { NextFunction, Request, Response } from 'express';
import db from '@lasyncro/backend-core/db.js';

type LookupMode = 'job' | 'line';

type ReceiveOwnership = {
  receive_job_id: string;
  assigned_operator_id: number | null;
  started_at: Date | null;
};

async function resolveOwnership(
  shopId: number,
  mode: LookupMode,
  id: string
): Promise<ReceiveOwnership | undefined> {
  return db.transaction(async (trx) => {
    await trx.raw(`SET LOCAL "app.current_tenant" = '${shopId}'`);

    if (mode === 'job') {
      return await trx('receive_jobs')
        .where({
          shop_id: shopId,
          receive_job_id: id,
        })
        .first<ReceiveOwnership>(
          'receive_job_id',
          'assigned_operator_id',
          'started_at'
        );
    }

    return await trx('receive_job_lines as rjl')
      .join(
        'receive_jobs as rj',
        'rj.receive_job_id',
        'rjl.receive_job_id'
      )
      .where({
        'rjl.shop_id': shopId,
        'rj.shop_id': shopId,
        'rjl.receive_job_line_id': id,
      })
      .first<ReceiveOwnership>(
        'rj.receive_job_id',
        'rj.assigned_operator_id',
        'rj.started_at'
      );
  });
}

function requireReceiveOwnership(
  mode: LookupMode,
  paramName: 'jobId' | 'lineId'
) {
  return async (
    req: Request,
    res: Response,
    next: NextFunction
  ) => {
    const shopId = req.user?.shopId;
    const userId = req.user?.userId;

    if (!shopId || !userId) {
      return res.status(401).json({
        error: 'Unauthorized',
      });
    }

    const rawId = req.params[paramName];
    const id = Array.isArray(rawId) ? rawId[0] : rawId;

    if (!id) {
      return res.status(400).json({
        error:
          mode === 'job'
            ? 'receive_job_id required'
            : 'receive_job_line_id required',
      });
    }

    try {
      const ownership = await resolveOwnership(
        shopId,
        mode,
        id
      );

      if (!ownership) {
        return res.status(404).json({
          error: 'RECEIVE_JOB_NOT_FOUND',
        });
      }

      if (
        !ownership.assigned_operator_id ||
        !ownership.started_at
      ) {
        return res.status(409).json({
          error: 'JOB_NOT_CLAIMED',
        });
      }

      if (
        ownership.assigned_operator_id !== userId
      ) {
        return res.status(409).json({
          error: 'JOB_CLAIMED_BY_OTHER',
        });
      }

      return next();
    } catch (err) {
      console.error(
        '[RECEIVE_JOB_OWNERSHIP_CHECK_FAILED]',
        {
          shopId,
          userId,
          mode,
          id,
          error:
            err instanceof Error
              ? err.message
              : String(err),
        }
      );

      return res.status(500).json({
        error: 'RECEIVE_JOB_OWNERSHIP_CHECK_FAILED',
      });
    }
  };
}

export const requireReceiveJobOwner =
  requireReceiveOwnership('job', 'jobId');

export const requireReceiveJobOwnerFromLine =
  requireReceiveOwnership('line', 'lineId');
