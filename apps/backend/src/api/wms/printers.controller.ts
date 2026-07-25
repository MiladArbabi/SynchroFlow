// apps/backend/src/api/wms/printers.controller.ts
import { Request, Response } from 'express';
import db from '@lasyncro/backend-core/db.js';
import { getErrorMessage } from '@lasyncro/backend-core';
// FP-18: mirrors the printer_role Postgres enum (migrations 0106, 0127).
// Validated at the controller layer so an invalid role returns a clean
// 400 instead of a raw Postgres constraint error leaking through as a
// 500 — keep this list in sync if the enum ever changes.
const VALID_PRINTER_ROLES = ['unit_label', 'invoice', 'problem_label', 'location_label', 'general'] as const;
/**
 * PRINTERS CONTROLLER (WM-47)
 * ----------------------------
 * CRUD for shop-scoped printer registry.
 * Printers are registered by owner/admin via Settings → Warehouse → Printers.
 * QZ Tray detects OS printer names on the client — admin assigns roles here.
 *
 * Role routing:
 *   unit_label    → LSU- thermal labels (WM-46)
 *   invoice       → A4 invoice PDFs (WM-34)
 *   problem_label → PROB-BIN labels (problem center)
 *   general       → fallback for unrouted jobs
 *
 * is_default per role: enforced at application layer — when a new default
 * is set for a role, all other printers of that role are unset.
 */

// ─────────────────────────────────────────
// GET /api/v1/wms/printers
// ─────────────────────────────────────────
export const httpListPrinters = async (req: Request, res: Response) => {
  const shopId = req.user?.shopId;
  if (!shopId) return res.status(401).json({ error: 'Unauthorized' });

  try {
    const printers = await db.transaction(async (trx) => {
      await trx.raw(`SET LOCAL "app.current_tenant" = '${shopId}'`);
      return trx('printers')
        .where({ shop_id: shopId, active: true })
        .orderBy('role')
        .orderBy('name')
        .select(
          'printer_id', 'name', 'connection_type', 'address',
          'model', 'role', 'os_printer_name', 'is_default', 'active',
          'created_at'
        );
    });
    return res.status(200).json({ printers });
  } catch (err: unknown) {
    console.error('[PRINTERS_LIST_FAILED]', { shopId, error: getErrorMessage(err) });
    return res.status(500).json({ error: `Failed to list printers: ${getErrorMessage(err)}` });
  }
};

// ─────────────────────────────────────────
// POST /api/v1/wms/printers
// ─────────────────────────────────────────
export const httpCreatePrinter = async (req: Request, res: Response) => {
  const shopId = req.user?.shopId;
  if (!shopId) return res.status(401).json({ error: 'Unauthorized' });

  const { name, connection_type, address, model, role, os_printer_name, is_default } = req.body;
  if (!name || !connection_type || !role) {
    return res.status(400).json({ error: 'name, connection_type, role required' });
  }
  if (!VALID_PRINTER_ROLES.includes(role)) {
    return res.status(400).json({ error: `Invalid role. Must be one of: ${VALID_PRINTER_ROLES.join(', ')}` });
  }
  try {
    const printer = await db.transaction(async (trx) => {
      await trx.raw(`SET LOCAL "app.current_tenant" = '${shopId}'`);

      // If new printer is default for its role — unset all others for that role
      if (is_default) {
        await trx('printers')
          .where({ shop_id: shopId, role, is_default: true })
          .update({ is_default: false, updated_at: new Date() });
      }

      const [row] = await trx('printers')
        .insert({
          shop_id: shopId,
          name,
          connection_type,
          address: address ?? null,
          model: model ?? null,
          role,
          os_printer_name: os_printer_name ?? null,
          is_default: is_default ?? false,
          active: true,
          created_at: new Date(),
          updated_at: new Date(),
        })
        .returning('*');
      return row;
    });

    console.info('[PRINTER_CREATED]', { shopId, printerId: printer.printer_id, role });
    return res.status(201).json({ printer });
  } catch (err: unknown) {
    console.error('[PRINTER_CREATE_FAILED]', { shopId, error: getErrorMessage(err) });
    return res.status(500).json({ error: `Failed to create printer: ${getErrorMessage(err)}` });
  }
};

