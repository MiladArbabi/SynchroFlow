import { Request, Response, NextFunction } from 'express';
/**
 * Canonical Auth Context extracted from JWT + resolved at request time.
 * This is the ONLY trusted identity surface for downstream services.
 */
export interface AuthContext {
    userId: number;
    shopId?: number;
    actorType?: 'shop_user' | 'system_service' | 'support_admin';
    roles?: string[];
    /**
     * GH-1136 — CURRENT authoritative subscription tier, re-resolved from
     * shop_subscriptions on every authenticated request via
     * resolveTierForShop(shopId). The JWT's own `tier` claim is issuance-time
     * only (a session hint token.service.ts stamps at login) and is
     * deliberately NOT trusted here — a shop downgraded mid-session must lose
     * paid access before its access token expires, not after.
     */
    tier?: string;
}
declare global {
    namespace Express {
        interface Request {
            user?: AuthContext;
        }
    }
}
export declare const authenticateToken: (req: Request, res: Response, next: NextFunction) => Response<any, Record<string, any>> | undefined;
