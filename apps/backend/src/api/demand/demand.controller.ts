// apps/backend/src/api/demand/demand.controller.ts

import { Request, Response } from 'express';
import { computeDemandIntelligence } from '../../services/demand/demandIntelligence.service.js';
import { withTenant } from '@lasyncro/backend-core/db.js';
import {
  resolveEffectivePolicy,
  upsertStockProtectionPolicy,
  StockProtectionPolicyValidationError,
  StockProtectionPolicyVersionRequiredError,
  StockProtectionPolicyConflictError,
} from '../../services/inventory/stockProtectionPolicy.service.js';
import {
  gatherBufferDiagnosisEvidence,
  BufferDiagnosisVariantNotFoundError,
} from '../../services/inventory/stockProtectionBufferEvidence.js';
import { computeBufferDiagnosis } from '../../services/inventory/stockProtectionBufferDiagnosis.js';
import { enqueueShopSnapshotJob } from '../../services/shop-snapshot/enqueueShopSnapshotJob.js';

/**
 * GET /api/v1/modules/demand
 * ---------------------------
 * Returns demand velocity, days-of-stock, and reorder signals per variant.
 */
export const httpGetDemand = async (req: Request, res: Response) => {
  try {
    const shopId = req.user?.shopId;
    if (!shopId) return res.status(401).json({ error: 'Unauthorized' });

    const result = await computeDemandIntelligence(shopId);
    return res.status(200).json(result);

  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('[DEMAND_FETCH_FAILED]', { error: message });
    return res.status(500).json({ error: `Failed to fetch demand intelligence: ${message}` });
  }
};

/**
 * GET /api/v1/modules/demand/stock-protection-policy/:variantId
 * ----------------------------------------------------------------
 * STOCK-PROTECT-01 — read the effective Stock Protection Policy (approved
 * merchant configuration, or the legacy 5/7 system default) for one variant.
 * Delegates entirely to stockProtectionPolicy.service.ts; this controller
 * owns no business logic.
 */
export const httpGetStockProtectionPolicy = async (req: Request, res: Response) => {
  try {
    const shopId = req.user?.shopId;
    if (!shopId) return res.status(401).json({ error: 'Unauthorized' });

    const variantId = String(req.params.variantId ?? '');
    const effective = await withTenant(shopId, (trx) => resolveEffectivePolicy(trx, shopId, variantId));
    return res.status(200).json(effective);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('[STOCK_PROTECTION_POLICY_FETCH_FAILED]', { error: message });
    return res.status(500).json({ error: `Failed to fetch stock protection policy: ${message}` });
  }
};

/**
 * PUT /api/v1/modules/demand/stock-protection-policy/:variantId
 * ----------------------------------------------------------------
 * STOCK-PROTECT-01 — approve/create or change the Stock Protection Policy
 * for one variant. expected_version is REQUIRED when modifying an existing
 * approved policy (optimistic concurrency); a stale value maps to 409.
 */
export const httpUpsertStockProtectionPolicy = async (req: Request, res: Response) => {
  try {
    const shopId = req.user?.shopId;
    if (!shopId) return res.status(401).json({ error: 'Unauthorized' });

    const variantId = String(req.params.variantId ?? '');
    const { safetyDays, reviewCycleDays, planningSupplierId, reason, recommendationSnapshot, expectedVersion } =
      req.body ?? {};

    if (
      typeof safetyDays !== 'number' ||
      typeof reviewCycleDays !== 'number' ||
      typeof reason !== 'string' ||
      reason.trim().length === 0
    ) {
      return res.status(400).json({ error: 'INVALID_REQUEST: safetyDays, reviewCycleDays, and reason are required.' });
    }

    const actorId = req.user?.userId != null ? String(req.user.userId) : null;

    const result = await withTenant(shopId, async (trx) => {
      const upserted = await upsertStockProtectionPolicy(trx, {
        shopId,
        variantId,
        safetyDays,
        reviewCycleDays,
        planningSupplierId: planningSupplierId ?? null,
        expectedVersion,
        source: 'ui_approval',
        reason,
        actorType: 'user',
        actorId,
        recommendationSnapshot: recommendationSnapshot ?? null,
      });
      await enqueueShopSnapshotJob(trx, shopId);
      return upserted;
    });

    return res.status(200).json(result.current);
  } catch (error) {
    if (error instanceof StockProtectionPolicyConflictError) {
      return res.status(409).json({ error: error.message });
    }
    if (error instanceof StockProtectionPolicyVersionRequiredError) {
      return res.status(400).json({ error: error.message });
    }
    if (error instanceof StockProtectionPolicyValidationError) {
      return res.status(400).json({ error: error.message });
    }
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('[STOCK_PROTECTION_POLICY_UPSERT_FAILED]', { error: message });
    return res.status(500).json({ error: `Failed to upsert stock protection policy: ${message}` });
  }
};

/**
 * GET /api/v1/modules/demand/stock-protection-recommendation/:variantId
 * ----------------------------------------------------------------
 * STOCK-PROTECT-02 — read-only Buffer Diagnosis recommendation for one
 * variant. Evidence only, never approved-policy authority: this endpoint
 * never reads or writes stock_protection_policies /
 * stock_protection_policy_transitions. Owns no business math itself —
 * gathers evidence via stockProtectionBufferEvidence.ts, then delegates the
 * decision entirely to the pure computeBufferDiagnosis().
 */
export const httpGetStockProtectionRecommendation = async (req: Request, res: Response) => {
  try {
    const shopId = req.user?.shopId;
    if (!shopId) return res.status(401).json({ error: 'Unauthorized' });

    const variantId = String(req.params.variantId ?? '');
    const evidence = await withTenant(shopId, (trx) => gatherBufferDiagnosisEvidence(trx, shopId, variantId));
    const diagnosis = computeBufferDiagnosis(evidence);

    return res.status(200).json(diagnosis);
  } catch (error) {
    if (error instanceof BufferDiagnosisVariantNotFoundError) {
      return res.status(404).json({ error: error.message });
    }
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('[STOCK_PROTECTION_RECOMMENDATION_FETCH_FAILED]', { error: message });
    return res.status(500).json({ error: `Failed to fetch stock protection recommendation: ${message}` });
  }
};
