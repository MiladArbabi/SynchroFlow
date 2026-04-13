import { Request, Response, NextFunction } from 'express';
/**
 * Canonical Auth Context extracted from JWT.
 * This is the ONLY trusted identity surface for downstream services.
 */
export interface AuthContext {
    userId: number;
    shopId?: number;
    actorType?: 'shop_user' | 'system_service' | 'support_admin';
    roles?: string[];
    /**
     * Subscription tier from JWT claim (MON-03).
     * Set by token.service.ts at issuance. Falls back to 'starter'.
     * Use for middleware gating only — never trust for billing decisions.
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
