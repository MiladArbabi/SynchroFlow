// apps/backend/src/api/settings/shopSettings.controller.ts
//
// SRC-05a — SHOP TIMEZONE
// Read/update shops.timezone. Populated from Shopify's ianaTimezone at OAuth,
// overridable here. Writing through this endpoint flips timezone_source to
// 'manual' so a later re-install cannot clobber the merchant's choice.
//
// Validation uses Intl rather than a hardcoded list: the IANA database changes
// (zones split, rename, get added), and a stale allowlist would reject a valid
// zone the merchant's warehouse actually sits in.

import { Request, Response } from 'express';
import db from '@lasyncro/backend-core/db.js';

function isValidIanaZone(zone: string): boolean {
  try {
    // Throws RangeError on an unknown zone — the runtime's own IANA data is
    // the source of truth, not a list we would have to maintain.
    new Intl.DateTimeFormat('en-US', { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}

export async function httpGetShopTimezone(req: Request, res: Response) {
  const shopId = req.user?.shopId;
  if (!shopId) return res.status(401).json({ error: 'Unauthorized' });

  try {
    const row = await db.transaction(async (trx) => {
      await trx.raw(`SET LOCAL "app.current_tenant" = '${shopId}'`);
      return trx('shops')
        .where({ id: shopId })
        .select('timezone', 'timezone_source')
        .first();
    });

    if (!row) return res.status(404).json({ error: 'Shop not found' });

    return res.json({
      timezone:        row.timezone,
      timezone_source: row.timezone_source,
      // Surfaced so the UI can offer "use my device timezone" without the
      // merchant having to know what their IANA zone string is.
      detected_default: Intl.DateTimeFormat().resolvedOptions().timeZone,
    });
  } catch (err) {
    console.error('[shop-settings] httpGetShopTimezone failed', err);
    return res.status(500).json({ error: 'Failed to fetch shop timezone' });
  }
}

export async function httpPatchShopTimezone(req: Request, res: Response) {
  const shopId = req.user?.shopId;
  if (!shopId) return res.status(401).json({ error: 'Unauthorized' });

  const { timezone } = req.body ?? {};

  if (typeof timezone !== 'string' || !timezone.trim()) {
    return res.status(400).json({ error: 'timezone is required' });
  }
  if (!isValidIanaZone(timezone)) {
    return res.status(400).json({ error: `Unknown timezone: ${timezone}` });
  }

  try {
    let updated = 0;
    await db.transaction(async (trx) => {
      await trx.raw(`SET LOCAL "app.current_tenant" = '${shopId}'`);
      updated = await trx('shops')
        .where({ id: shopId })
        // Flipping to 'manual' is the whole point: it tells the OAuth path to
        // leave this value alone from now on.
        .update({ timezone, timezone_source: 'manual' });
    });

    if (!updated) return res.status(404).json({ error: 'Shop not found' });

    return res.json({ timezone, timezone_source: 'manual' });
  } catch (err) {
    console.error('[shop-settings] httpPatchShopTimezone failed', err);
    return res.status(500).json({ error: 'Failed to update shop timezone' });
  }
}
