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
}
declare global {
    namespace Express {
        interface Request {
            user?: AuthContext;
        }
    }
}
export declare const authenticateToken: (req: Request, res: Response, next: NextFunction) => Response<any, Record<string, any>> | undefined;
