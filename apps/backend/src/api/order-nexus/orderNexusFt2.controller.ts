// apps/backend/src/api/order-nexus/orderNexusFt2.controller.ts
import { getOrderNexusFt2StateSnapshot } from "../../services/order-nexus-ft2/orderNexusFt2.state.resolver.js";

/**
 * Order-Nexus FT2 Controller
 * -------------------------
 * Read-only FT2 exposure endpoint.
 *
 * Rules:
 * - Authenticated
 * - Shop-scoped
 * - No lifecycle logic
 * - No business logic
 */
export default async function orderNexusFt2Controller(req: any, res: any) {
  const shopId = req.user?.shopId;

  if (!shopId) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const snapshot = await getOrderNexusFt2StateSnapshot(shopId);

  return res.json(snapshot);
}