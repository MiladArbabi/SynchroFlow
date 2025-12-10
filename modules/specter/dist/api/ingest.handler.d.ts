/**
 * Handler(req, res)
 * - expects req.body: { shopId, session }
 * - on PCD violation -> status 400  { error }
 * - on success -> status 200  saved payload (sessionId)
 * - on unexpected error -> status 500  { error }
 */
export declare function handler(req: any, res: any): Promise<any>;
export default handler;
