// Minimal HTTP handler wrapper for specter ingestion (used by tests)
import { ingestRawSession } from '../ingestion/session-ingestion.js';

/**
 * Handler(req, res)
 * - expects req.body: { shopId, session }
 * - on PCD violation -> status 400  { error }
 * - on success -> status 200  saved payload (sessionId)
 * - on unexpected error -> status 500  { error }
 */
export async function handler(req: any, res: any) {
  try {
    const { shopId, session } = (req && req.body) ? req.body : { shopId: undefined, session: undefined };

    // Basic validation
    if (typeof shopId === 'undefined' || !session) {
      return res.status(400).json({ error: 'invalid_payload' });
    }

    const result = await ingestRawSession(Number(shopId), session);
    // return the saved session id (or normalized payload) — tests accept either as long as payload exists
    return res.status(200).json(result || { sessionId: (result as any)?.sessionId || null });
  } catch (err: any) {
    // PCD violation: explicit code or message match
    const code = err && (err.code || err?.name);
    const msg = String(err && (err.message || err));
    if (code === 'PCD_VIOLATION' || /PCD_VIOLATION/i.test(msg)) {
      return res.status(400).json({ error: msg });
    }

    // Unexpected error: log and return 500 for tests/dev
    // (In production we might mask details)
    // eslint-disable-next-line no-console
    console.error('specter.ingest.handler unexpected error:', err);
    return res.status(500).json({ error: 'internal_error' });
  }
}

export default handler;
