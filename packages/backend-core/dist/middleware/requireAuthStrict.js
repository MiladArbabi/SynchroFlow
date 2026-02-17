import { requireAuth } from './requireAuth.js';
export function requireAuthStrict(req) {
    const ctx = requireAuth(req);
    if (!ctx) {
        throw new Error('AUTH_REQUIRED');
    }
    return ctx;
}
