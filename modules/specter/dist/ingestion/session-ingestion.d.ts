import { AnonymousSession } from '../store/session-store';
export interface RawSession {
    shopId?: number;
    customerId?: string;
    landingPage?: string;
    pagesViewed?: string[];
    exitIntent?: boolean;
    [k: string]: any;
}
export interface SessionMetrics {
    sessionVolume: number;
    exitIntentRate: number;
    topPageFunnelsDetected: boolean;
}
/**
 * Normalize a raw incoming session. Throws on PCD violations (raw customerId etc).
 * Returns an AnonymousSession ready to persist.
 */
export declare function normalizeRawSession(raw: RawSession): AnonymousSession;
/**
 * Ingest a raw session for a shop. Will normalize, check PCD, persist and return sessionId.
 */
export declare function ingestRawSession(shopId: number, raw: RawSession): Promise<{
    sessionId: string;
}>;
/**
 * Compute simple metrics for the last N days for a shop.
 */
export declare function computeSessionMetrics(shopId: number, days?: number): SessionMetrics;
