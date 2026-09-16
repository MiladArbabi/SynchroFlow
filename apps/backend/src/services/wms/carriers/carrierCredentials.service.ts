// apps/backend/src/services/wms/carriers/carrierCredentials.service.ts
//
// #1114 STEP 5C — shared carrier credential resolution.
//
// Extracted from carrierLabel.service.ts's inline decrypt step, which is now
// duplicated by carrier tracking reconciliation's own need to decrypt the
// same shop_carrier_settings row. shop_carrier_settings' primary key is
// (shop_id, carrier_code) and a shop may legitimately have more than one
// active carrier configured at once — this resolver MUST query the exact
// requested (shop_id, carrier_code, is_active=true) tuple and must never
// fall back to "any active carrier for this shop".
//
// Credential decoding preserves the EXISTING production storage contract
// exactly: settings.public_key/private_key/api_token are each a
// JSON-stringified encrypt() payload (the "double-JSON" convention — see
// wms.controller.ts's write path: JSON.stringify(encrypt(secret))).
// decrypt() does its own internal JSON.parse, so the caller must JSON.parse
// once first to unwrap the outer stringification. This is NOT cleaned up
// here — changing it is a storage-migration decision, out of this slice's
// scope.

import type { Knex } from 'knex';
import { decrypt } from '../../../security/encryption.service.js';
import type { CarrierCredentials } from './ICarrierProvider.js';

export async function resolveCarrierCredentials(
  trx: Knex.Transaction,
  shopId: number,
  carrierCode: string
): Promise<CarrierCredentials> {
  const settings = await trx('shop_carrier_settings')
    .where({ shop_id: shopId, carrier_code: carrierCode, is_active: true })
    .first();

  if (!settings) {
    throw new Error(
      `[CARRIER_CREDENTIALS] No active carrier settings for shop ${shopId}, carrier ${carrierCode}`
    );
  }

  const decryptContext = `wms.carrier.${carrierCode}` as 'wms.carrier.sendcloud' | 'wms.carrier.shippo';

  return {
    publicKey: settings.public_key ? decrypt(JSON.parse(settings.public_key), decryptContext) : null,
    privateKey: settings.private_key ? decrypt(JSON.parse(settings.private_key), decryptContext) : null,
    apiToken: settings.api_token ? decrypt(JSON.parse(settings.api_token), decryptContext) : null,
  };
}
