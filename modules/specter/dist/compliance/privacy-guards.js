"use strict";
// packages/specter/src/compliance/privacy-guards.ts
// Implements PCD guards and URL PII stripping for Specter.
// Matches the locked behavior in the Specter blueprint.
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.PrivacyGuards = void 0;
const session_id_service_1 = __importDefault(require("../session-id-service"));
class PrivacyGuards {
    static assertNoRawCustomerId(raw) {
        if (raw.customerId) {
            // Throw a consistent error string so callers/tests can detect PCD violations.
            throw new Error('PCD_VIOLATION: Raw customerId found in Specter payload');
        }
    }
    static stripPIIFromUrl(url) {
        // Normalize paths and strip query params with PII keys.
        // If URL parsing fails, return a safe placeholder path.
        let u;
        try {
            // Accept relative paths by providing a base origin.
            u = new URL(url, 'https://dummy.host');
        }
        catch {
            return '/invalid-url';
        }
        // Remove any PII query params
        for (const key of Array.from(u.searchParams.keys())) {
            if (this.DEFAULT_PII_KEYS.includes(key.toLowerCase())) {
                u.searchParams.delete(key);
            }
        }
        const search = u.searchParams.toString();
        return search ? `${u.pathname}?${search}` : u.pathname;
    }
    static normalizeSession(raw) {
        // Enforce PCD guard
        this.assertNoRawCustomerId(raw);
        // Create anonymous session
        const sessionId = session_id_service_1.default.generate();
        // Strip PII from landingPage and pagesViewed
        const landingPage = this.stripPIIFromUrl(raw.landingPage);
        const pagesViewed = Array.isArray(raw.pagesViewed)
            ? raw.pagesViewed.map((p) => this.stripPIIFromUrl(p))
            : [];
        return {
            shopId: raw.shopId,
            sessionId,
            landingPage,
            pagesViewed,
            exitIntent: Boolean(raw.exitIntent),
            createdAt: new Date().toISOString()
        };
    }
}
exports.PrivacyGuards = PrivacyGuards;
PrivacyGuards.DEFAULT_PII_KEYS = ['email', 'e', 'phone', 'tel', 'name', 'address'];
//# sourceMappingURL=privacy-guards.js.map