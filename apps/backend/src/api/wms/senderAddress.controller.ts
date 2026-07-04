// Sender address CRUD — shop's own "ship from" address(es).
// Mirrors the CRUD shape already used for carrier webhook tokens:
// tenant-scoped, RLS-enforced, no encryption needed (not a secret).
import { Request, Response } from 'express';
import db from '@lasyncro/backend-core/db.js';
import { email } from 'zod';

export const httpListSenderAddresses = async (req: Request, res: Response) => {
  try {
    const shopId = req.user?.shopId;
    if (!shopId) return res.status(401).json({ error: 'Unauthorized' });
    await db.raw(`SET "app.current_tenant" = '${shopId}'`);
    const addresses = await db('shop_sender_addresses')
      .where({ shop_id: shopId })
      .orderBy('is_default', 'desc')
      .select('*');
    return res.json({ addresses });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('[SENDER_ADDRESS_LIST_FAILED]', { error: message });
    return res.status(500).json({ error: `Failed: ${message}` });
  }
};

export const httpCreateSenderAddress = async (req: Request, res: Response) => {
  try {
    const shopId = req.user?.shopId;
    if (!shopId) return res.status(401).json({ error: 'Unauthorized' });
    const { name, street1, street2, city, state, postal_code, country_code, phone, email, is_default } = req.body;

    if (!name || !street1 || !city || !postal_code || !country_code || !phone) {
      return res.status(400).json({ error: 'name, street1, city, postal_code, country_code, and phone are required' });
    }

    await db.raw(`SET "app.current_tenant" = '${shopId}'`);

    await db.transaction(async (trx) => {
      await trx.raw(`SET LOCAL app.current_tenant = '${shopId}'`);

      // Only one default per shop — demote any existing default first
      if (is_default !== false) {
        await trx('shop_sender_addresses').where({ shop_id: shopId, is_default: true }).update({ is_default: false });
      }

      const [address] = await trx('shop_sender_addresses')
        .insert({
          shop_id: shopId,
          name, street1, street2: street2 ?? null,
          city, state: state ?? null,
          postal_code, country_code, phone,
          email: email ?? null,
          is_default: is_default !== false,
        })
        .returning('*');

      return res.status(201).json({ address });
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('[SENDER_ADDRESS_CREATE_FAILED]', { error: message });
    return res.status(500).json({ error: `Failed: ${message}` });
  }
};

export const httpUpdateSenderAddress = async (req: Request, res: Response) => {
  try {
    const shopId = req.user?.shopId;
    if (!shopId) return res.status(401).json({ error: 'Unauthorized' });
    const { id } = req.params;
    const { name, street1, street2, city, state, postal_code, country_code, phone, email, is_default } = req.body;

    await db.transaction(async (trx) => {
      await trx.raw(`SET LOCAL app.current_tenant = '${shopId}'`);

      if (is_default === true) {
        await trx('shop_sender_addresses').where({ shop_id: shopId, is_default: true }).update({ is_default: false });
      }

      const updated = await trx('shop_sender_addresses')
        .where({ id, shop_id: shopId })
        .update({
          ...(name !== undefined && { name }),
          ...(street1 !== undefined && { street1 }),
          ...(street2 !== undefined && { street2 }),
          ...(city !== undefined && { city }),
          ...(state !== undefined && { state }),
          ...(postal_code !== undefined && { postal_code }),
          ...(country_code !== undefined && { country_code }),
          ...(phone !== undefined && { phone }),
          ...(email !== undefined && { email }),
          ...(is_default !== undefined && { is_default }),
          updated_at: new Date(),
        })
        .returning('*');

      if (!updated.length) return res.status(404).json({ error: 'ADDRESS_NOT_FOUND' });
      return res.json({ address: updated[0] });
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('[SENDER_ADDRESS_UPDATE_FAILED]', { error: message });
    return res.status(500).json({ error: `Failed: ${message}` });
  }
};

export const httpDeleteSenderAddress = async (req: Request, res: Response) => {
  try {
    const shopId = req.user?.shopId;
    if (!shopId) return res.status(401).json({ error: 'Unauthorized' });
    const { id } = req.params;
    await db.raw(`SET "app.current_tenant" = '${shopId}'`);
    const deleted = await db('shop_sender_addresses').where({ id, shop_id: shopId }).delete();
    if (!deleted) return res.status(404).json({ error: 'ADDRESS_NOT_FOUND' });
    return res.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('[SENDER_ADDRESS_DELETE_FAILED]', { error: message });
    return res.status(500).json({ error: `Failed: ${message}` });
  }
};