// ─────────────────────────────────────────
// PATCH /api/v1/wms/printers/:printerId
// ─────────────────────────────────────────
export const httpUpdatePrinter = async (req: Request, res: Response) => {
  const shopId = req.user?.shopId;
  if (!shopId) return res.status(401).json({ error: 'Unauthorized' });

  const { printerId } = req.params;
  const { name, connection_type, address, model, role, os_printer_name, is_default } = req.body;
  if (role !== undefined && !VALID_PRINTER_ROLES.includes(role)) {
    return res.status(400).json({ error: `Invalid role. Must be one of: ${VALID_PRINTER_ROLES.join(', ')}` });
  }
  try {
    const printer = await db.transaction(async (trx) => {
      await trx.raw(`SET LOCAL "app.current_tenant" = '${shopId}'`);

      const existing = await trx('printers')
        .where({ printer_id: printerId, shop_id: shopId })
        .first();
      if (!existing) throw new Error('Printer not found');

      const targetRole = role ?? existing.role;

      // If setting as default — unset others for that role
      if (is_default) {
        await trx('printers')
          .where({ shop_id: shopId, role: targetRole, is_default: true })
          .whereNot({ printer_id: printerId })
          .update({ is_default: false, updated_at: new Date() });
      }

      const updates: Record<string, unknown> = { updated_at: new Date() };
      if (name !== undefined)            updates.name = name;
      if (connection_type !== undefined) updates.connection_type = connection_type;
      if (address !== undefined)         updates.address = address;
      if (model !== undefined)           updates.model = model;
      if (role !== undefined)            updates.role = role;
      if (os_printer_name !== undefined) updates.os_printer_name = os_printer_name;
      if (is_default !== undefined)      updates.is_default = is_default;

      const [row] = await trx('printers')
        .where({ printer_id: printerId, shop_id: shopId })
        .update(updates)
        .returning('*');
      return row;
    });

    console.info('[PRINTER_UPDATED]', { shopId, printerId });
    return res.status(200).json({ printer });
  } catch (err: unknown) {
    console.error('[PRINTER_UPDATE_FAILED]', { shopId, printerId, error: getErrorMessage(err) });
    if (getErrorMessage(err).includes('not found')) return res.status(404).json({ error: 'Printer not found' });
    return res.status(500).json({ error: `Failed to update printer: ${getErrorMessage(err)}` });
  }
};

// ─────────────────────────────────────────
// DELETE /api/v1/wms/printers/:printerId
// ─────────────────────────────────────────
// Soft delete — sets active = false. Preserves print job audit trail.
export const httpDeletePrinter = async (req: Request, res: Response) => {
  const shopId = req.user?.shopId;
  if (!shopId) return res.status(401).json({ error: 'Unauthorized' });

  const { printerId } = req.params;

  try {
    await db.transaction(async (trx) => {
      await trx.raw(`SET LOCAL "app.current_tenant" = '${shopId}'`);
      const count = await trx('printers')
        .where({ printer_id: printerId, shop_id: shopId })
        .update({ active: false, is_default: false, updated_at: new Date() });
      if (!count) throw new Error('Printer not found');
    });

    console.info('[PRINTER_DELETED]', { shopId, printerId });
    return res.status(200).json({ deleted: true });
  } catch (err: unknown) {
    console.error('[PRINTER_DELETE_FAILED]', { shopId, printerId, error: getErrorMessage(err) });
    if (getErrorMessage(err).includes('not found')) return res.status(404).json({ error: 'Printer not found' });
    return res.status(500).json({ error: `Failed to delete printer: ${getErrorMessage(err)}` });
  }
};

// ─────────────────────────────────────────
// GET /api/v1/wms/printers/default/:role
// ─────────────────────────────────────────
// Returns the default printer for a given role.
// Used by the print dispatch layer to route jobs silently via QZ Tray.
export const httpGetDefaultPrinter = async (req: Request, res: Response) => {
  const shopId = req.user?.shopId;
  if (!shopId) return res.status(401).json({ error: 'Unauthorized' });

  const { role } = req.params;

  try {
    const printer = await db.transaction(async (trx) => {
      await trx.raw(`SET LOCAL "app.current_tenant" = '${shopId}'`);
      return trx('printers')
        .where({ shop_id: shopId, role, is_default: true, active: true })
        .select('printer_id', 'name', 'os_printer_name', 'connection_type', 'address', 'role')
        .first() ?? null;
    });

    if (!printer) return res.status(404).json({ error: `No default printer for role: ${role}` });
    return res.status(200).json({ printer });
  } catch (err: unknown) {
    console.error('[PRINTER_DEFAULT_FAILED]', { shopId, role, error: getErrorMessage(err) });
    return res.status(500).json({ error: `Failed to get default printer: ${getErrorMessage(err)}` });
  }
};