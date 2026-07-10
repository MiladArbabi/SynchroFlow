// apps/backend/src/api/suppliers/supplierPreferences.controller.ts
//
// Supplier-product preference endpoints.
// Full design: sourcing-recommendation-playbook.md §7.
//
// RLS: all queries require SET LOCAL app.current_tenant.
// No auto-selection ever — preferences inform ranking only.

import { Request, Response } from 'express';
import db from '@lasyncro/backend-core/db.js';

const VALID_SCOPE_TYPES = ['variant', 'product', 'product_type'] as const;
type ScopeType = typeof VALID_SCOPE_TYPES[number];

// ── GET /preferences ──────────────────────────────────────────────────────────
// Returns all preferences for the shop, with supplier name joined.
export async function httpListPreferences(req: Request, res: Response) {
  const shopId = req.user?.shopId;
  if (!shopId) return res.status(401).json({ error: 'Unauthorized' });

  try {
    const rows = await (async () => {
      return (await db.transaction(async (trx) => {
        await trx.raw(`SET LOCAL "app.current_tenant" = '${shopId}'`);
        return trx('supplier_product_preferences as spp')
          .join('suppliers as s', 's.id', 'spp.supplier_id')
          .where('spp.shop_id', shopId)
          .orderBy(['spp.scope_type', 'spp.scope_id', 'spp.priority'])
          .select(
            'spp.id', 'spp.scope_type', 'spp.scope_id', 'spp.priority',
            'spp.note', 'spp.created_at', 'spp.updated_at',
            'spp.supplier_id', 's.name as supplier_name'
          );
      })) as any[];
    })();

    return res.json({ preferences: rows });
  } catch (err) {
    console.error('[preferences] httpListPreferences failed', err);
    return res.status(500).json({ error: 'Failed to fetch preferences' });
  }
}

// ── POST /preferences ─────────────────────────────────────────────────────────
// Creates a new supplier-product preference row.
export async function httpCreatePreference(req: Request, res: Response) {
  const shopId  = req.user?.shopId;
  const userId  = req.user?.userId;
  if (!shopId) return res.status(401).json({ error: 'Unauthorized' });

  const { supplier_id, scope_type, scope_id, priority = 1, note } = req.body ?? {};

  if (!supplier_id || !scope_type || !scope_id) {
    return res.status(400).json({ error: 'supplier_id, scope_type, and scope_id are required' });
  }
  if (!VALID_SCOPE_TYPES.includes(scope_type as ScopeType)) {
    return res.status(400).json({ error: `scope_type must be one of: ${VALID_SCOPE_TYPES.join(', ')}` });
  }
  if (typeof priority !== 'number' || priority < 1) {
    return res.status(400).json({ error: 'priority must be a positive integer' });
  }

  try {
    const row = await (async () => {
      return (await db.transaction(async (trx) => {
        await trx.raw(`SET LOCAL "app.current_tenant" = '${shopId}'`);

        // Verify supplier belongs to this shop
        const supplier = await trx('suppliers').where({ id: supplier_id, shop_id: shopId, active: true }).first();
        if (!supplier) return null;

        const [inserted] = await trx('supplier_product_preferences')
          .insert({ shop_id: shopId, supplier_id, scope_type, scope_id, priority, note: note ?? null, created_by: userId ?? null })
          .onConflict(['shop_id', 'scope_type', 'scope_id', 'supplier_id'])
          .merge({ priority, note: note ?? null, updated_at: trx.fn.now() })
          .returning('*');
        return inserted;
      })) as any;
    })();

    if (!row) return res.status(404).json({ error: 'Supplier not found' });
    return res.status(201).json({ preference: row });
  } catch (err) {
    console.error('[preferences] httpCreatePreference failed', err);
    return res.status(500).json({ error: 'Failed to create preference' });
  }
}

// ── PATCH /preferences/:id ────────────────────────────────────────────────────
// Updates priority or note on an existing preference.
export async function httpUpdatePreference(req: Request, res: Response) {
  const shopId = req.user?.shopId;
  if (!shopId) return res.status(401).json({ error: 'Unauthorized' });

  const { id } = req.params;
  const { priority, note } = req.body ?? {};

  if (priority !== undefined && (typeof priority !== 'number' || priority < 1)) {
    return res.status(400).json({ error: 'priority must be a positive integer' });
  }

  try {
    const row = await (async () => {
      return (await db.transaction(async (trx) => {
        await trx.raw(`SET LOCAL "app.current_tenant" = '${shopId}'`);
        const updates: Record<string, any> = { updated_at: trx.fn.now() };
        if (priority !== undefined) updates.priority = priority;
        if (note !== undefined) updates.note = note;
        const [updated] = await trx('supplier_product_preferences')
          .where({ id, shop_id: shopId })
          .update(updates)
          .returning('*');
        return updated;
      })) as any;
    })();

    if (!row) return res.status(404).json({ error: 'Preference not found' });
    return res.json({ preference: row });
  } catch (err) {
    console.error('[preferences] httpUpdatePreference failed', err);
    return res.status(500).json({ error: 'Failed to update preference' });
  }
}

// ── DELETE /preferences/:id ───────────────────────────────────────────────────
export async function httpDeletePreference(req: Request, res: Response) {
  const shopId = req.user?.shopId;
  if (!shopId) return res.status(401).json({ error: 'Unauthorized' });

  const { id } = req.params;

  try {
    await db.transaction(async (trx) => {
      await trx.raw(`SET LOCAL "app.current_tenant" = '${shopId}'`);
      await trx('supplier_product_preferences').where({ id, shop_id: shopId }).delete();
    });
    return res.status(204).send();
  } catch (err) {
    console.error('[preferences] httpDeletePreference failed', err);
    return res.status(500).json({ error: 'Failed to delete preference' });
  }
}