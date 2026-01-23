import { Request, Response } from 'express';
import { getTrustFt2Snapshot } from 'api-src/services/trust-ft2/trustFt2.resolver';

/**
 * GET /api/v1/modules/trust/ft2
 *
 * Trust FT2 Controller
 * -------------------
 * Terminal trust gate for FT2 surfaces.
 *
 * HARD RULES (NON-NEGOTIABLE):
 * - Authenticated
 * - Shop-scoped
 * - NO time ranges
 * - NO lifecycle mutation
 * - NO intelligence
 * - NO explanations
 *
 * This controller MUST NOT:
 * - catch or mask trust failures
 * - downgrade or fabricate trust
 *
 * If Trust FT2 is unavailable,
 * this endpoint MUST fail loudly.
 */
export async function getTrustFt2(
  req: Request,
  res: Response
): Promise<void> {
  try {
    const shopId = req.user?.shopId;

    if (!shopId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const snapshot = await getTrustFt2Snapshot({
      shopId,
    });

    res.status(200).json(snapshot);
  } catch (err) {
    const message =
      err instanceof Error ? err.message : 'Trust FT2 unavailable';

    res.status(500).json({ error: message });
  }
}